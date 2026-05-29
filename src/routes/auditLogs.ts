import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AuditLog } from "../models/AuditLog.js";

export const auditLogsRouter = Router();

auditLogsRouter.use(requireAuth);

auditLogsRouter.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const filter = req.user?.role === "admin" ? {} : { actor_id: req.user?.id };
  const logs = await AuditLog.find(filter).sort({ created_at: -1 }).limit(limit);
  res.json(logs);
});
