global.DOMMatrix = class DOMMatrix {
  constructor(init) {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
    this.m11 = 1;
    this.m12 = 0;
    this.m13 = 0;
    this.m14 = 0;
    this.m21 = 0;
    this.m22 = 1;
    this.m23 = 0;
    this.m24 = 0;
    this.m31 = 0;
    this.m32 = 0;
    this.m33 = 1;
    this.m34 = 0;
    this.m41 = 0;
    this.m42 = 0;
    this.m43 = 0;
    this.m44 = 1;
  }
  translate(x, y, z) {
    return this;
  }
  scale(x, y, z) {
    return this;
  }
  rotate(angle) {
    return this;
  }
  multiply(other) {
    return this;
  }
};

import express from "express";
import { supabase } from "../utils/supabaseClient.js";
import { openai } from "../utils/openaiClient.js";

const router = express.Router();

const PLAN_LIMITS = {
  free: 1,
  premium: 3,
  pro: Infinity,
};

router.post("/study-plan", async (req, res) => {
  try {
    const {
      userId,
      examDate,
      planName,
      duration,
      subjects,
      noteIds,
      studyHours,
      aiOptions,
    } = req.body;

    console.log("📝 Received request:", {
      examDate,
      planName,
      duration,
      subjects,
      noteIds,
      studyHours,
      aiOptions,
    });

    // Validate inputs
    if (
      !userId ||
      !examDate ||
      !duration ||
      !subjects ||
      !studyHours ||
      !planName
    ) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
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

    const endpoint = "gen_study_plan";
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
        error: "Daily studyplan generation limit reached",
        used: currentCount,
        allowed: planLimit,
      });
    }

    // Fetch note summaries from Supabase
    let noteSummaries = "";
    if (noteIds && noteIds.length > 0) {
      console.log("📚 Fetching summaries for", noteIds.length, "notes...");

      const { data: notes, error: notesError } = await supabase
        .from("notes")
        .select("id, title, course_code, lists_of_topic")
        .in("id", noteIds)
        .eq("user_id", userId);

      console.log("the notes", notes);

      if (notesError) {
        console.error("❌ Error fetching notes:", notesError);
      } else if (notes && notes.length > 0) {
        console.log("✅ Fetched", notes.length, "note summaries");

        noteSummaries = notes
          .map((note) => {
            const formattedTopics = note.lists_of_topic
              .map((t, i) => {
                const topicName = t.topic || `Topic ${i + 1}`;
                const explanation = t.explanation || "No explanation provided";
                return `• ${topicName}: ${explanation.substring(0, 300)}...`;
              })
              .join("\n");

            return `
### Subject: ${note.course_code || "N/A"}
**${note.title}**

${formattedTopics || "No topics available"}

---`;
          })
          .join("\n");
      }
    }

    console.log("the note summary", noteSummaries);

    console.log("🤖 Calling OpenAI...");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are an expert AI study planner and academic coach with deep knowledge of learning science, spaced repetition, cognitive load theory, and effective study strategies.

Your task is to create a comprehensive, personalized study plan that maximizes learning efficiency and student success.

CORE PRINCIPLES:
1. **Spaced Repetition**: Distribute similar topics across multiple days for better retention
2. **Interleaving**: Mix subjects strategically to enhance learning and prevent mental fatigue
3. **Progressive Difficulty**: Start with foundational concepts, build to complex topics
4. **Cognitive Load Management**: Balance study intensity throughout the week
5. **Active Recall Focus**: Structure sessions to promote active learning, not passive reading
6. **Realistic Time Management**: Account for mental fatigue and attention spans

STUDY SESSION STRUCTURE:
- Each study session should be 1.5-2.5 hours maximum
- Include variety within each day to maintain engagement
- Morning sessions: Complex, demanding subjects (Math, Physics)
- Afternoon sessions: Moderate difficulty subjects
- Evening sessions: Review, practice problems, or lighter topics

TASK NAMING BEST PRACTICES:
- Be specific and actionable: "Solve 20 quadratic equation problems" not just "Quadratic Equations"
- Include the learning method: "Watch + Notes:", "Practice:", "Review:", "Mock Test:"
- Make it measurable: Include problem counts, chapter numbers, or page ranges
- Examples:
  * "Algebra: Complete practice set on polynomials (Ch. 3, Q1-25)"
  * "Physics: Derive and understand Newton's Laws with 5 real-world examples"
  * "Chemistry: Memorize periodic table trends + 15 element properties"
  * "Review: Redo incorrectly answered problems from Week 1"

Additionally, for each task in "tasks", include a field: "completed": false

OUTPUT FORMAT:
Return ONLY valid JSON with this exact structure:

