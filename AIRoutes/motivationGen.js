import express from "express";
import crypto from "crypto";

import { supabase } from "../utils/supabaseClient.js";
import { openai } from "../utils/openaiClient.js";
import { getRandomColor } from "../utils/helpers.js";
// import { PDFParse } from "pdf-parse";

const router = express.Router();

router.post("/motivation-gen", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "Missing fields (userid)" });
    }

    // Generate summary using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are a motivational AI coach for students. 
Your task is to generate a single motivational quote related to studying, focus, or perseverance.

Rules:
1. Generate only **one** quote.
2. The quote should be concise and powerful — **no longer than three lines** when displayed on screen.
3. Avoid generic sayings and cliches.
4. No emojis, no hashtags, no markdown.
5. Output only the quote text — nothing else.
`,
        },
        {
          role: "user",
          content:
            "Generate a motivational quote to inspire me to keep studying.",
        },
      ],
    });

    const aiResponse = completion.choices[0].message.content ?? "";

    const motivationQuote = aiResponse.trim();

    console.log("✅ Motivation quote received:", motivationQuote);

    // Save directly as string, no parsing needed
    const { data: motivation, error: updateError } = await supabase
      .from("profiles")
      .update({
        motivation: motivationQuote, // Save the plain text quote
      })
      .eq("user_id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("❌ Update error:", updateError);
      return res.status(500).json({
        error: "Failed to save motivation",
        details: updateError.message,
      });
    }

    console.log("✅ motivation:", motivation.id);

    return res.status(200).json({
      success: true,
      message: "gen successfully",
      data: {
        motivationQuote,
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

export { router as motivationGen };
