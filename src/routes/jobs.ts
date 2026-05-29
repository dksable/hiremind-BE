import { Router } from "express";
import { requireAuth, requireEditor } from "../middleware/auth.js";
import { Candidate } from "../models/Candidate.js";
import { CandidateNote } from "../models/CandidateNote.js";
import { CandidateReview } from "../models/CandidateReview.js";
import { JOB_POSITION_STATUSES, Job } from "../models/Job.js";
import { writeAuditLog } from "../services/audit.js";

export const jobsRouter = Router();

jobsRouter.use(requireAuth);

jobsRouter.get("/", async (_req, res) => {
  const jobs = await Job.find().sort({ created_at: -1 });
  res.json(jobs);
});

jobsRouter.post("/", requireEditor, async (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) return res.status(400).json({ error: "title and description are required" });
  const job = await Job.create({ title, description });
  await writeAuditLog(req, {
    action: "Job Created",
    resource: "jobs",
    status_code: 201,
    created_value: null,
    updated_value: {
      title: job.title,
    },
  }).catch((error) => console.error("Failed to write audit log", error));
  res.status(201).json(job);
});

jobsRouter.patch("/:id", requireEditor, async (req, res) => {
  const { current_position_status } = req.body;
  if (!JOB_POSITION_STATUSES.includes(current_position_status)) {
    return res.status(400).json({ error: "Invalid current position status" });
  }

  const previousJob = await Job.findById(req.params.id).select("title current_position_status");
  const job = await Job.findByIdAndUpdate(
    req.params.id,
    { current_position_status },
    { new: true, runValidators: true },
  );
  if (!job) return res.status(404).json({ error: "Job not found" });

  await writeAuditLog(req, {
    action: "Job Status Updated",
    resource: "jobs",
    status_code: 200,
    created_value: previousJob ? {
      title: previousJob.title,
      current_position_status: previousJob.current_position_status,
    } : null,
    updated_value: {
      title: job.title,
      current_position_status: job.current_position_status,
    },
  }).catch((error) => console.error("Failed to write audit log", error));

  res.json(job);
});

jobsRouter.delete("/:id", requireEditor, async (req, res) => {
  const job = await Job.findById(req.params.id).select("title description");
  const candidates = await Candidate.find({ job_id: req.params.id }).select("_id");
  await CandidateNote.deleteMany({ candidate_id: { $in: candidates.map((candidate) => candidate._id) } });
  await CandidateReview.deleteMany({ candidate_id: { $in: candidates.map((candidate) => candidate._id) } });
  await Candidate.deleteMany({ job_id: req.params.id });
  await Job.findByIdAndDelete(req.params.id);
  await writeAuditLog(req, {
    action: "Job Deleted",
    resource: "jobs",
    status_code: 204,
    created_value: job ? {
      title: job.title,
      description: job.description,
    } : { id: req.params.id },
    updated_value: null,
  }).catch((error) => console.error("Failed to write audit log", error));
  res.status(204).end();
});