{
  "plan_metadata": {
    "total_days": number,
    "start_date": "DD/MM/YYYY",
    "exam_date": "DD/MM/YYYY",
    "total_study_hours": number,
    "subjects_count": number,
    "study_strategy": "Brief description of the overall approach taken"
  },
  "days": [
    {
      "day_number": number,
      "date": "DD/MM/YYYY",
      "day_name": "Monday|Tuesday|...",
      "is_break_day": boolean,
      "daily_focus": "Brief theme for the day",
      "total_tasks": number,
      "estimated_hours": number,
      "tasks": [
        {
          "id": "unique_id_string",
          "subject": "use the course_code or title from the input..which ever one that is provided",
          "topic": "Specific, actionable task description",
          "duration_minutes": number,
          "suggested_time": "HH:MM AM/PM",
          "difficulty_level": "Easy|Medium|Hard",
          "learning_method": "Video|Reading|Practice|Review|Mock Test",
          "priority": "High|Medium|Low",
          "completed": false
        }
      ],
      "break_reminders": [
        {
          "after_task_number": number,
          "duration_minutes": number,
          "activity_suggestion": "Stretch, walk, hydrate"
        }
      ],
      "daily_goal": "What the student should achieve by end of day"
    }
  ],
  "study_tips": [
    "Tip 1",
    "Tip 2",
    "Tip 3"
  ]
}

IMPORTANT: Keep the response concise. Limit to essential information only:
- Maximum 3 tasks per day
- Keep topic descriptions under 100 characters
- Limit study_tips to 3-5 items
- Remove optional fields like subtopics, resources_needed, success_criteria, review_previous, revision_schedule, weekly_milestones

RULES:
1. Calculate exact dates based on start date and duration
2. If "avoidWeekends" is true, mark Saturday/Sunday as break days
3. If "includeRevision" is true, dedicate last 20% of days to revision
4. If "includeBreaks" is true, add break reminders
5. Distribute daily hours according to specified range
6. Generate unique task IDs: "day{day_number}_task{task_number}"

Return ONLY the JSON object. No markdown formatting.`,
        },
        {
          role: "user",
          content: `
Create a personalized study plan with the following specifications:

STUDENT INPUTS:
- Exam Date: ${examDate}
- Plan Duration: ${duration} days
- Selected Subjects: ${subjects.join(", ")}
- Daily Study Hours: ${studyHours} hours
- Current Date (Start Date): ${new Date().toLocaleDateString("en-GB")}

AI CUSTOMIZATION OPTIONS:
- Include Revision Days: ${aiOptions.includeRevision ? "YES" : "NO"}
- Avoid Weekends: ${aiOptions.avoidWeekends ? "YES" : "NO"}
- Include Break Reminders: ${aiOptions.includeBreaks ? "YES" : "NO"}

Below are the summarized notes grouped by subject (course_code/title).
Each subject contains its topics and explanations.
Use the "subject" key in your output to reflect the subject (course_code/title) each task belongs to.
Use these to create a structured study plan where each task is grouped under its subject:
${noteSummaries}



Generate an optimal, CONCISE study plan. Keep it actionable and focused!`,
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

    let studyPlanData;
    try {
      studyPlanData = JSON.parse(cleaned);
      console.log("✅ JSON parsed successfully");
      console.log(
        "📊 Plan size:",
        JSON.stringify(studyPlanData).length,
        "characters"
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
    if (!studyPlanData.plan_metadata || !studyPlanData.days) {
      console.error("❌ Invalid study plan structure");
      return res.status(500).json({
        success: false,
        error: "Invalid study plan structure",
      });
    }

    console.log("💾 Inserting into Supabase...");

    // Helper function to convert DD/MM/YYYY to YYYY-MM-DD
    const convertDateFormat = (dateStr) => {
      const [day, month, year] = dateStr.split("/");
      return `${year}-${month}-${day}`;
    };

    // Convert exam_date to PostgreSQL format
    const formattedExamDate = convertDateFormat(
      studyPlanData.plan_metadata.exam_date
    );

    console.log(
      "📅 Converted date:",
      studyPlanData.plan_metadata.exam_date,
      "→",
      formattedExamDate
    );

    // Insert study plan
    const { data: plans, error: studyplanError } = await supabase
      .from("student_studyplans")
      .insert({
        user_id: userId,
        exam_date: formattedExamDate,
        duration_days: studyPlanData.plan_metadata.total_days,
        subjects: subjects,
        plan_name: planName,
        // note_ids: noteIds || [],
        study_hours_range: studyHours,
        plan_data: studyPlanData,
        completed: false,
        progress_percentage: 0,
      })
      .select()
      .single();

    if (studyplanError) {
      console.error("❌ Study plan insert error:", studyplanError);
      return res.status(500).json({
        success: false,
        error: "Failed to save study plan",
        details: studyplanError.message,
        code: studyplanError.code,
      });
    }

    console.log("✅ Study plan inserted, ID:", plans.id);

    // Prepare tasks for insertion
    const tasks = studyPlanData.days.flatMap((day) =>
      day.tasks.map((task) => ({
        study_plan_id: plans.id,
        day_number: day.day_number,
        task_id: task.id,
        subject: task.subject,
        topic: task.topic,
        duration_minutes: task.duration_minutes,
        suggested_time: task.suggested_time,
        completed: false,
      }))
    );

    console.log("💾 Inserting", tasks.length, "tasks...");

    const { error: tasksError } = await supabase
      .from("study_tasks")
      .insert(tasks);

    if (tasksError) {
      console.error("❌ Tasks insert error:", tasksError);
      console.warn("⚠️ Study plan saved but tasks failed to insert");
    } else {
      console.log("✅ All tasks inserted successfully");
    }

    console.log("🎉 Study plan generation complete!");

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
      plans,
      tasksInserted: !tasksError,
      taskCount: tasks.length,
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

export { router as summarizeNoteRoute };
