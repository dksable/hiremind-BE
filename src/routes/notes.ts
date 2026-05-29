import { Router } from "express";
import { requireAuth, requireEditor } from "../middleware/auth.js";
import { CandidateNote } from "../models/CandidateNote.js";
import { writeAuditLog } from "../services/audit.js";

type NoteParams = { id: string; noteId?: string };

export const notesRouter = Router({ mergeParams: true });

notesRouter.use(requireAuth);

notesRouter.get("/", async (req, res) => {
  const { id } = req.params as NoteParams;
  const notes = await CandidateNote.find({ candidate_id: id }).sort({ created_at: -1 });
  res.json(notes);
});

notesRouter.post("/", requireEditor, async (req, res) => {
  const { id } = req.params as NoteParams;
  const noteText = String(req.body.note || "").trim();
  if (!noteText) return res.status(400).json({ error: "note is required" });

  const note = await CandidateNote.create({
    candidate_id: id,
    author_id: req.user?.id || null,
    author_name: req.user?.name || "HR",
    author_email: req.user?.email || null,
    note: noteText,
  });

  await writeAuditLog(req, {
    action: "Candidate Internal Note Added",
    resource: "candidate_notes",
    status_code: 201,
    created_value: null,
    updated_value: {
      candidate_id: id,
      note: note.note,
    },
  }).catch((error) => console.error("Failed to write audit log", error));

  res.status(201).json(note);
});

notesRouter.delete("/:noteId", requireEditor, async (req, res) => {
  const { id, noteId } = req.params as NoteParams;
  const note = await CandidateNote.findOneAndDelete({ _id: noteId, candidate_id: id });

  await writeAuditLog(req, {
    action: "Candidate Internal Note Deleted",
    resource: "candidate_notes",
    status_code: 204,
    created_value: note ? {
      candidate_id: id,
      note: note.note,
      author_name: note.author_name,
    } : { candidate_id: id, note_id: noteId },
    updated_value: null,
  }).catch((error) => console.error("Failed to write audit log", error));

  res.status(204).end();
});
