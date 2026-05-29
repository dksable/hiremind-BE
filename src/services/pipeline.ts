export const PIPELINE_STAGES = [
  "applied",
  "screening",
  "shortlisted",
  "interview_round_1",
  "interview_round_2",
  "technical_round",
  "hr_round",
  "selected",
  "rejected",
  "on_hold",
  "offer_sent",
  "hired",
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number];

export const PIPELINE_STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "Screening",
  shortlisted: "Shortlisted",
  interview_round_1: "Interview Round 1",
  interview_round_2: "Interview Round 2",
  technical_round: "Technical Round",
  hr_round: "HR Round",
  selected: "Selected",
  rejected: "Rejected",
  on_hold: "On Hold",
  offer_sent: "Offer Sent",
  hired: "Hired",
  pending: "Applied",
  accepted: "Shortlisted",
  scheduled: "Interview Round 1",
};

export function normalizePipelineStage(status?: string | null) {
  if (status === "pending") return "applied";
  if (status === "accepted") return "shortlisted";
  if (status === "scheduled") return "interview_round_1";
  if (status && PIPELINE_STAGES.includes(status as PipelineStage)) return status;
  return "applied";
}

export function pipelineStageLabel(status?: string | null) {
  return PIPELINE_STAGE_LABELS[normalizePipelineStage(status)] || "Applied";
}

export function isInterviewStage(status?: string | null) {
  const normalized = normalizePipelineStage(status);
  return ["interview_round_1", "interview_round_2", "technical_round", "hr_round"].includes(normalized);
}

export function isHiredStage(status?: string | null) {
  const normalized = normalizePipelineStage(status);
  return normalized === "selected" || normalized === "hired" || normalized === "offer_sent";
}
