import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { CalendarIntegration, type CalendarProvider } from "../models/CalendarIntegration.js";
import { createOAuthState, verifyOAuthState } from "../services/oauthState.js";
import { errorRedirect, exchangeCode, oauthUrl, saveIntegration, successHtml } from "../services/calendarProviders.js";

export const integrationsRouter = Router();

function providerParam(value: string): CalendarProvider | null {
  return value === "google" || value === "microsoft" ? value : null;
}

integrationsRouter.get("/status", requireAuth, async (req, res) => {
  const rows = await CalendarIntegration.find({ user_id: req.user?.id }).select("provider account_email updated_at");
  const status = {
    google: rows.find((row) => row.provider === "google") || null,
    microsoft: rows.find((row) => row.provider === "microsoft") || null,
  };
  res.json(status);
});

integrationsRouter.get("/:provider/connect-url", requireAuth, (req, res) => {
  const provider = providerParam(req.params.provider);
  if (!provider) return res.status(400).json({ error: "Invalid calendar provider" });
  const state = createOAuthState(req.user!.id, provider);
  res.json({ url: oauthUrl(provider, state) });
});

integrationsRouter.get("/:provider/callback", async (req, res) => {
  const provider = providerParam(req.params.provider);
  if (!provider) return res.redirect(errorRedirect("Invalid calendar provider"));
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  if (!code || !state) return res.redirect(errorRedirect("Missing OAuth callback parameters"));

  try {
    const payload = verifyOAuthState(state, provider);
    const token = await exchangeCode(provider, code);
    await saveIntegration(payload.userId, provider, token);
    res.send(successHtml(provider));
  } catch (error) {
    res.redirect(errorRedirect(error instanceof Error ? error.message : "Calendar connection failed"));
  }
});

integrationsRouter.delete("/:provider", requireAuth, async (req, res) => {
  const provider = providerParam(req.params.provider);
  if (!provider) return res.status(400).json({ error: "Invalid calendar provider" });
  await CalendarIntegration.deleteOne({ user_id: req.user?.id, provider });
  res.status(204).end();
});
