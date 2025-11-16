import express from "express";
import { supabase } from "../utils/supabaseClient.js";
import { openai } from "../utils/openaiClient.js";

const router = express.Router();

const PLAN_LIMITS = {
  free: 2,
  premium: 5,
  pro: Infinity,
};

router.post("/upload-notes-for-pq", async (req, res) => {
  try {
    const { userId, noteIds } = req.body;

    console.log("📝 Received request:", { userId, noteIds });

    // Validate inputs
    if (!userId || !noteIds || noteIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields (userId and noteIds)",
      });
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
    const incrementBy = noteIds.length;

    const endpoint = "gen_pq_from_note";
    const today = new Date().toISOString().slice(0, 10);

    const { data: usage } = await supabase
      .from("usage_tracking")
      .select("usage_count")
      .eq("user_id", userId)
      .eq("endpoint", endpoint)
      .eq("usage_date", today)
      .single();

    const currentCount = usage?.usage_count || 0;

    if (planLimit !== Infinity && currentCount + incrementBy > planLimit) {
      return res.status(403).json({
        error: "Daily PQ generation limit reached",
        used: currentCount + incrementBy,
        allowed: planLimit,
      });
    }

    // Fetch note summaries from Supabase
    console.log("📚 Fetching summaries for", noteIds.length, "notes...");

    const { data: notes, error: notesError } = await supabase
      .from("notes")
      .select("id, title, course_code, lists_of_topic, summary")
      .in("id", noteIds)
      .eq("user_id", userId);

    if (notesError || !notes || notes.length === 0) {
      console.error("❌ Error fetching notes:", notesError);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch notes",
      });
    }

    console.log("✅ Fetched", notes.length, "note summaries");

    // Format note summaries for AI
    const noteSummaries = notes
      .map((note) => {
        const formattedTopics = note.lists_of_topic
          .map((t) => {
            const topicName = t.topic || "Topic";
            const explanation = t.explanation || "No explanation provided";
            return `• ${topicName}: ${explanation}`;
          })
          .join("\n");

        return `
### Subject: ${note.course_code || note.title}
**Note Title: ${note.title}**

**Summary:** ${note.summary || "No summary available"}

**Topics:**
${formattedTopics || "No topics available"}

---`;
      })
      .join("\n");

    console.log("🤖 Calling OpenAI to generate practice questions...");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are an expert examination question writer and academic assessor with deep knowledge of pedagogical assessment methods, bloom's taxonomy, and effective question design.

Your task is to generate comprehensive practice questions based on student notes that test understanding at multiple cognitive levels. These are PRACTICE QUESTIONS with direct answers, NOT multiple choice quizzes.

QUESTION DESIGN PRINCIPLES:
1. **Bloom's Taxonomy Coverage**: Include questions from multiple levels:
   - Remember: Recall facts, terms, basic concepts
   - Understand: Explain ideas, summarize information
   - Apply: Use information in new situations, solve problems
   - Analyze: Draw connections, examine relationships
   - Evaluate: Justify decisions, critique arguments
   - Create: Design solutions, propose alternatives

2. **Question Variety**: Mix different question types:
   - Definition Questions: "What is...?", "Define..."
   - Explanation Questions: "Explain...", "Describe..."
   - Short Answer: Questions requiring 2-3 sentence responses
   - Long Answer/Essay: Questions requiring paragraph responses
   - Problem-Solving: Step-by-step calculation or derivation questions
   - Application Questions: "How would you apply...", "Give an example of..."
   - Comparison Questions: "Compare and contrast...", "What are the differences between..."

3. **Difficulty Distribution**:
   - 40% Easy (basic recall and understanding)
   - 40% Medium (application and analysis)
   - 20% Hard (evaluation and creation)

4. **Comprehensive Coverage**: 
   - Generate questions for EVERY topic mentioned in the notes
   - Each topic should have at least 5-10 questions
   - Cover all key concepts, formulas, definitions, and applications
   - Ask questions that would typically appear in exams

5. **Answer Quality**:
   - Provide comprehensive, accurate answers
   - Include step-by-step solutions for problem-solving questions
   - For essay questions, provide detailed answers covering all key points
   - Use clear, educational language
   - Include examples where relevant

OUTPUT FORMAT:
Return ONLY valid JSON with this exact structure:

