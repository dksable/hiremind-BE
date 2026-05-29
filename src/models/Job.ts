import { Schema, model } from "mongoose";

export const JOB_POSITION_STATUSES = ["ongoing", "on_hold", "cancelled", "completed"] as const;
export type JobPositionStatus = typeof JOB_POSITION_STATUSES[number];

export type JobDocument = {
  id: string;
  title: string;
  description: string;
  current_position_status: JobPositionStatus;
  created_at: Date;
};

const jobSchema = new Schema<JobDocument>(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    current_position_status: {
      type: String,
      enum: JOB_POSITION_STATUSES,
      default: "ongoing",
      required: true,
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
        return obj;
      },
    },
  },
);

export const Job = model<JobDocument>("Job", jobSchema);
