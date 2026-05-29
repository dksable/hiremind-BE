import path from "node:path";
import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import multer from "multer";
import type { FilterQuery, SortOrder } from "mongoose";
import { requireAuth, requireEditor } from "../middleware/auth.js";
import { AuditLog } from "../models/AuditLog.js";
import { Candidate, type CandidateDocument } from "../models/Candidate.js";
import { CandidateNote } from "../models/CandidateNote.js";
import { CandidateReview } from "../models/CandidateReview.js";
import { sendCandidateStatusEmail } from "../services/email.js";
import { writeAuditLog } from "../services/audit.js";
import { extractLinkedIn, extractPhone, findCandidateDuplicates, normalizeEmail } from "../services/duplicates.js";
import { isInterviewStage, normalizePipelineStage, pipelineStageLabel } from "../services/pipeline.js";
import { generateHiringRecommendation } from "../services/openai.js";
import { Job } from "../models/Job.js";
import { createProviderMeeting } from "../services/calendarProviders.js";
import type { CalendarProvider } from "../models/CalendarIntegration.js";

const uploadDir = path.resolve(process.env.UPLOAD_DIR || "src/uploads");
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
});
const upload = multer({ storage });

export const candidatesRouter = Router();

// CV files use unguessable UUID filenames and are loaded by iframes, which cannot attach bearer tokens.
candidatesRouter.get("/file/:filename", (req, res) => {
  res.sendFile(path.join(uploadDir, path.basename(req.params.filename)));
});

candidatesRouter.use(requireAuth);

function asJson(value: unknown) {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return value;
}

function candidateFilter(req: Request) {
  const jobId = req.query.jobId as string | undefined;
  const status = req.query.status as string | undefined;
  const search = (req.query.search as string | undefined)?.trim();
  const filter: FilterQuery<CandidateDocument> = {};

  if (jobId) filter.job_id = jobId;
  if (status && status !== "all") {
    const legacyStatusMap: Record<string, string[]> = {
      applied: ["applied", "pending"],
      shortlisted: ["shortlisted", "accepted"],
      interview_round_1: ["interview_round_1", "scheduled"],
    };
    filter.status = legacyStatusMap[status] ? { $in: legacyStatusMap[status] } : status;
  }
  if (search) {
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { candidate_name: pattern },
      { email: pattern },
      { phone: pattern },
      { linkedin_url: pattern },
      { matched_skills: pattern },
      { missing_skills: pattern },
      { cv_text: pattern },
      { summary: pattern },
    ];
  }

  return filter;
}

function candidateSort(req: Request) {
  const sortBy = String(req.query.sortBy || "ats_score");
  const sortOrder: SortOrder = req.query.sortOrder === "asc" ? 1 : -1;
  const sortFields: Record<string, string> = {
    ats_score: "ats_score",
    skills_match_percent: "skills_match_percent",
    candidate_name: "candidate_name",
    created_at: "created_at",
    status: "status",
    recommendation: "recommendation",
  };
  const field = sortFields[sortBy] || "ats_score";
  return { [field]: sortOrder, created_at: -1 as SortOrder };
}

candidatesRouter.get("/summary", async (_req, res) => {
  const [total, accepted, rejected, scheduled, pending, byJob] = await Promise.all([
    Candidate.countDocuments(),
    Candidate.countDocuments({ status: { $in: ["accepted", "shortlisted", "selected", "offer_sent", "hired"] } }),
    Candidate.countDocuments({ status: "rejected" }),
    Candidate.countDocuments({ status: { $in: ["scheduled", "interview_round_1", "interview_round_2", "technical_round", "hr_round"] } }),
    Candidate.countDocuments({ status: { $in: ["pending", "applied", "screening", "on_hold"] } }),
    Candidate.aggregate([
      { $group: { _id: "$job_id", count: { $sum: 1 } } },
      { $project: { _id: 0, job_id: { $toString: "$_id" }, count: 1 } },
    ]),
  ]);

  res.json({ total, accepted, rejected, scheduled, pending, byJob });
});

