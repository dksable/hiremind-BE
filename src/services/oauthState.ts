import crypto from "node:crypto";
import type { CalendarProvider } from "../models/CalendarIntegration.js";

type OAuthStatePayload = {
  userId: string;
  provider: CalendarProvider;
  exp: number;
  nonce: string;
};

function secret() {
  return process.env.JWT_SECRET || "dev-secret";
}

function base64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createOAuthState(userId: string, provider: CalendarProvider) {
  const payload = base64url(JSON.stringify({
    userId,
    provider,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: crypto.randomUUID(),
  } satisfies OAuthStatePayload));
  return `${payload}.${sign(payload)}`;
}

export function verifyOAuthState(state: string, provider: CalendarProvider) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature || sign(payload) !== signature) throw new Error("Invalid OAuth state");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthStatePayload;
  if (parsed.provider !== provider) throw new Error("OAuth state provider mismatch");
  if (parsed.exp < Date.now()) throw new Error("OAuth state expired");
  return parsed;
}
