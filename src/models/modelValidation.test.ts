import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { CandidateReview } from "./CandidateReview.js";
import { Job } from "./Job.js";

describe("model validation", () => {
  it("accepts valid job current position statuses", async () => {
    const job = new Job({
      title: "Frontend Engineer",
      description: "Build product UI",
      current_position_status: "on_hold",
    });

    await assert.doesNotReject(() => job.validate());
  });

  it("rejects invalid job current position statuses", async () => {
    const job = new Job({
      title: "Frontend Engineer",
      description: "Build product UI",
      current_position_status: "paused",
    });

    await assert.rejects(() => job.validate(), /current_position_status/);
  });

  it("validates structured interview panel feedback", async () => {
    const review = new CandidateReview({
      candidate_id: new Types.ObjectId(),
      reviewer_name: "Jane Interviewer",
      reviewer_email: "jane@example.com",
      interview_round: "Technical Round",
      skill_ratings: [
        { skill: "React", rating: 9 },
        { skill: "System Design", rating: 8 },
      ],
      rating: 4,
      overall_score: 8.5,
      recommendation: "Strong Hire",
      notes: "Strong frontend depth.",
    });

    await assert.doesNotReject(() => review.validate());
  });

  it("rejects panel feedback with out-of-range skill ratings", async () => {
    const review = new CandidateReview({
      candidate_id: new Types.ObjectId(),
      reviewer_name: "Jane Interviewer",
      interview_round: "Technical Round",
      skill_ratings: [{ skill: "React", rating: 11 }],
      rating: 4,
      overall_score: 8.5,
      recommendation: "Strong Hire",
    });

    await assert.rejects(() => review.validate(), /skill_ratings/);
  });
});
