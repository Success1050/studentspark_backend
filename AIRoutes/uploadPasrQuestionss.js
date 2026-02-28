import express from "express";
import crypto from "crypto";

import { supabase } from "../utils/supabaseClient.js";
import { openai } from "../utils/openaiClient.js";
import { getRandomColor } from "../utils/helpers.js";
import pdfExtract from "pdf-extraction";

const router = express.Router();

const PLAN_LIMITS = {
  free: 2,
  premium: 5,
  pro: Infinity,
};

router.post("/upload-past-question", async (req, res) => {
  let uploadedFilePath = null;
  let createdPqId = null;

  try {
    const { title, userId, file } = req.body;

    if (!file || !title || !userId) {
      return res
        .status(400)
        .json({ error: "Missing fields (file, subject, title)" });
    }

    console.log("📄 Starting past question upload for:", title);

    // Decode base64 file (PDF)
    const fileBuffer = Buffer.from(file, "base64");
    const fileName = `${crypto.randomUUID()}_${title}.pdf`;

    console.log("☁️ Uploading to Supabase Storage...");

    // Upload to Supabase Storage
    const { data: fileData, error: uploadError } = await supabase.storage
      .from("notes")
      .upload(fileName, fileBuffer, { contentType: "application/pdf" });

    if (uploadError) {
      console.error("❌ Storage upload error:", uploadError);
      throw uploadError;
    }

    uploadedFilePath = fileData.path;

    console.log("✅ File uploaded successfully");

    const {
      data: { publicUrl },
    } = supabase.storage.from("notes").getPublicUrl(fileData.path);

    console.log("📖 Parsing PDF text...");

    let extracted;
    try {
      extracted = await pdfExtract(fileBuffer);
    } catch (err) {
      console.error("PDF Extraction failed:", err);
      extracted = { text: "" };
    }

    let pdfText = extracted.text || "";

    const cleanText = pdfText.replace(/--\s*\d+\s*of\s*\d+\s*--/g, "").replace(/CamScanner/gi, "").replace(/\n/g, "").trim();
    const hasNoText = !pdfText || cleanText.length < 50;

    if (hasNoText) {
      console.log("PDF seems scanned → Performing batched OCR with GPT-4o-mini directly (faster)");
      const { convertPdfToImages } = await import("../utils/pdfToImages.js");
      const images = await convertPdfToImages(fileBuffer);
      if (!images || images.length === 0) throw new Error("PDF conversion failed: no images were generated.");

      const batchSize = 5;
      const ocrTexts = [];
      for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, i + batchSize);
        console.log(`🔍 OCR processing pages ${i + 1} to ${Math.min(i + batchSize, images.length)}...`);
        const ocrResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Extract all readable text from these images. Preserve layout." },
              ...batch.map(base64 => ({
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${base64.replace(/^data:image\/\w+;base64,/, "").replace(/\s+/g, "")}` }
              }))
            ]
          }]
        });
        ocrTexts.push(ocrResponse.choices[0]?.message?.content || "");
      }
      pdfText = ocrTexts.join("\n\n");
    }

    if (!pdfText || pdfText.trim().length === 0) {
      return res.status(400).json({ error: "Could not extract text from PDF" });
    }

    console.log("🤖 Calling OpenAI for analysis...");

    // Generate summary using OpenAI in chunks
    const maxChars = 30000;
    const txtChunks = [];
    for (let i = 0; i < pdfText.length; i += maxChars) {
      txtChunks.push(pdfText.substring(i, i + maxChars));
    }

    console.log(`📝 Text split into ${txtChunks.length} chunks to prevent token limits`);

    const partialAnalyses = [];

    for (let i = 0; i < txtChunks.length; i++) {
      console.log(`🤖 Analyzing chunk ${i + 1}/${txtChunks.length}...`);
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
You are an AI academic assistant specialized in analyzing past examination papers. 
You are analyzing PART ${i + 1} of ${txtChunks.length} from a past question paper.

Instructions:
1. Extract the **subject/course name** and **year** from the document if available.
2. Identify **all topics/concepts** covered in the past questions.
3. For each topic, calculate a **probability score (0-100%)** indicating how likely it is to appear in future exams based on frequency and emphasis.
4. Only include topics with probability >= 50%.
5. Provide the output strictly in **JSON format** like this:

{
  "subject": "Subject/Course name or course code",
  "year": "Exam year",
  "topics": [
    { "name": "Topic name", "probability": 85 }
  ],
  "analyzed": true
}

Do not include anything outside the JSON.`,
          },
          {
            role: "user",
            content: `Here is the past question paper part. Analyze it.\n\nPast Question Paper:\n${txtChunks[i]}`,
          },
        ],
      });

      const aiResponse = completion.choices[0].message.content ?? "";
      let cleaned = aiResponse.replace(/```json/g, "").replace(/```/g, "").trim();

      try {
        partialAnalyses.push(JSON.parse(cleaned));
      } catch (parseError) {
        console.error("❌ Failed to parse AI response for chunk:", parseError);
      }
    }

    let analysisResult;
    if (partialAnalyses.length === 1) {
      analysisResult = partialAnalyses[0];
    } else if (partialAnalyses.length > 1) {
      // Merge all topics taking the highest probability for a given topic
      const subject = partialAnalyses.find(p => p.subject && p.subject !== "Unknown Subject")?.subject || "Unknown";
      const year = partialAnalyses.find(p => p.year && p.year !== "Unknown Year")?.year || "Unknown";
      const allTopicsObj = {};
      partialAnalyses.flatMap(p => p.topics || []).forEach(t => {
        const key = t.name.toLowerCase().trim();
        if (!allTopicsObj[key] || allTopicsObj[key].probability < t.probability) {
          allTopicsObj[key] = t;
        }
      });
      analysisResult = {
        subject,
        year,
        topics: Object.values(allTopicsObj).sort((a, b) => b.probability - a.probability),
        analyzed: true
      };
    } else {
      analysisResult = { subject: "Unknown", year: "Unknown", topics: [], analyzed: false };
    }
    console.log("✅ Final Analysis parsed successfully");

    console.log("💾 Saving to database...");

    // Save to Supabase table
    const { data: pastQuestionData, error: pastQuestionError } = await supabase
      .from("past_questions")
      .insert({
        user_id: userId,
        title: title,
        subject: analysisResult.subject || "Unknown Subject",
        year: analysisResult.year || "Unknown Year",
        file_url: publicUrl,
        analyzed: analysisResult.analyzed || true,
      })
      .select()
      .single();

    if (pastQuestionError) {
      console.error("❌ Past question insert error:", pastQuestionError);
      return res.status(500).json({
        error: "Failed to save past question",
        details: pastQuestionError.message,
      });
    }

    createdPqId = pastQuestionData.id;
    console.log("✅ Past question saved with ID:", createdPqId);

    // Insert topics into database
    if (analysisResult.topics && analysisResult.topics.length > 0) {
      console.log(`💾 Inserting ${analysisResult.topics.length} topics...`);

      const topicsToInsert = analysisResult.topics.map((topic) => ({
        past_question_id: pastQuestionData.id,
        name: topic.name,
        probability: topic.probability,
      }));

      const { error: topicsError } = await supabase
        .from("past_question_topics")
        .insert(topicsToInsert);

      if (topicsError) {
        console.error("❌ Topics insert error:", topicsError);
        // Don't fail the whole request, just log the error
        return res.status(200).json({
          success: true,
          message: "Past question uploaded but topics failed to save",
          data: {
            pastQuestion: pastQuestionData,
            topics: [],
          },
        });
      }

      console.log("✅ Topics inserted successfully");
    } else {
      console.log("⚠️ No topics found in analysis result");
    }

    console.log("🎉 Upload complete!");

    // Return success response
    return res.status(200).json({
      success: true,
      message: "Past question uploaded and analyzed successfully",
      data: {
        pastQuestion: pastQuestionData,
        analysis: analysisResult,
      },
    });
  } catch (error) {
    console.error("❌ Upload error:", error);
    console.error("Error stack:", error.stack);

    // ===== ATOMIC ROLLBACK =====
    try {
      if (createdPqId) {
        await supabase.from("past_question_topics").delete().eq("past_question_id", createdPqId);
        await supabase.from("past_questions").delete().eq("id", createdPqId);
        console.log(`✅ Rolled back DB record ${createdPqId} and its topics`);
      }
      if (uploadedFilePath) {
        await supabase.storage.from("notes").remove([uploadedFilePath]);
        console.log(`✅ Rolled back storage file ${uploadedFilePath}`);
      }
    } catch (cleanupError) {
      console.error("Failed to cleanup after error:", cleanupError);
    }

    res.status(500).json({
      error: "Upload failed",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

export { router as uploadPastQuestionRoute };
