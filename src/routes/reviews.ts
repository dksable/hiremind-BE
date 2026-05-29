import { Router } from "express";
import { requireAuth, requireEditor } from "../middleware/auth.js";
import { CandidateReview } from "../models/CandidateReview.js";
import { auditAction } from "../services/audit.js";
import { normalizeSkillRatings, overallInterviewScore, recommendationForScore, starRatingFromScore } from "../services/interviewFeedback.js";

type ReviewParams = { id: string; reviewId?: string };

export const reviewsRouter = Router({ mergeParams: true });

reviewsRouter.use(requireAuth);
reviewsRouter.use(auditAction("candidate_reviews"));

reviewsRouter.get("/", async (req, res) => {
  const { id } = req.params as ReviewParams;
  const reviews = await CandidateReview.find({ candidate_id: id }).sort({ created_at: -1 });
  res.json(reviews);
});

reviewsRouter.post("/", requireEditor, async (req, res) => {
  const { id } = req.params as ReviewParams;
  const { reviewer_name, reviewer_email, interview_round, notes } = req.body;
  const skill_ratings = normalizeSkillRatings(req.body.skill_ratings);
  if (!reviewer_name) return res.status(400).json({ error: "reviewer_name is required" });
  if (skill_ratings.length === 0) return res.status(400).json({ error: "At least one skill rating is required" });

  const overall_score = overallInterviewScore(skill_ratings);
  const rating = starRatingFromScore(overall_score);
  const recommendation = recommendationForScore(overall_score);

  const review = await CandidateReview.create({
    candidate_id: id,
    reviewer_name,
    reviewer_email: reviewer_email || null,
    interview_round: interview_round || "Interview",
    skill_ratings,
    rating,
    overall_score,
    recommendation,
    notes: notes || null,
  });
  res.status(201).json(review);
});

reviewsRouter.delete("/:reviewId", requireEditor, async (req, res) => {
  const { id, reviewId } = req.params as ReviewParams;
  await CandidateReview.findOneAndDelete({ _id: reviewId, candidate_id: id });
  res.status(204).end();
});
