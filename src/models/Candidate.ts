import { Schema, model, Types } from "mongoose";

export type CandidateDuplicateMatch = {
  candidate_id: string;
  candidate_name?: string | null;
  email?: string | null;
  job_id?: string | null;
  job_title?: string | null;
  status?: string | null;
  reasons: string[];
  similarity?: number | null;
  applied_for_another_job: boolean;
};

export type CandidateHiringRecommendation = {
  recommendation: "Strong Hire" | "Hire" | "Hold" | "Reject";
  confidence_score: number;
  strengths: string[];
  risks: string[];
  next_action: string;
  summary: string;
  generated_at: Date;
};

export type CandidateDocument = {
  id: string;
  job_id: Types.ObjectId;
  candidate_name?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  cv_url?: string | null;
  cv_mime?: string | null;
  cv_text?: string | null;
  ats_score?: number | null;
  skills_match_percent?: number | null;
  matched_skills: string[];
  missing_skills: string[];
  experience_relevance?: string | null;
  education_match?: string | null;
  recommendation?: string | null;
  summary?: string | null;
  status: string;
  interview_at?: Date | null;
  interview_type?: string | null;
  interviewer_name?: string | null;
  interview_panel_names: string[];
  interview_panel_emails: string[];
  meeting_link?: string | null;
  interview_notes?: string | null;
  duplicate_matches: CandidateDuplicateMatch[];
  ai_hiring_recommendation?: CandidateHiringRecommendation | null;
  created_at: Date;
};

const candidateDuplicateMatchSchema = new Schema<CandidateDuplicateMatch>(
  {
    candidate_id: String,
    candidate_name: String,
    email: String,
    job_id: String,
    job_title: String,
    status: String,
    reasons: { type: [String], default: [] },
    similarity: Number,
    applied_for_another_job: Boolean,
  },
  { _id: false },
);

const candidateSchema = new Schema<CandidateDocument>(
  {
    job_id: { type: Schema.Types.ObjectId, ref: "Job", required: true, index: true },
    candidate_name: String,
    email: { type: String, index: true },
    phone: { type: String, index: true },
    linkedin_url: { type: String, index: true },
    cv_url: String,
    cv_mime: String,
    cv_text: String,
    ats_score: Number,
    skills_match_percent: Number,
    matched_skills: { type: [String], default: [] },
    missing_skills: { type: [String], default: [] },
    experience_relevance: String,
    education_match: String,
    recommendation: String,
    summary: String,
    status: { type: String, default: "applied" },
    interview_at: Date,
    interview_type: String,
    interviewer_name: String,
    interview_panel_names: { type: [String], default: [] },
    interview_panel_emails: { type: [String], default: [] },
    meeting_link: String,
    interview_notes: String,
    duplicate_matches: { type: [candidateDuplicateMatchSchema], default: [] },
    ai_hiring_recommendation: {
      recommendation: String,
      confidence_score: Number,
      strengths: { type: [String], default: [] },
      risks: { type: [String], default: [] },
      next_action: String,
      summary: String,
      generated_at: Date,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        const obj = ret as Record<string, unknown>;
        delete obj._id;
        if (obj.job_id) obj.job_id = obj.job_id.toString();
        return obj;
      },
    },
  },
);

export const Candidate = model<CandidateDocument>("Candidate", candidateSchema);
