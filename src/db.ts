import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "./models/User.js";

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI missing");

  await mongoose.connect(uri);
  await seedDemoUsers();
}

async function seedDemoUsers() {
  await Promise.all([
    User.findOneAndUpdate(
      { email: "admin@demo.com" },
      {
        email: "admin@demo.com",
        password_hash: await bcrypt.hash("admin123", 10),
        name: "Admin User",
        role: "admin",
      },
      { upsert: true },
    ),
    User.findOneAndUpdate(
      { email: "hr@demo.com" },
      {
        email: "hr@demo.com",
        password_hash: await bcrypt.hash("hr123", 10),
        name: "HR Manager",
        role: "hr",
      },
      { upsert: true },
    ),
  ]);
}
