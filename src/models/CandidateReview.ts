import { Schema, model, Types } from "mongoose";

export type InterviewSkillRating = {
  skill: string;
  rating: number;
};

export type InterviewRecommendation = "Strong Hire" | "Hire" | "Hold" | "Reject";

export type CandidateReviewDocument = {
  id: string;
  candidate_id: Types.ObjectId;
  reviewer_name: string;
  reviewer_email?: string | null;
  interview_round: string;
  skill_ratings: InterviewSkillRating[];
  rating: number;
  overall_score: number;
  recommendation: InterviewRecommendation;
  notes?: string | null;
  created_at: Date;
};

const candidateReviewSchema = new Schema<CandidateReviewDocument>(
  {
    candidate_id: { type: Schema.Types.ObjectId, ref: "Candidate", required: true, index: true },
    reviewer_name: { type: String, required: true },
    reviewer_email: String,
    interview_round: { type: String, required: true, default: "Interview" },
    skill_ratings: [{
      skill: { type: String, required: true },
      rating: { type: Number, required: true, min: 0, max: 10 },
    }],
    rating: { type: Number, required: true, min: 1, max: 5 },
    overall_score: { type: Number, required: true, min: 0, max: 10 },
    recommendation: {
      type: String,
      enum: ["Strong Hire", "Hire", "Hold", "Reject"],
      required: true,
    },
    notes: String,
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        const obj = ret as Record<string, unknown>;
        delete obj._id;
        if (obj.candidate_id) obj.candidate_id = obj.candidate_id.toString();
        return obj;
      },
    },
  },
);

export const CandidateReview = model<CandidateReviewDocument>("CandidateReview", candidateReviewSchema);
