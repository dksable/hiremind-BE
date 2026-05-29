import { Schema, model } from "mongoose";

export type UserRole = "admin" | "hr" | "viewer";

export type UserDocument = {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  created_at: Date;
};

const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ["admin", "hr", "viewer"], default: "viewer", required: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        const obj = ret as Record<string, unknown>;
        delete obj._id;
        delete obj.password_hash;
        return obj;
      },
    },
  },
);

export const User = model<UserDocument>("User", userSchema);
