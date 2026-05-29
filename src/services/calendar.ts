import type { CandidateDocument } from "../models/Candidate.js";

type CalendarInviteInput = {
  candidate: CandidateDocument;
  jobTitle: string;
  stageLabel: string;
  productName: string;
};

function dateToIcs(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function organizerEmail() {
  const from = process.env.EMAIL_FROM || "Hiremind <onboarding@resend.dev>";
  const match = from.match(/<([^>]+)>/);
  return match?.[1] || from;
}

function durationMinutes() {
  return Math.max(Number(process.env.CALENDAR_INVITE_DURATION_MINUTES || 45), 15);
}

function reminderMinutes() {
  return Math.max(Number(process.env.CALENDAR_REMINDER_MINUTES || 30), 5);
}

export function createInterviewCalendarInvite({ candidate, jobTitle, stageLabel, productName }: CalendarInviteInput) {
  if (!candidate.email || !candidate.interview_at) return null;

  const start = new Date(candidate.interview_at);
  const end = new Date(start.getTime() + durationMinutes() * 60 * 1000);
  const uid = `candidate-${candidate.id}-${start.getTime()}@hiremind.local`;
  const summary = `${stageLabel}: ${jobTitle}`;
  const meetingLine = candidate.meeting_link ? `Meeting link: ${candidate.meeting_link}` : "";
  const panelNames = candidate.interview_panel_names?.length ? candidate.interview_panel_names.join(", ") : candidate.interviewer_name;
  const interviewerLine = panelNames ? `Panel: ${panelNames}` : "";
  const notesLine = candidate.interview_notes ? `Notes: ${candidate.interview_notes}` : "";
  const description = [
    `${candidate.candidate_name || "Candidate"} interview for ${jobTitle}.`,
    meetingLine,
    interviewerLine,
    notesLine,
  ].filter(Boolean).join("\n");
  const organizer = organizerEmail();
  const reminder = reminderMinutes();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${escapeIcs(productName)}//Hiremind ATS//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(uid)}`,
    `DTSTAMP:${dateToIcs(new Date())}`,
    `DTSTART:${dateToIcs(start)}`,
    `DTEND:${dateToIcs(end)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    candidate.meeting_link ? `LOCATION:${escapeIcs(candidate.meeting_link)}` : `LOCATION:${escapeIcs(candidate.interview_type || stageLabel)}`,
    candidate.meeting_link ? `URL:${escapeIcs(candidate.meeting_link)}` : null,
    `ORGANIZER;CN=${escapeIcs(productName)}:MAILTO:${organizer}`,
    `ATTENDEE;CN=${escapeIcs(candidate.candidate_name || "Candidate")};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:${candidate.email}`,
    ...(candidate.interview_panel_emails || []).map((email, index) => {
      const name = candidate.interview_panel_names?.[index] || email;
      return `ATTENDEE;CN=${escapeIcs(name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:${email}`;
    }),
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    `TRIGGER:-PT${reminder}M`,
    "ACTION:DISPLAY",
    `DESCRIPTION:Reminder: ${escapeIcs(summary)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return {
    filename: `${stageLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "interview"}-${candidate.id}.ics`,
    content: lines.join("\r\n"),
  };
}
