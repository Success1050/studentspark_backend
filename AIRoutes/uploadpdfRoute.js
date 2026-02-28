import express from "express";
import crypto from "crypto";

import { supabase } from "../utils/supabaseClient.js";
import { openai } from "../utils/openaiClient.js";
import { getRandomColor } from "../utils/helpers.js";
import { convertPdfToImages } from "../utils/pdfToImages.js";
import pdfExtract from "pdf-extraction";
import { compressImage } from "../utils/resizeimg.js";

const router = express.Router();

const PLAN_LIMITS = {
  free: 2,
  premium: 5,
  pro: Infinity,
};

router.post("/upload-note", async (req, res) => {
  let uploadedFilePath = null;
  let createdNoteId = null;

  try {
    const { title, userId, file } = req.body;

    if (!file || !title || !userId) {
      return res
        .status(400)
        .json({ error: "Missing fields (file, subject, title)" });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("plan")
      .eq("user_id", userId)
      .single();

    if (profileError || !profile) {
      return res.status(400).json({ error: "User profile not found" });
    }

    const userPlan = profile.plan || "free";
    const planLimit = PLAN_LIMITS[userPlan];

    const endpoint = "upload_note";
    const today = new Date().toISOString().slice(0, 10);
    // Check existing usage
    const { data: usage } = await supabase
      .from("usage_tracking")
      .select("usage_count")
      .eq("user_id", userId)
      .eq("endpoint", endpoint)
      .eq("usage_date", today)
      .single();

    const currentCount = usage?.usage_count || 0;

    if (planLimit !== Infinity && currentCount >= planLimit) {
      return res.status(403).json({
        error: "Daily upload limit reached",
        used: currentCount,
        allowed: planLimit,
      });
    }

    // Decode base64 file (PDF)
    const fileBuffer = Buffer.from(file, "base64");
    const fileName = `${crypto.randomUUID()}_${title}.pdf`;

    // Upload to Supabase Storage
    const { data: fileData, error: uploadError } = await supabase.storage
      .from("notes")
      .upload(fileName, fileBuffer, { contentType: "application/pdf" });

    if (uploadError) throw uploadError;
    uploadedFilePath = fileData.path;

    const {
      data: { publicUrl },
    } = supabase.storage.from("notes").getPublicUrl(fileData.path);

    let extracted;
    try {
      extracted = await pdfExtract(fileBuffer);
    } catch (err) {
      console.error("PDF Extraction failed:", err);
      extracted = { text: "" };
    }

    let pdfText = extracted.text || "";
    console.log("PDF TEXT:", pdfText);

    const cleanText = pdfText
      .replace(/--\s*\d+\s*of\s*\d+\s*--/g, "")
      .replace(/CamScanner/gi, "")
      .replace(/\n/g, "")
      .trim();

    const hasNoText = !pdfText || cleanText.length < 50;

    console.log(
      "Original text length:",
      pdfText.text ? pdfText.text.length : 0
    );
    console.log("Clean text length:", cleanText.length);
    console.log("Has no meaningful text:", hasNoText);

    if (hasNoText) {
      console.log("PDF seems scanned → Performing batched OCR with GPT-4o-mini directly (faster)");

      const images = await convertPdfToImages(fileBuffer);
      console.log("Generated images count:", images.length);

      if (!images || images.length === 0) {
        throw new Error("PDF conversion failed: no images were generated.");
      }

      const batchSize = 5;
      const ocrTexts = [];

      for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, i + batchSize);
        console.log(`🔍 OCR processing pages ${i + 1} to ${Math.min(i + batchSize, images.length)}...`);

        const ocrResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract all readable text from these images. Include every word, number, label, heading, and any other visible text. Preserve layout.",
                },
                ...batch.map((base64) => ({
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${base64.replace(/^data:image\/\w+;base64,/, "").replace(/\s+/g, "")}`,
                  },
                })),
              ],
            },
          ],
        });

        ocrTexts.push(ocrResponse.choices[0]?.message?.content || "");
      }

      pdfText = ocrTexts.join("\n\n");
      console.log("OCR extracted text total length:", pdfText.length);
    }

    // Generate summary using OpenAI in chunks to handle max tokens
    const maxChars = 30000;
    const txtChunks = [];
    for (let i = 0; i < pdfText.length; i += maxChars) {
      txtChunks.push(pdfText.substring(i, i + maxChars));
    }

    console.log(`📝 Text split into ${txtChunks.length} chunks to prevent token limits`);

    const partialSummaries = [];

    for (let i = 0; i < txtChunks.length; i++) {
      console.log(`🤖 Summarizing chunk ${i + 1}/${txtChunks.length}...`);
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
You are an AI academic assistant. Your task is to summarize PART ${i + 1} of ${txtChunks.length} of a PDF note for students.

Instructions:
1. Extract the **course code** and **title** if available.
2. Identify **all main topics** in this part.
3. For each topic, provide a **detailed explanation**, covering all relevant concepts, examples, and important details.
4. Provide the output strictly in **JSON format** like this:

{
  "summary": "Overall summary of this part...",
  "course_code": "Extracted course code if available",
  "lists_of_topic": [
    {
      "topic": "Topic 1",
      "explanation": "Detailed explanation for Topic 1..."
    }
  ]
}

Do not include anything outside the JSON.`,
          },
          {
            role: "user",
            content: `Here is the PDF content part. Summarize it as instructed.\n\nPDF content:\n${txtChunks[i]}`,
          },
        ],
      });

      const aiResponse = completion.choices[0].message.content ?? "";
      let cleaned = aiResponse.replace(/```json/g, "").replace(/```/g, "").trim();

      try {
        partialSummaries.push(JSON.parse(cleaned));
      } catch {
        console.error("Failed to parse AI output for chunk");
      }
    }

    let parsed;
    if (partialSummaries.length === 1) {
      parsed = partialSummaries[0];
    } else if (partialSummaries.length > 1) {
      // Very basic merge to prevent another huge AI call that can fail
      const mergedTopics = partialSummaries.flatMap(p => p.lists_of_topic || []);
      const mergedSummary = partialSummaries.map(p => p.summary).join("\n\n");
      const courseCode = partialSummaries.find(p => p.course_code)?.course_code || null;
      parsed = { summary: mergedSummary, course_code: courseCode, lists_of_topic: mergedTopics };
    } else {
      parsed = { summary: "", course_code: null, lists_of_topic: [] };
    }

    console.log("✅ Final Summary parsed");

    const { summary, course_code, lists_of_topic } = parsed;

    // Save to Supabase table
    const { data: note, error: dbError } = await supabase
      .from("notes")
      .insert([
        {
          user_id: userId,
          title,
          file_url: publicUrl,
          summary,
          lists_of_topic,
          course_code,
          color: getRandomColor(),
        },
      ])
      .select();

    if (dbError) throw dbError;
    createdNoteId = note[0]?.id;

    if (!usage) {
      // No record today → create new
      await supabase.from("usage_tracking").insert({
        user_id: userId,
        endpoint,
        usage_date: today,
        usage_count: 1,
        plan: profile.plan,
      });
    } else {
      // Record exists → increment
      await supabase
        .from("usage_tracking")
        .update({
          usage_count: currentCount + 1,
          plan: profile.plan,
        })
        .eq("user_id", userId)
        .eq("endpoint", endpoint)
        .eq("usage_date", today);
    }

    return res.json({ success: true, note });
  } catch (error) {
    console.error("Upload error:", error);

    // ===== ATOMIC ROLLBACK =====
    try {
      if (createdNoteId) {
        await supabase.from("notes").delete().eq("id", createdNoteId);
        console.log(`✅ Rolled back DB record ${createdNoteId}`);
      }
      if (uploadedFilePath) {
        await supabase.storage.from("notes").remove([uploadedFilePath]);
        console.log(`✅ Rolled back storage file ${uploadedFilePath}`);
      }
    } catch (cleanupError) {
      console.error("Failed to cleanup after error:", cleanupError);
    }

    res.status(500).json({ error: error.message });
  }
});

export { router as uploadNoteRoute };