candidatesRouter.get("/", async (req, res) => {
  const filter = candidateFilter(req);
  const sort = candidateSort(req);
  const page = Math.max(Number(req.query.page || 0), 0);
  const limit = Math.min(Math.max(Number(req.query.limit || 0), 0), 100);

  if (page && limit) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      Candidate.find(filter).sort(sort).skip(skip).limit(limit),
      Candidate.countDocuments(filter),
    ]);
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    return res.json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    });
  }

  const candidates = await Candidate.find(filter).sort(sort);
  res.json(candidates);
});

candidatesRouter.post("/", requireEditor, upload.single("cv"), async (req, res) => {
  const body = req.body;
  if (!body.job_id) return res.status(400).json({ error: "job_id is required" });
  const cvUrl = req.file ? `/api/candidates/file/${req.file.filename}` : body.cv_url || null;
  const cvMime = req.file?.mimetype || body.cv_mime || null;
  const cvText = body.cv_text || null;
  const email = normalizeEmail(body.email);
  const phone = body.phone || extractPhone(cvText);
  const linkedinUrl = body.linkedin_url || extractLinkedIn(cvText);
  const duplicateMatches = await findCandidateDuplicates({
    jobId: body.job_id,
    email,
    phone,
    linkedinUrl,
    cvText,
  });
  const candidate = await Candidate.create({
    job_id: body.job_id,
    candidate_name: body.candidate_name || null,
    email,
    phone,
    linkedin_url: linkedinUrl,
    cv_url: cvUrl,
    cv_mime: cvMime,
    cv_text: cvText,
    ats_score: body.ats_score ? Math.round(Number(body.ats_score)) : null,
    skills_match_percent: body.skills_match_percent ? Math.round(Number(body.skills_match_percent)) : null,
    matched_skills: asJson(body.matched_skills),
    missing_skills: asJson(body.missing_skills),
    experience_relevance: body.experience_relevance || null,
    education_match: body.education_match || null,
    recommendation: body.recommendation || null,
    summary: body.summary || null,
    status: body.status || "applied",
    duplicate_matches: duplicateMatches,
  });
  await writeAuditLog(req, {
    action: "Candidate CV Created",
    resource: "candidates",
    status_code: 201,
    created_value: null,
    updated_value: {
      candidate_name: candidate.candidate_name,
      status: candidate.status,
    },
  }).catch((error) => console.error("Failed to write audit log", error));
  res.status(201).json(candidate);
});

