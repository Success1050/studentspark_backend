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
import dayjs from "dayjs";

const router = express.Router();

router.post("/verify-paystack", async (req, res) => {
  const { reference, userId, amount, selectedPlan, billingCycle } = req.body;
  // billingCycle = "monthly" | "yearly"

  if (!reference || !userId || !amount || !selectedPlan || !billingCycle) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // 1. Verify payment with Paystack
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();

    if (!data.status || data.data.status !== "success") {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    // 2. Subscription dates
    const startDate = dayjs();
    let endDate;

    if (billingCycle === "monthly") {
      endDate = startDate.add(1, "month");
    } else if (billingCycle === "yearly") {
      endDate = startDate.add(1, "year");
    } else {
      return res.status(400).json({ error: "Invalid billing cycle" });
    }

    // 3. Update user profile
    const { error } = await supabase
      .from("profiles")
      .update({
        plan: selectedPlan,
        subscription_start: startDate.toISOString(),
        subscription_end: endDate.toISOString(),
      })
      .eq("user_id", userId);

    if (error) throw error;

    return res.json({
      success: true,
      message: `Payment verified! You are now subscribed to the ${selectedPlan} (${billingCycle}) plan until ${endDate.format(
        "DD MMM YYYY"
      )}`,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export { router as paystackPayment };
