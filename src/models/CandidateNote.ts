import { Schema, model, Types } from "mongoose";

export type CandidateNoteDocument = {
  id: string;
  candidate_id: Types.ObjectId;
  author_id?: string | null;
  author_name: string;
  author_email?: string | null;
  note: string;
  created_at: Date;
};

const candidateNoteSchema = new Schema<CandidateNoteDocument>(
  {
    candidate_id: { type: Schema.Types.ObjectId, ref: "Candidate", required: true, index: true },
    author_id: String,
    author_name: { type: String, required: true },
    author_email: String,
    note: { type: String, required: true },
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

export const CandidateNote = model<CandidateNoteDocument>("CandidateNote", candidateNoteSchema);