candidatesRouter.patch("/:id", requireEditor, async (req, res) => {
  const allowed = [
    "candidate_name",
    "email",
    "phone",
    "linkedin_url",
    "cv_text",
    "ats_score",
    "skills_match_percent",
    "matched_skills",
    "missing_skills",
    "experience_relevance",
    "education_match",
    "recommendation",
    "summary",
    "status",
    "interview_at",
    "interview_type",
    "interviewer_name",
    "interview_panel_names",
    "interview_panel_emails",
    "meeting_provider",
    "meeting_link",
    "interview_notes",
  ];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const isJson = key === "matched_skills" || key === "missing_skills" || key === "interview_panel_names" || key === "interview_panel_emails";
      patch[key] = isJson ? asJson(req.body[key]) : req.body[key];
    }
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: "No fields to update" });
  const existingCandidate = await Candidate.findById(req.params.id);
  if (!existingCandidate) return res.status(404).json({ error: "Candidate not found" });
  const previousCandidate = { status: existingCandidate.status };
  const nextStatus = typeof patch.status === "string" ? patch.status : existingCandidate.status;
  const normalizedNextStatus = normalizePipelineStage(nextStatus);
  const meetingProvider = patch.meeting_provider === "google" || patch.meeting_provider === "microsoft"
    ? patch.meeting_provider as CalendarProvider
    : null;

  if (meetingProvider && isInterviewStage(normalizedNextStatus) && !patch.meeting_link) {
    const interviewAt = patch.interview_at ? new Date(String(patch.interview_at)) : existingCandidate.interview_at;
    if (!interviewAt || Number.isNaN(interviewAt.getTime())) {
      return res.status(400).json({ error: "Valid interview_at is required to create an online meeting" });
    }
    const job = await Job.findById(existingCandidate.job_id).select("title");
    const panelNames = Array.isArray(patch.interview_panel_names) ? patch.interview_panel_names as string[] : existingCandidate.interview_panel_names || [];
    const panelEmails = Array.isArray(patch.interview_panel_emails) ? patch.interview_panel_emails as string[] : existingCandidate.interview_panel_emails || [];
    const attendees = [
      existingCandidate.email ? { name: existingCandidate.candidate_name || "Candidate", email: existingCandidate.email } : null,
      ...panelEmails.map((email, index) => ({ name: panelNames[index] || email, email })),
    ].filter((item): item is { name: string; email: string } => Boolean(item?.email));
    const stageLabel = pipelineStageLabel(normalizedNextStatus);
    const meetingLink = await createProviderMeeting({
      userId: req.user!.id,
      provider: meetingProvider,
      subject: `${stageLabel}: ${job?.title || "Interview"}`,
      description: `${existingCandidate.candidate_name || "Candidate"} interview${patch.interview_notes ? `\n\n${patch.interview_notes}` : ""}`,
      startsAt: interviewAt,
      attendees,
    });
    if (!meetingLink) return res.status(502).json({ error: "Calendar provider did not return a meeting link" });
    patch.meeting_link = meetingLink;
  }
  delete patch.meeting_provider;

  const candidate = await Candidate.findByIdAndUpdate(req.params.id, patch, { new: true });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  if (patch.status) {
    try {
      await sendCandidateStatusEmail({ candidate, previousStatus: previousCandidate?.status });
    } catch (error) {
      console.error("Failed to send candidate status email", error);
      if (isInterviewStage(normalizePipelineStage(candidate.status))) {
        return res.status(502).json({
          error: error instanceof Error
            ? `Interview was saved, but email sending failed: ${error.message}`
            : "Interview was saved, but email sending failed",
        });
      }
    }
  }
  const action = patch.status === "accepted" || patch.status === "shortlisted" || patch.status === "selected" || patch.status === "offer_sent" || patch.status === "hired"
    ? `Candidate Moved to ${pipelineStageLabel(String(patch.status))}`
    : patch.status === "rejected"
      ? "Candidate CV Rejected"
      : patch.status === "scheduled" || patch.status === "interview_round_1" || patch.status === "interview_round_2" || patch.status === "technical_round" || patch.status === "hr_round"
        ? `Candidate Moved to ${pipelineStageLabel(String(patch.status))}`
        : "Candidate CV Updated";
  await writeAuditLog(req, {
    action,
    resource: "candidates",
    status_code: 200,
    created_value: {
      name: candidate.candidate_name,
      status: previousCandidate?.status || null,
    },
    updated_value: {
      name: candidate.candidate_name,
      status: candidate.status,
    },
  }).catch((error) => console.error("Failed to write audit log", error));
  res.json(candidate);
});

