import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CandidateDocument } from "../models/Candidate.js";
import { createInterviewCalendarInvite } from "./calendar.js";

function candidate(overrides: Partial<CandidateDocument> = {}) {
  return {
    id: "candidate-123",
    candidate_name: "Asha Patel",
    email: "asha@example.com",
    interview_at: new Date("2026-06-01T10:30:00.000Z"),
    interview_type: "Technical Round",
    interviewer_name: "Rahul Shah",
    interview_panel_names: ["Rahul Shah", "Mira Rao"],
    interview_panel_emails: ["rahul@example.com", "mira@example.com"],
    meeting_link: "https://meet.google.com/abc-defg-hij",
    interview_notes: "Focus on React and system design.",
    ...overrides,
  } as CandidateDocument;
}

describe("interview calendar invite", () => {
  it("creates an .ics invite with candidate and panel attendees", () => {
    const invite = createInterviewCalendarInvite({
      candidate: candidate(),
      jobTitle: "Senior Frontend Engineer",
      stageLabel: "Technical Round",
      productName: "Hiremind",
    });

    assert.ok(invite);
    assert.equal(invite.filename, "technical-round-candidate-123.ics");
    assert.match(invite.content, /BEGIN:VCALENDAR/);
    assert.match(invite.content, /SUMMARY:Technical Round: Senior Frontend Engineer/);
    assert.match(invite.content, /ATTENDEE;CN=Asha Patel;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:asha@example.com/);
    assert.match(invite.content, /ATTENDEE;CN=Rahul Shah;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:rahul@example.com/);
    assert.match(invite.content, /ATTENDEE;CN=Mira Rao;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:mira@example.com/);
    assert.match(invite.content, /LOCATION:https:\/\/meet\.google\.com\/abc-defg-hij/);
    assert.match(invite.content, /URL:https:\/\/meet\.google\.com\/abc-defg-hij/);
  });

  it("does not create an invite without candidate email or interview time", () => {
    assert.equal(createInterviewCalendarInvite({
      candidate: candidate({ email: null }),
      jobTitle: "Senior Frontend Engineer",
      stageLabel: "Technical Round",
      productName: "Hiremind",
    }), null);

    assert.equal(createInterviewCalendarInvite({
      candidate: candidate({ interview_at: null }),
      jobTitle: "Senior Frontend Engineer",
      stageLabel: "Technical Round",
      productName: "Hiremind",
    }), null);
  });
});
