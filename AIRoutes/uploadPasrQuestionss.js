import express from "express";
import crypto from "crypto";

import { supabase } from "../utils/supabaseClient.js";
import { openai } from "../utils/openaiClient.js";
import { getRandomColor } from "../utils/helpers.js";
// import { PDFParse } from "pdf-parse";

const router = express.Router();

const PLAN_LIMITS = {
  free: 2,
  premium: 5,
  pro: Infinity,
};

router.post("/upload-past-question", async (req, res) => {
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

    console.log("✅ File uploaded successfully");

    const {
      data: { publicUrl },
    } = supabase.storage.from("notes").getPublicUrl(fileData.path);

    console.log("📖 Parsing PDF text...");

    // Parse PDF text
    // const parser = new PDFParse({ data: fileBuffer });
    const pqtexts = "hdhdhdhdh";

    console.log("📝 Extracted text length:", pqtexts.text.length);

    if (!pqtexts.text || pqtexts.text.trim().length === 0) {
      return res.status(400).json({ error: "Could not extract text from PDF" });
    }

    console.log("🤖 Calling OpenAI for analysis...");

    // Generate summary using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are an AI academic assistant specialized in analyzing past examination papers. Your task is to analyze past question papers and predict likely exam topics based on frequency, emphasis, and patterns.

Instructions:
1. Extract the **subject/course name** and **year** from the document if available.
2. Identify **all topics/concepts** covered in the past questions.
3. For each topic, calculate a **probability score (0-100%)** indicating how likely it is to appear in future exams based on:
   - Frequency of appearance in the paper
   - Number of marks allocated to questions on that topic
   - Emphasis and depth of questions asked
   - Patterns of repetition across different sections
4. Sort topics by probability (highest first).
5. Only include topics with probability >= 50%.
6. Provide the output strictly in **JSON format** like this:

{
  "subject": "Subject/Course name or course code extracted from the document",
  "year": "Exam year (e.g., '2023', '2022/2023')",
  "topics": [
    {
      "name": "Topic name",
      "probability": 85
    },
    {
      "name": "Another topic",
      "probability": 72
    }
  ],
  "analyzed": true
}

Probability Guidelines:
- 80-100%: Very High (topic appears frequently with significant marks)
- 65-79%: High (topic appears multiple times)
- 50-64%: Moderate (topic appears at least once with decent marks)

Do not include anything outside the JSON. Be accurate and analytical in your predictions.`,
        },
        {
          role: "user",
          content: `
Here is the past question paper content. Analyze it and predict likely topics for future exams.

Past Question Paper:
${pqtexts.text.substring(0, 20000)}
`,
        },
      ],
    });

    const aiResponse = completion.choices[0].message.content ?? "";

    console.log("🤖 AI Response received:");
    console.log(aiResponse.substring(0, 500)); // Log first 500 chars

    let cleaned = aiResponse
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let analysisResult;
    try {
      analysisResult = JSON.parse(cleaned);
      console.log("✅ AI response parsed successfully");
      console.log(
        "📊 Analysis result:",
        JSON.stringify(analysisResult, null, 2)
      );
    } catch (parseError) {
      console.error("❌ Failed to parse AI response:", parseError);
      console.error("Raw AI response:", aiResponse);
      return res.status(500).json({
        error: "AI response parsing failed",
        details: parseError.message,
        aiResponse: aiResponse.substring(0, 1000),
      });
    }

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

    console.log("✅ Past question saved with ID:", pastQuestionData.id);

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

    res.status(500).json({
      error: "Upload failed",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

export { router as uploadPastQuestionRoute };