{
  "metadata": {
    "total_subjects": number,
    "total_questions": number,
    "generation_date": "DD/MM/YYYY",
    "difficulty_distribution": {
      "easy": number,
      "medium": number,
      "hard": number
    }
  },
  "subjects": [
    {
      "subject_name": "Course code or title from notes",
      "note_title": "Original note title",
      "total_questions": number,
      "questions": [
        {
          "id": "q1_subject_1",
          "question_number": 1,
          "topic": "Specific topic from the note",
          "question_type": "Definition|Explanation|Short Answer|Long Answer|Problem Solving|Application|Comparison",
          "difficulty": "Easy|Medium|Hard",
          "question": "The actual question",
          "answer": "The complete, detailed answer with explanations, steps, or examples as needed",
          "marks": number,
          "bloom_level": "Remember|Understand|Apply|Analyze|Evaluate|Create",
          "attempted": false,
          "user_answer": null
        }
      ]
    }
  ],
  "study_tips": [
    "Tip 1: General tips for using these practice questions effectively",
    "Tip 2: ...",
    "Tip 3: ..."
  ]
}

IMPORTANT RULES:
1. Generate AT LEAST 8-15 questions per topic
2. Ensure questions are directly derived from the note content
3. Make questions challenging but fair - similar to what would appear in actual exams
4. For problem-solving questions, include complete step-by-step solutions in the answer
5. For essay/long answer questions, provide comprehensive answers covering all key points
6. Generate unique question IDs: "q{number}_{subject_initial}"
7. Keep answers detailed and educational (aim for 50-300 words depending on question type)
8. Avoid trivial or overly simple questions
9. Questions should test UNDERSTANDING, not just memorization
10. DO NOT generate multiple choice options - only questions and direct answers
11. Always include "attempted": false and "user_answer": null for each question

Return ONLY the JSON object. No markdown formatting, no code blocks.`,
        },
        {
          role: "user",
          content: `
Generate comprehensive practice questions with answers based on the following student notes.

Cover EVERY topic mentioned and create questions at different difficulty levels.
Ensure questions test deep understanding, not just memorization.
Provide COMPLETE, DETAILED ANSWERS for every question.

NOTES TO GENERATE QUESTIONS FROM:
${noteSummaries}

Generate practice questions with full answers now. Be thorough and comprehensive!`,
        },
      ],
    });

    console.log("✅ OpenAI response received");

    const aiResponse = completion.choices[0].message.content ?? "";

    // Clean the response
    let cleaned = aiResponse
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let practiceQuestionsData;
    try {
      practiceQuestionsData = JSON.parse(cleaned);
      console.log("✅ JSON parsed successfully");
      console.log(
        "📊 Generated",
        practiceQuestionsData.metadata.total_questions,
        "questions across",
        practiceQuestionsData.metadata.total_subjects,
        "subjects"
      );
    } catch (parseError) {
      console.error("❌ Failed to parse AI output:", parseError);
      console.error("Raw AI response:", aiResponse.substring(0, 500));
      return res.status(500).json({
        success: false,
        error: "Failed to parse AI response",
        details: parseError.message,
      });
    }

    // Validate the parsed data
    if (
      !practiceQuestionsData.metadata ||
      !practiceQuestionsData.subjects ||
      practiceQuestionsData.subjects.length === 0
    ) {
      console.error("❌ Invalid practice questions structure");
      return res.status(500).json({
        success: false,
        error: "Invalid practice questions structure",
      });
    }

    console.log("💾 Inserting into Supabase...");

    // Insert everything in one go - just store the entire JSONB
    const { data: questionSet, error: questionSetError } = await supabase
      .from("practice_question_sets")
      .insert({
        user_id: userId,
        note_ids: noteIds,
        total_questions: practiceQuestionsData.metadata.total_questions,
        questions_data: practiceQuestionsData,
        completed: false,
        score: null,
        total_attempted: 0,
      })
      .select()
      .single();

    if (questionSetError) {
      console.error("❌ Question set insert error:", questionSetError);
      return res.status(500).json({
        success: false,
        error: "Failed to save practice questions",
        details: questionSetError.message,
        code: questionSetError.code,
      });
    }

    console.log("✅ Practice question set inserted, ID:", questionSet.id);
    console.log("🎉 Practice questions generation complete!");

    if (!usage) {
      // No record today → create new
      await supabase.from("usage_tracking").insert({
        user_id: userId,
        endpoint,
        usage_date: today,
        usage_count: incrementBy,
        plan: profile.plan,
      });
    } else {
      await supabase
        .from("usage_tracking")
        .update({
          usage_count: currentCount + incrementBy,
          plan: profile.plan,
        })
        .eq("user_id", userId)
        .eq("endpoint", endpoint)
        .eq("usage_date", today);
    }

    return res.json({
      success: true,
      data: questionSet,
      questionCount: practiceQuestionsData.metadata.total_questions,
    });
  } catch (error) {
    console.error("❌ Unexpected error:", error);
    console.error("Error stack:", error.stack);

    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

export { router as generatePracticeQuestionsRoute };
