import type { HydratedDocument } from "mongoose";
import type { CalendarProvider } from "../models/CalendarIntegration.js";
import { CalendarIntegration, type CalendarIntegrationDocument } from "../models/CalendarIntegration.js";

type Attendee = {
  name: string;
  email: string;
};

type CreateMeetingInput = {
  userId: string;
  provider: CalendarProvider;
  subject: string;
  description: string;
  startsAt: Date;
  durationMinutes?: number;
  attendees: Attendee[];
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

function frontendUrl() {
  return process.env.FRONTEND_URL || "http://localhost:8080";
}

export function providerLabel(provider: CalendarProvider) {
  return provider === "google" ? "Google Calendar" : "Microsoft Graph";
}

function googleRedirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || `http://localhost:${process.env.PORT || 4000}/api/integrations/google/callback`;
}

function microsoftRedirectUri() {
  return process.env.MICROSOFT_REDIRECT_URI || `http://localhost:${process.env.PORT || 4000}/api/integrations/microsoft/callback`;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function jsonFetch<T>(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error_description || data.error?.message || data.error || `Request failed (${response.status})`);
  }
  return data as T;
}

export function oauthUrl(provider: CalendarProvider, state: string) {
  if (provider === "google") {
    const params = new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      redirect_uri: googleRedirectUri(),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.events openid email",
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  const params = new URLSearchParams({
    client_id: requiredEnv("MICROSOFT_CLIENT_ID"),
    redirect_uri: microsoftRedirectUri(),
    response_type: "code",
    scope: "offline_access User.Read Calendars.ReadWrite OnlineMeetings.ReadWrite",
    response_mode: "query",
    state,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeCode(provider: CalendarProvider, code: string) {
  if (provider === "google") {
    return jsonFetch<TokenResponse>("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requiredEnv("GOOGLE_CLIENT_ID"),
        client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
        code,
      }),
    });
  }

  return jsonFetch<TokenResponse>("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("MICROSOFT_CLIENT_ID"),
      client_secret: requiredEnv("MICROSOFT_CLIENT_SECRET"),
      redirect_uri: microsoftRedirectUri(),
      grant_type: "authorization_code",
      code,
    }),
  });
}

async function refreshIntegration(integration: HydratedDocument<CalendarIntegrationDocument>) {
  if (!integration.refresh_token) throw new Error(`${providerLabel(integration.provider)} refresh token is missing. Reconnect the calendar account.`);
  const provider = integration.provider;
  const token = provider === "google"
    ? await jsonFetch<TokenResponse>("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requiredEnv("GOOGLE_CLIENT_ID"),
        client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
        grant_type: "refresh_token",
        refresh_token: integration.refresh_token,
      }),
    })
    : await jsonFetch<TokenResponse>("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requiredEnv("MICROSOFT_CLIENT_ID"),
        client_secret: requiredEnv("MICROSOFT_CLIENT_SECRET"),
        grant_type: "refresh_token",
        refresh_token: integration.refresh_token,
      }),
    });

  integration.access_token = token.access_token;
  integration.refresh_token = token.refresh_token || integration.refresh_token;
  integration.expires_at = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
  await integration.save();
  return integration;
}

async function accessToken(userId: string, provider: CalendarProvider) {
  let integration = await CalendarIntegration.findOne({ user_id: userId, provider });
  if (!integration) throw new Error(`${providerLabel(provider)} is not connected`);
  if (integration.expires_at && integration.expires_at.getTime() < Date.now() + 60_000) {
    integration = await refreshIntegration(integration);
  }
  if (!integration) throw new Error(`${providerLabel(provider)} is not connected`);
  return integration.access_token;
}

async function googleAccountEmail(accessTokenValue: string) {
  const data = await jsonFetch<{ email?: string }>("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessTokenValue}` },
  });
  return data.email || null;
}

async function microsoftAccountEmail(accessTokenValue: string) {
  const data = await jsonFetch<{ mail?: string; userPrincipalName?: string }>("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessTokenValue}` },
  });
  return data.mail || data.userPrincipalName || null;
}

export async function saveIntegration(userId: string, provider: CalendarProvider, token: TokenResponse) {
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
  const accountEmail = provider === "google"
    ? await googleAccountEmail(token.access_token).catch(() => null)
    : await microsoftAccountEmail(token.access_token).catch(() => null);

  await CalendarIntegration.findOneAndUpdate(
    { user_id: userId, provider },
    {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: expiresAt,
      account_email: accountEmail,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export function successHtml(provider: CalendarProvider) {
  return `<!doctype html><html><body><p>${providerLabel(provider)} connected. You can close this tab.</p><script>setTimeout(() => window.close(), 800);</script></body></html>`;
}

export function errorRedirect(message: string) {
  const url = new URL(frontendUrl());
  url.searchParams.set("calendar_error", message);
  return url.toString();
}

export async function createProviderMeeting(input: CreateMeetingInput) {
  const token = await accessToken(input.userId, input.provider);
  return input.provider === "google" ? createGoogleMeeting(input, token) : createTeamsMeeting(input, token);
}

async function createGoogleMeeting(input: CreateMeetingInput, token: string) {
  const end = new Date(input.startsAt.getTime() + (input.durationMinutes || 45) * 60 * 1000);
  const data = await jsonFetch<{ hangoutLink?: string; conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> } }>(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: input.subject,
        description: input.description,
        start: { dateTime: input.startsAt.toISOString() },
        end: { dateTime: end.toISOString() },
        attendees: input.attendees.map((attendee) => ({ displayName: attendee.name, email: attendee.email })),
        conferenceData: {
          createRequest: {
            requestId: `hiremind-${Date.now()}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    },
  );
  return data.hangoutLink || data.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri || null;
}

async function createTeamsMeeting(input: CreateMeetingInput, token: string) {
  const end = new Date(input.startsAt.getTime() + (input.durationMinutes || 45) * 60 * 1000);
  const data = await jsonFetch<{ onlineMeeting?: { joinUrl?: string } }>(
    "https://graph.microsoft.com/v1.0/me/events",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: input.subject,
        body: { contentType: "HTML", content: input.description.replace(/\n/g, "<br/>") },
        start: { dateTime: input.startsAt.toISOString(), timeZone: "UTC" },
        end: { dateTime: end.toISOString(), timeZone: "UTC" },
        attendees: input.attendees.map((attendee) => ({
          emailAddress: { address: attendee.email, name: attendee.name },
          type: "required",
        })),
        isOnlineMeeting: true,
        onlineMeetingProvider: "teamsForBusiness",
      }),
    },
  );
  return data.onlineMeeting?.joinUrl || null;
}
