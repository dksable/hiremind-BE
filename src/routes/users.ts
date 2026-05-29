import bcrypt from "bcryptjs";
import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { User } from "../models/User.js";
import { auditAction } from "../services/audit.js";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireAdmin, auditAction("users"));

usersRouter.get("/", async (_req, res) => {
  const users = await User.find().sort({ created_at: 1 });
  res.json(users);
});

usersRouter.post("/", async (req, res) => {
  try {
    const { email, password, name, role = "viewer" } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: "email, password and name are required" });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email: email.toLowerCase().trim(), password_hash: passwordHash, name, role });
    res.status(201).json(user);
  } catch (error: any) {
    if (error.code === 11000) return res.status(409).json({ error: "A user with this email already exists" });
    res.status(500).json({ error: error.message || "Failed to create user" });
  }
});

usersRouter.patch("/:email", async (req, res) => {
  const targetEmail = req.params.email.toLowerCase();
  const patch: Record<string, unknown> = {};
  for (const key of ["name", "role"] as const) {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  }
  if (req.body.password) {
    patch.password_hash = await bcrypt.hash(req.body.password, 10);
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: "No fields to update" });
  const user = await User.findOneAndUpdate({ email: targetEmail }, patch, { new: true });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

usersRouter.delete("/:email", async (req, res) => {
  const targetEmail = req.params.email.toLowerCase();
  if (req.user?.email.toLowerCase() === targetEmail) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }
  const [adminCount, target] = await Promise.all([
    User.countDocuments({ role: "admin" }),
    User.findOne({ email: targetEmail }),
  ]);
  if (target?.role === "admin" && adminCount <= 1) {
    return res.status(400).json({ error: "At least one admin is required" });
  }
  await User.deleteOne({ email: targetEmail });
  res.status(204).end();
});
