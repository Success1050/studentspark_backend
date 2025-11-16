import express from "express";
import { supabase } from "../utils/supabaseClient.js";
import { openai } from "../utils/openaiClient.js";
import { getRandomColor } from "../utils/helpers.js";

const router = express.Router();

const PLAN_LIMITS = {
  free: 1,
  premium: 3,
  pro: Infinity,
};

router.post("/upload-notes-for-quiz", async (req, res) => {
  try {
    const { userId, noteId } = req.body;

    console.log("📝 Received request:", { userId, noteId });

    // Validate inputs
    if (!userId || !noteId) {
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

    const endpoint = "gen_quiz_from_note";
    const today = new Date().toISOString().slice(0, 10);

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
        error: "Daily generation limit reached",
        used: currentCount,
        allowed: planLimit,
      });
    }

    // Fetch note summaries from Supabase
    console.log("📚 Fetching summaries for", noteId, "notes...");

    const { data: note, error: notesError } = await supabase
      .from("notes")
      .select("id, title, course_code, lists_of_topic, summary")
      .eq("id", noteId)
      .eq("user_id", userId)
      .single();
    if (notesError || !note) {
      console.error("❌ Error fetching note:", notesError);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch note",
      });
    }

    console.log("✅ Fetched note:", note.title);

    // Format note summaries for AI
    const formattedTopics = (note.lists_of_topic || [])
      .map((t) => {
        const topicName = t.topic || "Topic";
        const explanation = t.explanation || "No explanation provided";
        return `• ${topicName}: ${explanation}`;
      })
      .join("\n");

    const noteSummary = `
### Subject: ${note.course_code || note.title}
**Note Title: ${note.title}**

**Summary:** ${note.summary || "No summary available"}

**Topics:**
${formattedTopics || "No topics available"}

---`;

    console.log(noteSummary);

    console.log("🤖 Calling OpenAI to generate practice questions...");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are an expert quiz creator specializing in educational assessments. Your task is to generate high-quality multiple-choice quiz questions based on student notes.

QUIZ DESIGN PRINCIPLES:

1. **Question Quality Standards**:
   - Each question must be clear, unambiguous, and directly based on the note content.
   - Questions should test understanding of topics and their explanations.
   - Avoid trick questions or overly complex wording.
   - Each question should have ONE clearly correct answer.

2. **Difficulty Distribution** (for 10 questions):
   - 3-4 Easy questions (basic recall and definitions from topic explanations)
   - 4-5 Medium questions (application and comprehension of concepts)
   - 2-3 Hard questions (analysis, synthesis, and connections between topics)

3. **Option Design Rules**:
   - Provide exactly 4 options per question.
   - All distractors (wrong answers) must be plausible but clearly incorrect.
   - Avoid "All of the above" or "None of the above" options.
   - Keep options similar in length and grammatical structure.
   - Randomize the position of correct answers.

4. **Coverage Requirements**:
   - Generate questions that cover ALL topics provided in the note.
   - Each topic should have at least 1 question.
   - Use both the topic name AND its explanation to create comprehensive questions.
   - Prioritize key concepts, definitions, and relationships explained in the topics.

5. **Explanation Quality**:
   - Provide a clear, concise explanation for why the answer is correct.
   - Reference the relevant topic and explanation from the note.
   - Keep explanations educational and informative (2-3 sentences).

6. **Time Limit Instructions**:
   - Set "time_limit" in **seconds**.
   - Allocate more time for quizzes with harder questions eg:
       - Easy: 30-60 seconds per question
       - Medium: 60-90 seconds per question
       - Hard: 90-120 seconds per question
   - just calculate based on the complexity of the questions and Sum the total for all 10 questions and return that as "time_limit".

OUTPUT FORMAT:
Return ONLY valid JSON with this exact structure (NO markdown, NO code blocks):

{
  "quiz_metadata": {
    "note_title": "Title from the note",
    "course_code": "Course code from the note",
    "total_questions": 10,
    "time_limit": 0,
    "difficulty": "medium",
    "topics_covered": ["List of topics from the note"]
  },
  "questions": [
    {
      "question_number": 1,
      "question": "Clear, concise question text ending with a question mark?",
      "options": [
        "Option A - First choice",
        "Option B - Second choice", 
        "Option C - Third choice",
        "Option D - Fourth choice"
      ],
      "correct_answer": "Option A - First choice",
      "explanation": "Brief explanation of why this answer is correct, referencing the topic explanation.",
      "difficulty": "easy",
      "topic": "Specific topic name from the note",
      "marks": 1
    }
  ],
  "study_tips": [
    "Review the key concepts from [specific topics]",
    "Pay special attention to the explanations of [specific topics]",
    "Practice applying concepts from [specific topics]"
  ]
}

CRITICAL REQUIREMENTS:
1. Generate EXACTLY 10 questions.
2. Ensure the "correct_answer" field contains the EXACT text from one of the options.
3. Base ALL questions strictly on the topics and their explanations provided.
4. Distribute questions across ALL topics in the note.
5. Use the topic explanations to create deep, meaningful questions.
6. Ensure each question is independent.
7. Use proper grammar and punctuation throughout.
8. Make sure options are mutually exclusive.
9. DO NOT include any markdown formatting or code blocks.
10. Return ONLY the raw JSON object.

QUALITY CHECKLIST:
✓ Each question tests understanding of a topic and its explanation.
✓ All topics from the note are represented.
✓ Questions test both recall and application of concepts.
✓ Correct answer is definitively right based on the topic explanations.
✓ Distractors are plausible but clearly incorrect.
✓ Explanations reference the relevant topic from the note.
✓ "time_limit" is calculated in seconds based on question difficulty as instructed.
      `,
        },
        {
          role: "user",
          content: `
Generate a 10-question multiple-choice quiz based on the following note.

${noteSummary}

INSTRUCTIONS:
1. Create exactly 10 high-quality multiple-choice questions.
2. Distribute questions across ALL topics listed above.
3. Use both the topic names AND their explanations to create comprehensive questions.
4. Include a mix of difficulty levels (3-4 easy, 4-5 medium, 2-3 hard).
5. Each question must have 4 options with ONE clearly correct answer.
6. Provide clear explanations that reference the topic explanations.
7. Ensure the "correct_answer" field matches EXACTLY one of the options.
8. Set "time_limit" in seconds, based on question difficulty as explained in the system message.

Generate the quiz now in the specified JSON format. Focus on testing understanding of the topic explanations, not just memorization.
      `,
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
        practiceQuestionsData.quiz_metadata.total_questions,
        "questions across"
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
      !practiceQuestionsData.quiz_metadata ||
      !practiceQuestionsData.questions ||
      practiceQuestionsData.questions.length === 0
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
      .from("quizzes")
      .insert({
        note_id: noteId,
        user_id: userId,
        quiz_data: practiceQuestionsData,
        title: practiceQuestionsData.quiz_metadata.note_title,
        color: getRandomColor(),
      })
      .select()
      .single();

    if (questionSetError) {
      console.error("❌ Question set insert error:", questionSetError);
      return res.status(500).json({
        success: false,
        error: "Failed to save quiz generation",
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

    return res.json({
      success: true,
      data: questionSet,
      questionCount: practiceQuestionsData.quiz_metadata.total_questions,
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

export { router as generatequiz };
