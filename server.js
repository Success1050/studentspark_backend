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
import cors from "cors";
import dotenv from "dotenv";
import { uploadNoteRoute } from "./AIRoutes/uploadpdfRoute.js";
import { summarizeNoteRoute } from "./AIRoutes/studyPlanRoute.js";
import { generatePracticeQuestionsRoute } from "./AIRoutes/uploadnotesforpqprediction.js";
import { generatequiz } from "./AIRoutes/uploadNotesForQuizGeneration.js";
import { motivationGen } from "./AIRoutes/motivationGen.js";
import { paystackPayment } from "./AIRoutes/paystackRoute.js";

// import { createCanvas } from "canvas";

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
