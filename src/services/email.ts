import { Candidate, type CandidateDocument } from "../models/Candidate.js";
import { Job } from "../models/Job.js";
import { createInterviewCalendarInvite } from "./calendar.js";
import { isInterviewStage, normalizePipelineStage, pipelineStageLabel } from "./pipeline.js";

const resendEndpoint = "https://api.resend.com/emails";

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{
    filename: string;
    content: string;
  }>;
};

type CandidateEmailContext = {
  candidate: CandidateDocument;
  previousStatus?: string;
};

function emailFrom() {
  return process.env.EMAIL_FROM || "Hiremind <onboarding@resend.dev>";
}

function appName() {
  return process.env.APP_NAME || "Hiremind";
}

export async function sendEmail({ to, subject, html, text, attachments }: EmailPayload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY missing. Email was not sent.");
    return { skipped: true };
  }

  const response = await fetch(resendEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: emailFrom(),
      to,
      subject,
      html,
      text,
      attachments: attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: Buffer.from(attachment.content).toString("base64"),
      })),
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend email failed (${response.status}): ${details}`);
  }

  return response.json();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getJobTitle(candidate: CandidateDocument) {
  const job = await Job.findById(candidate.job_id).select("title");
  return job?.title || "the role";
}

export async function sendCandidateStatusEmail({ candidate, previousStatus }: CandidateEmailContext) {
  if (!candidate.email) return;
  if (!candidate.status || candidate.status === previousStatus) return;

  const recipientName = candidate.candidate_name || "Candidate";
  const jobTitle = await getJobTitle(candidate);
  const safeName = escapeHtml(recipientName);
  const safeJobTitle = escapeHtml(jobTitle);
  const product = appName();

  const stage = normalizePipelineStage(candidate.status);

  if (stage === "shortlisted" || stage === "selected" || stage === "offer_sent" || stage === "hired") {
    const stageLabel = pipelineStageLabel(stage).toLowerCase();
    await sendEmail({
      to: candidate.email,
      subject: `Application update for ${jobTitle}`,
      text: `Hi ${recipientName},\n\nCongratulations. Your application for ${jobTitle} has moved to ${stageLabel}. Our team will contact you with the next steps.\n\nRegards,\n${product}`,
      html: `<p>Hi ${safeName},</p><p>Congratulations. Your application for <strong>${safeJobTitle}</strong> has moved to <strong>${escapeHtml(stageLabel)}</strong>.</p><p>Our team will contact you with the next steps.</p><p>Regards,<br/>${escapeHtml(product)}</p>`,
    });
  }

  if (stage === "rejected") {
    await sendEmail({
      to: candidate.email,
      subject: `Application update for ${jobTitle}`,
      text: `Hi ${recipientName},\n\nThank you for applying for ${jobTitle}. After reviewing your profile, we will not be moving forward at this time. We appreciate your interest and wish you the best.\n\nRegards,\n${product}`,
      html: `<p>Hi ${safeName},</p><p>Thank you for applying for <strong>${safeJobTitle}</strong>.</p><p>After reviewing your profile, we will not be moving forward at this time. We appreciate your interest and wish you the best.</p><p>Regards,<br/>${escapeHtml(product)}</p>`,
    });
  }

  if (isInterviewStage(stage)) {
    const interviewDate = candidate.interview_at ? new Date(candidate.interview_at).toLocaleString() : "To be confirmed";
    const meetingLine = candidate.meeting_link ? `\nMeeting link: ${candidate.meeting_link}` : "";
    const panelNames = candidate.interview_panel_names?.length ? candidate.interview_panel_names.join(", ") : candidate.interviewer_name;
    const panelEmails = candidate.interview_panel_emails || [];
    const interviewerLine = panelNames ? `\nPanel: ${panelNames}` : "";
    const notesLine = candidate.interview_notes ? `\nNotes: ${candidate.interview_notes}` : "";
    const stageLabel = pipelineStageLabel(stage);
    const calendarInvite = createInterviewCalendarInvite({ candidate, jobTitle, stageLabel, productName: product });
    const htmlPanel = panelNames ? `<li><strong>Panel:</strong> ${escapeHtml(panelNames)}</li>` : "";
    const htmlMeeting = candidate.meeting_link ? `<li><strong>Meeting link:</strong> <a href="${escapeHtml(candidate.meeting_link)}">${escapeHtml(candidate.meeting_link)}</a></li>` : "";
    const htmlNotes = candidate.interview_notes ? `<li><strong>Notes:</strong> ${escapeHtml(candidate.interview_notes)}</li>` : "";
    const interviewText = `Date/time: ${interviewDate}\nType: ${candidate.interview_type || stageLabel}${interviewerLine}${meetingLine}${notesLine}`;
    const interviewHtml = `<ul><li><strong>Date/time:</strong> ${escapeHtml(interviewDate)}</li><li><strong>Type:</strong> ${escapeHtml(candidate.interview_type || stageLabel)}</li>${htmlPanel}${htmlMeeting}${htmlNotes}</ul>`;

    await sendEmail({
      to: candidate.email,
      subject: `${stageLabel} for ${jobTitle}`,
      text: `Hi ${recipientName},\n\nYour ${stageLabel.toLowerCase()} for ${jobTitle} has been scheduled.\n\n${interviewText}\n\nA calendar invite is attached and includes a reminder.\n\nRegards,\n${product}`,
      html: `<p>Hi ${safeName},</p><p>Your <strong>${escapeHtml(stageLabel.toLowerCase())}</strong> for <strong>${safeJobTitle}</strong> has been scheduled.</p>${interviewHtml}<p>A calendar invite is attached and includes a reminder.</p><p>Regards,<br/>${escapeHtml(product)}</p>`,
      attachments: calendarInvite ? [calendarInvite] : undefined,
    });

    await Promise.all(panelEmails.map((email, index) => {
      const panelName = candidate.interview_panel_names?.[index] || "Panel member";
      return sendEmail({
        to: email,
        subject: `${stageLabel} panel invite: ${candidate.candidate_name || "Candidate"} for ${jobTitle}`,
        text: `Hi ${panelName},\n\nYou have been added as an interviewer for ${candidate.candidate_name || "the candidate"}.\n\n${interviewText}\n\nA calendar invite is attached and includes a reminder.\n\nRegards,\n${product}`,
        html: `<p>Hi ${escapeHtml(panelName)},</p><p>You have been added as an interviewer for <strong>${escapeHtml(candidate.candidate_name || "the candidate")}</strong>.</p>${interviewHtml}<p>A calendar invite is attached and includes a reminder.</p><p>Regards,<br/>${escapeHtml(product)}</p>`,
        attachments: calendarInvite ? [calendarInvite] : undefined,
      });
    }));
  }
}

export async function sendStatusEmailForCandidate(candidateId: string, previousStatus?: string) {
  const candidate = await Candidate.findById(candidateId);
  if (!candidate) return;
  await sendCandidateStatusEmail({ candidate, previousStatus });
}
