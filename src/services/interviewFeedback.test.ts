import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeSkillRatings,
  overallInterviewScore,
  recommendationForScore,
  starRatingFromScore,
} from "./interviewFeedback.js";

describe("interview feedback scoring", () => {
  it("normalizes dynamic skill ratings and clamps scores to the 0-10 range", () => {
    const ratings = normalizeSkillRatings([
      { skill: " React ", rating: 12 },
      { skill: "Communication", rating: -2 },
      { skill: "", rating: 8 },
      { skill: "DSA", rating: "7" },
      { skill: "Ignored", rating: "bad" },
    ]);

    assert.deepEqual(ratings, [
      { skill: "React", rating: 10 },
      { skill: "Communication", rating: 0 },
      { skill: "DSA", rating: 7 },
    ]);
  });

  it("calculates the overall interview score to one decimal place", () => {
    const score = overallInterviewScore([
      { skill: "Communication", rating: 8 },
      { skill: "DSA", rating: 7 },
      { skill: "React", rating: 9 },
      { skill: "Culture Fit", rating: 6 },
    ]);

    assert.equal(score, 7.5);
  });

  it("maps overall scores to hiring recommendations", () => {
    assert.equal(recommendationForScore(9), "Strong Hire");
    assert.equal(recommendationForScore(7.1), "Hire");
    assert.equal(recommendationForScore(5.5), "Hold");
    assert.equal(recommendationForScore(5.4), "Reject");
  });

  it("derives a legacy 1-5 star rating from the 10-point score", () => {
    assert.equal(starRatingFromScore(9), 5);
    assert.equal(starRatingFromScore(7), 4);
    assert.equal(starRatingFromScore(1), 1);
    assert.equal(starRatingFromScore(0), 1);
  });
});
