import { Schema, model, Types } from "mongoose";

export type CalendarProvider = "google" | "microsoft";

export type CalendarIntegrationDocument = {
  id: string;
  user_id: Types.ObjectId;
  provider: CalendarProvider;
  access_token: string;
  refresh_token?: string | null;
  expires_at?: Date | null;
  account_email?: string | null;
  created_at: Date;
  updated_at: Date;
};

const calendarIntegrationSchema = new Schema<CalendarIntegrationDocument>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: String, enum: ["google", "microsoft"], required: true },
    access_token: { type: String, required: true },
    refresh_token: String,
    expires_at: Date,
    account_email: String,
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        const obj = ret as Record<string, unknown>;
        delete obj._id;
        delete obj.access_token;
        delete obj.refresh_token;
        if (obj.user_id) obj.user_id = obj.user_id.toString();
        return obj;
      },
    },
  },
);

calendarIntegrationSchema.index({ user_id: 1, provider: 1 }, { unique: true });

export const CalendarIntegration = model<CalendarIntegrationDocument>("CalendarIntegration", calendarIntegrationSchema);