candidatesRouter.post("/:id/recommendation", requireEditor, async (req, res) => {
  const candidate = await Candidate.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const [job, notes, reviews] = await Promise.all([
    Job.findById(candidate.job_id).select("title description"),
    CandidateNote.find({ candidate_id: candidate.id }).sort({ created_at: -1 }).limit(10),
    CandidateReview.find({ candidate_id: candidate.id }).sort({ created_at: -1 }).limit(10),
  ]);

  const context = [
    `JOB TITLE:\n${job?.title || "Unknown"}`,
    `JOB DESCRIPTION:\n${job?.description || ""}`,
    `CANDIDATE:\nName: ${candidate.candidate_name || "Unknown"}\nEmail: ${candidate.email || "Unknown"}\nStage: ${pipelineStageLabel(candidate.status)}`,
    `ATS:\nATS Score: ${candidate.ats_score ?? "N/A"}\nSkills Match: ${candidate.skills_match_percent ?? "N/A"}\nRecommendation: ${candidate.recommendation || "N/A"}`,
    `MATCHED SKILLS:\n${candidate.matched_skills.join(", ") || "None"}`,
    `MISSING SKILLS:\n${candidate.missing_skills.join(", ") || "None"}`,
    `EXPERIENCE:\n${candidate.experience_relevance || "N/A"}`,
    `EDUCATION:\n${candidate.education_match || "N/A"}`,
    `SUMMARY:\n${candidate.summary || "N/A"}`,
    `INTERVIEW:\n${candidate.interview_at ? `${candidate.interview_type || "Interview"} at ${candidate.interview_at.toISOString()}. ${candidate.interview_notes || ""}` : "No interview scheduled"}`,
    `INTERNAL NOTES:\n${notes.map((note) => `- ${note.author_name}: ${note.note}`).join("\n") || "None"}`,
    `INTERVIEW PANEL FEEDBACK:\n${reviews.map((review) => {
      const skillRatings = review.skill_ratings?.length
        ? review.skill_ratings.map((item) => `${item.skill}: ${item.rating}/10`).join(", ")
        : `Rating: ${review.rating}/5`;
      return `- ${review.reviewer_name} (${review.interview_round || "Interview"}): overall ${review.overall_score ?? review.rating * 2}/10, recommendation ${review.recommendation || "Hold"}. Skills: ${skillRatings}. Notes: ${review.notes || "None"}`;
    }).join("\n") || "None"}`,
    `CV TEXT EXCERPT:\n${(candidate.cv_text || "").slice(0, 5000)}`,
  ].join("\n\n");

  const recommendation = await generateHiringRecommendation(context);
  const aiRecommendation = {
    ...recommendation,
    confidence_score: Math.round(Number(recommendation.confidence_score || 0)),
    generated_at: new Date(),
  };
  candidate.ai_hiring_recommendation = aiRecommendation;
  await candidate.save();

  await writeAuditLog(req, {
    action: "AI Hiring Recommendation Generated",
    resource: "candidates",
    status_code: 200,
    created_value: null,
    updated_value: {
      candidate_name: candidate.candidate_name,
      recommendation: aiRecommendation.recommendation,
      confidence_score: aiRecommendation.confidence_score,
    },
  }).catch((error) => console.error("Failed to write audit log", error));

  res.json(aiRecommendation);
});

candidatesRouter.delete("/:id", requireEditor, async (req, res) => {
  const candidate = await Candidate.findById(req.params.id).select("candidate_name email status ats_score");
  await CandidateNote.deleteMany({ candidate_id: req.params.id });
  await CandidateReview.deleteMany({ candidate_id: req.params.id });
  await Candidate.findByIdAndDelete(req.params.id);
  await writeAuditLog(req, {
    action: "Candidate CV Deleted",
    resource: "candidates",
    status_code: 204,
    created_value: candidate ? {
      id: candidate.id,
      candidate_name: candidate.candidate_name,
      email: candidate.email,
      status: candidate.status,
      ats_score: candidate.ats_score,
    } : { id: req.params.id },
    updated_value: null,
  }).catch((error) => console.error("Failed to write audit log", error));
  res.status(204).end();
});

