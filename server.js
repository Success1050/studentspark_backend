// upload_note.js
import express from "express";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import dotenv from "dotenv";
import cors from "cors";
import crypto from "crypto";
import { PDFParse } from "pdf-parse";
dotenv.config();

const app = express();
app.use(express.json({ limit: "400mb" })); // allow larger JSON payloads
app.use(cors());

// Initialize Supabase and OpenAI
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const getRandomColor = () => {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
};

// --- Upload Route ---
app.post("/upload-note", async (req, res) => {
  try {
    const { title, userId, file } = req.body;

    console.log(title, userId);
    console.log("the file", file);

    if (!file || !title || !userId) {
      return res
        .status(400)
        .json({ error: "Missing fields (file, subject, title)" });
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
    const pdfText = await parser.getText();

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
${pdfText.text.substring(0, 20000)}
`,
        },
      ],
    });

    const aiResponse = completion.choices[0].message.content;

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

    return res.json({ success: true, note });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
