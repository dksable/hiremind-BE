import type { NextFunction, Request, Response } from "express";
import { AuditLog } from "../models/AuditLog.js";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

type AuditInput = {
  action: string;
  resource: string;
  created_value?: unknown;
  updated_value?: unknown;
  status_code?: number;
  metadata?: Record<string, unknown>;
};

function actionFor(method: string, resource: string) {
  const label = resource
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  if (method === "POST") return `${label} Created`;
  if (method === "PATCH" || method === "PUT") return `${label} Updated`;
  if (method === "DELETE") return `${label} Deleted`;
  return `${label} Accessed`;
}

function sanitizeBody(body: unknown) {
  if (!body || typeof body !== "object") return body;
  const copy = { ...(body as Record<string, unknown>) };
  delete copy.password;
  delete copy.password_hash;
  delete copy.cv_text;
  delete copy.cvText;
  delete copy.jobDescription;
  return copy;
}

export async function writeAuditLog(req: Request, input: AuditInput) {
  if (!req.user) return;

  await AuditLog.create({
    actor_id: req.user.id,
    actor_email: req.user.email,
    actor_name: req.user.name,
    actor_role: req.user.role,
    action: input.action,
    resource: input.resource,
    method: req.method,
    path: req.originalUrl,
    status_code: input.status_code,
    ip: req.ip,
    user_agent: req.header("user-agent") || "",
    created_value: input.created_value,
    updated_value: input.updated_value,
    metadata: input.metadata || {
      params: req.params,
      query: req.query,
    },
  });
}

export function auditAction(resource: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATING_METHODS.has(req.method)) return next();

    res.on("finish", () => {
      writeAuditLog(req, {
        action: actionFor(req.method, resource),
        resource,
        status_code: res.statusCode,
        created_value: req.method === "DELETE" ? { params: req.params } : null,
        updated_value: req.method === "DELETE" ? null : sanitizeBody(req.body),
        metadata: {
          params: req.params,
          query: req.query,
        },
      }).catch((error) => {
        console.error("Failed to write audit log", error);
      });
    });

    next();
  };
}
