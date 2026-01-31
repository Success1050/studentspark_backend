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

dotenv.config();

const app = express();
app.use(express.json({ limit: "400mb" }));
app.use(cors());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
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

// app.use("/api", explainTopicRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
