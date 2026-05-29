import { Router } from "express";
import { requireAuth, requireEditor } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { screenCv } from "../services/openai.js";
import { auditAction } from "../services/audit.js";

export const screenRouter = Router();
const aiRateLimit = rateLimit({
  windowMs: Number(process.env.AI_RATE_LIMIT_WINDOW_MS || 60 * 1000),
  max: Number(process.env.AI_RATE_LIMIT_MAX || 30),
  message: "Too many AI screening requests. Please try again shortly.",
});

screenRouter.use(requireAuth);
screenRouter.use(auditAction("screening"));

screenRouter.post("/", aiRateLimit, requireEditor, async (req, res) => {
  try {
    const { jobDescription, cvText } = req.body;
    if (!jobDescription || !cvText) return res.status(400).json({ error: "jobDescription and cvText are required" });
    const analysis = await screenCv(jobDescription, cvText);
    res.json(analysis);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "AI screening failed" });
  }
});
