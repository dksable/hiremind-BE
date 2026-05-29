import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "hr" | "viewer";
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const jwtSecret = () => process.env.JWT_SECRET || "dev-secret";

export function signToken(user: AuthUser) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, jwtSecret(), { expiresIn: "7d" });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing bearer token" });

  try {
    const payload = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
    const user = await User.findById(payload.sub).select("email name role");
    if (!user) return res.status(401).json({ error: "Invalid token" });
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}

export function requireEditor(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === "viewer") return res.status(403).json({ error: "Viewer accounts are read-only" });
  next();
}
