import { Schema, model } from "mongoose";

export type AuditLogDocument = {
  id: string;
  actor_id?: string;
  actor_email?: string;
  actor_name?: string;
  actor_role?: string;
  action: string;
  resource: string;
  method: string;
  path: string;
  status_code?: number;
  ip?: string;
  user_agent?: string;
  created_value?: unknown;
  updated_value?: unknown;
  metadata?: Record<string, unknown>;
  created_at: Date;
};

const auditLogSchema = new Schema<AuditLogDocument>(
  {
    actor_id: String,
    actor_email: String,
    actor_name: String,
    actor_role: String,
    action: { type: String, required: true },
    resource: { type: String, required: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    status_code: Number,
    ip: String,
    user_agent: String,
    created_value: Schema.Types.Mixed,
    updated_value: Schema.Types.Mixed,
    metadata: { type: Schema.Types.Mixed, default: {} },
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

export const AuditLog = model<AuditLogDocument>("AuditLog", auditLogSchema);
