import type { InterviewRecommendation, InterviewSkillRating } from "../models/CandidateReview.js";

export function normalizeSkillRatings(input: unknown): InterviewSkillRating[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const value = item as Record<string, unknown>;
      const skill = String(value.skill || "").trim();
      const rating = Number(value.rating);
      if (!skill || Number.isNaN(rating)) return null;
      return { skill, rating: Math.min(Math.max(rating, 0), 10) };
    })
    .filter((item): item is InterviewSkillRating => Boolean(item));
}

export function overallInterviewScore(skillRatings: InterviewSkillRating[]) {
  if (skillRatings.length === 0) return 0;
  return Number((skillRatings.reduce((sum, item) => sum + item.rating, 0) / skillRatings.length).toFixed(1));
}

export function recommendationForScore(score: number): InterviewRecommendation {
  if (score >= 8.5) return "Strong Hire";
  if (score >= 7) return "Hire";
  if (score >= 5.5) return "Hold";
  return "Reject";
}

export function starRatingFromScore(score: number) {
  return Math.max(1, Math.round(score / 2));
}