candidatesRouter.get("/:id/timeline", async (req, res) => {
  const candidate = await Candidate.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const [notes, reviews, audits] = await Promise.all([
    CandidateNote.find({ candidate_id: req.params.id }).sort({ created_at: -1 }),
    CandidateReview.find({ candidate_id: req.params.id }).sort({ created_at: -1 }),
    AuditLog.find({
      resource: "candidates",
      path: { $regex: `/api/candidates/${req.params.id}(?:$|[/?])` },
    }).sort({ created_at: -1 }),
  ]);

  const events: Array<{
    type: string;
    title: string;
    detail: string;
    date: Date;
    actor_name?: string | null;
    actor_email?: string | null;
  }> = [];

  events.push({
    type: "candidate_applied",
    title: "Candidate Applied",
    detail: candidate.candidate_name || candidate.email || "Candidate profile created",
    date: candidate.created_at,
  });

  if (candidate.ats_score !== null && candidate.ats_score !== undefined) {
    events.push({
      type: "ai_screened",
      title: "AI Screened",
      detail: `ATS ${candidate.ats_score || 0}% · Skills ${candidate.skills_match_percent || 0}%`,
      date: candidate.created_at,
    });
  }

  if (candidate.ai_hiring_recommendation?.generated_at) {
    events.push({
      type: "ai_recommendation_generated",
      title: "AI Recommendation Generated",
      detail: `${candidate.ai_hiring_recommendation.recommendation} · ${candidate.ai_hiring_recommendation.confidence_score}% confidence`,
      date: candidate.ai_hiring_recommendation.generated_at,
    });
  }

  for (const audit of audits) {
    if (audit.action === "AI Hiring Recommendation Generated") continue;
    const updated = audit.updated_value as Record<string, unknown> | null | undefined;
    const created = audit.created_value as Record<string, unknown> | null | undefined;
    const newStatus = typeof updated?.status === "string" ? updated.status : null;
    const oldStatus = typeof created?.status === "string" ? created.status : null;
    const normalized = normalizePipelineStage(newStatus);
    const type = normalized === "offer_sent"
      ? "offer_sent"
      : normalized === "hired"
        ? "candidate_hired"
        : normalized && ["interview_round_1", "interview_round_2", "technical_round", "hr_round"].includes(normalized)
          ? "interview_scheduled"
          : newStatus
            ? "status_changed"
            : "status_changed";
    const stageTitle = newStatus ? pipelineStageLabel(newStatus) : null;

    events.push({
      type,
      title: type === "offer_sent"
        ? "Offer Sent"
        : type === "candidate_hired"
          ? "Candidate Hired"
          : stageTitle
            ? `Moved to ${stageTitle}`
            : audit.action,
      detail: newStatus
        ? `Status changed from ${oldStatus ? pipelineStageLabel(oldStatus) : "—"} to ${stageTitle}`
        : audit.action,
      date: audit.created_at,
      actor_name: audit.actor_name,
      actor_email: audit.actor_email,
    });
  }

  if (candidate.interview_at) {
    events.push({
      type: "interview_scheduled",
      title: "Interview Scheduled",
      detail: `${candidate.interview_type || pipelineStageLabel(candidate.status)}${candidate.interviewer_name ? ` with ${candidate.interviewer_name}` : ""}`,
      date: candidate.interview_at,
    });
  }

  for (const review of reviews) {
    events.push({
      type: "review_added",
      title: "Review Added",
      detail: `${review.rating}/5 · ${review.notes || "No notes"}`,
      date: review.created_at,
      actor_name: review.reviewer_name,
      actor_email: review.reviewer_email,
    });
  }

  for (const note of notes) {
    events.push({
      type: "note_added",
      title: "Note Added",
      detail: note.note,
      date: note.created_at,
      actor_name: note.author_name,
      actor_email: note.author_email,
    });
  }

  res.json(events.sort((a, b) => b.date.getTime() - a.date.getTime()));
});

candidatesRouter.get("/:id/cv", async (req, res) => {
  const candidate = await Candidate.findById(req.params.id).select("cv_url");
  const cvUrl = candidate?.cv_url;
  if (!cvUrl) return res.status(404).json({ error: "CV not found" });
  const filename = cvUrl.split("/").pop();
  if (!filename) return res.status(404).json({ error: "CV not found" });
  res.sendFile(path.join(uploadDir, filename));
});
