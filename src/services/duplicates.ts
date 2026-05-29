import { Candidate, type CandidateDuplicateMatch } from "../models/Candidate.js";
import { Job } from "../models/Job.js";

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "you", "your", "are", "was", "were", "has", "have",
  "will", "can", "not", "all", "any", "our", "their", "his", "her", "its", "resume", "curriculum", "vitae",
]);

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeEmail(email?: string | null) {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

export function extractPhone(text?: string | null) {
  if (!text) return null;
  const matches = text.match(/(?:\+?\d[\s().-]*){10,16}/g) || [];
  for (const match of matches) {
    const digits = match.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return digits.slice(-10);
  }
  return null;
}

export function extractLinkedIn(text?: string | null) {
  if (!text) return null;
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9%._-]+\/?/i);
  if (!match) return null;
  return match[0]
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function tokensFor(text?: string | null) {
  if (!text) return new Set<string>();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+#. ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
      .slice(0, 2500),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 0;
}

export async function findCandidateDuplicates(input: {
  jobId: string;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  cvText?: string | null;
}) {
  const exactFilters = [];
  if (input.email) exactFilters.push({ email: new RegExp(`^${escapeRegex(input.email)}$`, "i") });
  if (input.phone) exactFilters.push({ phone: input.phone });
  if (input.linkedinUrl) exactFilters.push({ linkedin_url: input.linkedinUrl });

  const [exactMatches, cvMatches] = await Promise.all([
    exactFilters.length
      ? Candidate.find({ $or: exactFilters }).sort({ created_at: -1 }).limit(50)
      : Promise.resolve([]),
    input.cvText
      ? Candidate.find({ cv_text: { $exists: true, $ne: null } }).sort({ created_at: -1 }).limit(100)
      : Promise.resolve([]),
  ]);

  const byId = new Map<string, {
    candidate: typeof exactMatches[number];
    reasons: Set<string>;
    similarity: number | null;
  }>();
  const incomingTokens = tokensFor(input.cvText);

  function addMatch(candidate: typeof exactMatches[number], reason: string, similarity: number | null = null) {
    const id = candidate.id;
    const existing = byId.get(id);
    if (existing) {
      existing.reasons.add(reason);
      if (similarity !== null) existing.similarity = Math.max(existing.similarity || 0, similarity);
      return;
    }
    byId.set(id, { candidate, reasons: new Set([reason]), similarity });
  }

  for (const candidate of exactMatches) {
    if (input.email && normalizeEmail(candidate.email) === input.email) addMatch(candidate, "Same email");
    if (input.phone && candidate.phone === input.phone) addMatch(candidate, "Same phone");
    if (input.linkedinUrl && candidate.linkedin_url === input.linkedinUrl) addMatch(candidate, "Same LinkedIn");
  }

  for (const candidate of cvMatches) {
    if (input.phone && (candidate.phone || extractPhone(candidate.cv_text)) === input.phone) {
      addMatch(candidate, "Same phone");
    }
    if (input.linkedinUrl && (candidate.linkedin_url || extractLinkedIn(candidate.cv_text)) === input.linkedinUrl) {
      addMatch(candidate, "Same LinkedIn");
    }
    const similarity = jaccardSimilarity(incomingTokens, tokensFor(candidate.cv_text));
    if (similarity >= 0.72) addMatch(candidate, "Similar CV", Number(similarity.toFixed(2)));
  }

  const matches = Array.from(byId.values());
  const jobIds = Array.from(new Set(matches.map(({ candidate }) => candidate.job_id?.toString()).filter(Boolean)));
  const jobs = await Job.find({ _id: { $in: jobIds } }).select("title");
  const jobTitleById = new Map(jobs.map((job) => [job.id, job.title]));

  return matches.map(({ candidate, reasons, similarity }): CandidateDuplicateMatch => {
    const jobId = candidate.job_id?.toString() || null;
    return {
      candidate_id: candidate.id,
      candidate_name: candidate.candidate_name || null,
      email: candidate.email || null,
      job_id: jobId,
      job_title: jobId ? jobTitleById.get(jobId) || null : null,
      status: candidate.status || null,
      reasons: Array.from(reasons),
      similarity,
      applied_for_another_job: Boolean(jobId && jobId !== input.jobId),
    };
  });
}
