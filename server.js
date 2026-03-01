import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { uploadNoteRoute } from "./AIRoutes/uploadpdfRoute.js";
import { summarizeNoteRoute } from "./AIRoutes/studyPlanRoute.js";
import { generatePracticeQuestionsRoute } from "./AIRoutes/uploadnotesforpqprediction.js";
import { generatequiz } from "./AIRoutes/uploadNotesForQuizGeneration.js";
import { motivationGen } from "./AIRoutes/motivationGen.js";
import { paystackPayment } from "./AIRoutes/paystackRoute.js";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "100mb" }));
app.use(cors());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 50, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: true, // Return the `X-RateLimit-*` headers
});

app.use(limiter);

// Mount all AI routes under a prefix (optional)
app.use("/api", uploadNoteRoute);
app.use("/api", summarizeNoteRoute);
app.use("/api", generatePracticeQuestionsRoute);
app.use("/api", generatequiz);
app.use("/api", motivationGen);
app.use("/api", paystackPayment);

// Supabase client with SERVICE ROLE
// Supabase client with SERVICE ROLE
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.SUPABASE_URL;

let supabaseAdmin;

if (serviceRoleKey && supabaseUrl) {
  supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
} else {
  console.warn(
    "⚠️ SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL is missing. Admin routes will fail."
  );
}

app.delete("/delete-account", async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({
      error: "Server configuration error: Missing Supabase Service Role Key",
    });
  }

  const token = req.headers.authorization?.split(" ")[1];

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const userId = user.id;
  try {
    // 1. Delete related data first
    await supabaseAdmin.from("profiles").delete().eq("user_id", userId);

    // 2. Delete auth user
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (error) throw error;

    res.json({ message: "Account deleted successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// app.use("/api", explainTopicRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
