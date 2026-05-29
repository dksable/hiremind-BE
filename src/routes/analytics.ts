import { Router } from "express";
import { AuditLog } from "../models/AuditLog.js";
import { Candidate } from "../models/Candidate.js";
import { Job } from "../models/Job.js";
import { requireAuth } from "../middleware/auth.js";
import { isHiredStage, isInterviewStage, normalizePipelineStage } from "../services/pipeline.js";

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

function pct(value: number, total: number) {
  if (!total) return 0;
  return Number(((value / total) * 100).toFixed(1));
}

function daysBetween(start?: Date | null, end?: Date | null) {
  if (!start || !end) return null;
  const diff = end.getTime() - start.getTime();
  if (diff < 0) return null;
  return diff / (1000 * 60 * 60 * 24);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

analyticsRouter.get("/hr", async (_req, res) => {
  const [jobs, candidates, acceptedLogs] = await Promise.all([
    Job.find().sort({ created_at: -1 }),
    Candidate.find().sort({ created_at: -1 }),
    AuditLog.find({ action: { $in: ["Candidate CV Accepted", "Candidate Moved to Selected", "Candidate Moved to Hired", "Candidate Moved to Offer Sent"] } }).sort({ created_at: -1 }),
  ]);

  const totalCandidates = candidates.length;
  const accepted = candidates.filter((candidate) => isHiredStage(candidate.status)).length;
  const rejected = candidates.filter((candidate) => normalizePipelineStage(candidate.status) === "rejected").length;
  const scheduled = candidates.filter((candidate) => isInterviewStage(candidate.status)).length;
  const pending = candidates.filter((candidate) => ["applied", "screening", "on_hold"].includes(normalizePipelineStage(candidate.status))).length;
  const screened = candidates.filter((candidate) => typeof candidate.ats_score === "number").length;
  const averageAtsScore = totalCandidates
    ? Number((candidates.reduce((sum, candidate) => sum + (candidate.ats_score || 0), 0) / totalCandidates).toFixed(1))
    : 0;

  const acceptedLogByCandidateId = new Map<string, Date>();
  for (const log of acceptedLogs) {
    const id = log.path.match(/\/api\/candidates\/([^/?]+)/)?.[1];
    if (id && !acceptedLogByCandidateId.has(id)) acceptedLogByCandidateId.set(id, log.created_at);
  }

  const hireDurations = candidates
    .filter((candidate) => isHiredStage(candidate.status))
    .map((candidate) => daysBetween(candidate.created_at, acceptedLogByCandidateId.get(candidate.id) || null))
    .filter((duration): duration is number => duration !== null);

  const scheduleDurations = candidates
    .filter((candidate) => candidate.interview_at)
    .map((candidate) => daysBetween(candidate.created_at, candidate.interview_at || null))
    .filter((duration): duration is number => duration !== null);

  const durationSource = hireDurations.length ? hireDurations : scheduleDurations;
  const timeToHireDays = durationSource.length
    ? Number((durationSource.reduce((sum, duration) => sum + duration, 0) / durationSource.length).toFixed(1))
    : 0;

  const jobTitleById = new Map(jobs.map((job) => [job.id, job.title]));
  const hiringByJob = jobs.map((job) => {
    const jobCandidates = candidates.filter((candidate) => candidate.job_id.toString() === job.id);
    const jobAccepted = jobCandidates.filter((candidate) => isHiredStage(candidate.status)).length;
    const jobRejected = jobCandidates.filter((candidate) => normalizePipelineStage(candidate.status) === "rejected").length;
    return {
      job_id: job.id,
      title: job.title,
      candidates: jobCandidates.length,
      accepted: jobAccepted,
      rejected: jobRejected,
      average_ats_score: jobCandidates.length
        ? Number((jobCandidates.reduce((sum, candidate) => sum + (candidate.ats_score || 0), 0) / jobCandidates.length).toFixed(1))
        : 0,
    };
  });

  const statusBreakdown = [
    { status: "Pending", count: pending },
    { status: "Interview", count: scheduled },
    { status: "Hired", count: accepted },
    { status: "Rejected", count: rejected },
  ];

  const atsDistribution = [
    { range: "0-39", count: candidates.filter((candidate) => (candidate.ats_score || 0) < 40).length },
    { range: "40-69", count: candidates.filter((candidate) => (candidate.ats_score || 0) >= 40 && (candidate.ats_score || 0) < 70).length },
    { range: "70-100", count: candidates.filter((candidate) => (candidate.ats_score || 0) >= 70).length },
  ];

  const trendMap = new Map<string, { month: string; applications: number; hired: number; rejected: number; interviews: number }>();
  for (const candidate of candidates) {
    const key = monthKey(candidate.created_at);
    const row = trendMap.get(key) || { month: key, applications: 0, hired: 0, rejected: 0, interviews: 0 };
    row.applications += 1;
    if (isHiredStage(candidate.status)) row.hired += 1;
    if (normalizePipelineStage(candidate.status) === "rejected") row.rejected += 1;
    if (isInterviewStage(candidate.status)) row.interviews += 1;
    trendMap.set(key, row);
  }

  res.json({
    overview: {
      total_hiring: accepted,
      total_candidates: totalCandidates,
      total_jobs: jobs.length,
      rejection_percent: pct(rejected, totalCandidates),
      average_ats_score: averageAtsScore,
      interview_conversion_rate: pct(scheduled + accepted, totalCandidates),
      time_to_hire_days: timeToHireDays,
      time_to_hire_source: hireDurations.length ? "accepted_audit" : "interview_schedule",
    },
    funnel: [
      { stage: "Applied", count: totalCandidates },
      { stage: "Screened", count: screened },
      { stage: "Interview", count: scheduled + accepted },
      { stage: "Hired", count: accepted },
      { stage: "Rejected", count: rejected },
    ],
    status_breakdown: statusBreakdown,
    ats_distribution: atsDistribution,
    monthly_trend: Array.from(trendMap.values()).sort((a, b) => a.month.localeCompare(b.month)).slice(-6),
    hiring_by_job: hiringByJob,
    recent_hires: candidates
      .filter((candidate) => isHiredStage(candidate.status))
      .slice(0, 5)
      .map((candidate) => ({
        id: candidate.id,
        candidate_name: candidate.candidate_name || "Candidate",
        email: candidate.email || null,
        job_title: jobTitleById.get(candidate.job_id.toString()) || "Job",
        ats_score: candidate.ats_score || 0,
      })),
  });
});
