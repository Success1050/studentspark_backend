import express from "express";
import crypto from "crypto";

import { supabase } from "../utils/supabaseClient.js";
import { openai } from "../utils/openaiClient.js";
import { getRandomColor } from "../utils/helpers.js";
import { PDFParse } from "pdf-parse";
import { convertPdfToImages } from "../utils/pdfToImages.js";

const router = express.Router();

const PLAN_LIMITS = {
  free: 2,
  premium: 5,
  pro: Infinity,
};

router.post("/upload-note", async (req, res) => {
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

    const {
      data: { publicUrl },
    } = supabase.storage.from("notes").getPublicUrl(fileData.path);

    // Parse PDF text
    const parser = new PDFParse({ data: fileBuffer });
    let pdfText = await parser.getText();

    console.log("the textss", pdfText);

    if (!pdfText || pdfText.total < 30) {
      console.log("PDF seems scanned → Performing OCR with GPT-5-mini");

      const images = await convertPdfToImages(fileBuffer); // base64 or temp files
      const urls = [];
      for (let i = 0; i < images.length; i++) {
        const fileName = `ocr_img_${Date.now()}_${i}.jpg`;
        const { data: imageData, error } = await supabase.storage
          .from("temp")
          .upload(fileName, Buffer.from(images[i], "base64"), {
            contentType: "image/jpeg",
          });

        if (error) {
          console.error("Supabase upload error:", error);
          throw new Error(`Failed to upload image ${fileName}`);
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from("temp").getPublicUrl(imageData.path);

        // ✅ Ensure URL is valid
        if (!publicUrl) {
          throw new Error(`Supabase returned null URL for ${fileName}`);
        }

        urls.push(publicUrl);
      }

      console.log("images gotten", urls);

      const ocrResponse = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Extract all readable text from these images. Include every word, number, label, heading, and any other visible text. Provide the extracted text in a structured format that preserves the layout and organization as much as possible. Do not add any commentary, explanations, or closing remarks - only output the extracted text content.",
              },
              ...urls.map((url) => ({
                type: "input_image",
                image_url: url,
              })),
            ],
          },
        ],
      });

      // 4️⃣ Return OCR text
      console.log("shout gbu", ocrResponse.output_text);

      pdfText = ocrResponse.output_text;
    }

    // Generate summary using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are an AI academic assistant. Your task is to summarize PDF notes for students in a detailed and educational way.

Instructions:
1. Extract the **course code** and **title** if available.
2. Identify **all main topics** in the PDF and maintain a **list of topics**.
3. For each topic, provide a **detailed explanation**, covering all relevant concepts, examples, applications, and important details. Each topic's explanation should be grouped under its heading.
4. The summary should be **very and necessary long enough to explain the material clearly**.
5. Provide the output strictly in **JSON format** like this:

{
  "summary": "Overall summary of the PDF content, covering key concepts and important ideas.",
  "course_code": "Extracted course code if available",
  "lists_of_topic": [
    {
      "topic": "Topic 1",
      "explanation": "Detailed explanation for Topic 1...it should be long enough to cover everything about the topic1."
    },
    {
      "topic": "Topic 2",
      "explanation": "Detailed explanation for Topic 2..."
    },
    ...
  ]
}

Do not include anything outside the JSON. Be precise, informative, and student-friendly.`,
        },
        {
          role: "user",
          content: `
Here is the PDF content. Summarize it as instructed.

PDF content:
${pdfText.substring(0, 20000)}
`,
        },
      ],
    });

    const aiResponse = completion.choices[0].message.content ?? "";

    let cleaned = aiResponse
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI output:", aiResponse);
      parsed = { summary: aiResponse, course_title: null, course_code: null };
    }

    console.log(parsed);

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
    res.status(500).json({ error: error.message });
  }
});

export { router as uploadNoteRoute };
