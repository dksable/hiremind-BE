import bcrypt from "bcryptjs";
import { Router } from "express";
import { requireAuth, signToken, type AuthUser } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { User } from "../models/User.js";

export const authRouter = Router();
const authRateLimit = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  message: "Too many authentication attempts. Please try again later.",
});

function publicUser(row: AuthUser) {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

authRouter.post("/register", authRateLimit, async (req, res) => {
  try {
    const { email, password, name, role = "viewer" } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: "email, password and name are required" });
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await User.create({ email: email.toLowerCase().trim(), password_hash: passwordHash, name, role });
    const authUser: AuthUser = { id: created.id, email: created.email, name: created.name, role: created.role };
    const user = publicUser(authUser);
    res.status(201).json({ token: signToken(authUser), user });
  } catch (error: any) {
    if (error.code === 11000) return res.status(409).json({ error: "A user with this email already exists" });
    res.status(500).json({ error: error.message || "Registration failed" });
  }
});

authRouter.post("/login", authRateLimit, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password_hash");
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role };
  res.json({ token: signToken(authUser), user: publicUser(authUser) });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
