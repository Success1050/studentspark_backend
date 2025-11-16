import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { uploadNoteRoute } from "./AIRoutes/uploadpdfRoute.js";
import { summarizeNoteRoute } from "./AIRoutes/studyPlanRoute.js";
import { generatePracticeQuestionsRoute } from "./AIRoutes/uploadnotesforpqprediction.js";
import { generatequiz } from "./AIRoutes/uploadNotesForQuizGeneration.js";
import { motivationGen } from "./AIRoutes/motivationGen.js";
import { paystackPayment } from "./AIRoutes/paystackRoute.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "400mb" }));
app.use(cors());

// Mount all AI routes under a prefix (optional)
app.use("/api", uploadNoteRoute);
app.use("/api", summarizeNoteRoute);
app.use("/api", generatePracticeQuestionsRoute);
app.use("/api", generatequiz);
app.use("/api", motivationGen);
app.use("/api", paystackPayment);

// app.use("/api", explainTopicRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
