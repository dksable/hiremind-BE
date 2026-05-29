import OpenAI from "openai";

export type ScreeningAnalysis = {
  candidate_name: string;
  email: string;
  ats_score: number;
  skills_match_percent: number;
  matched_skills: string[];
  missing_skills: string[];
  experience_relevance: string;
  education_match: string;
  recommendation: "Strong Fit" | "Good Fit" | "Average" | "Poor Fit";
  summary: string;
};

export type HiringRecommendation = {
  recommendation: "Strong Hire" | "Hire" | "Hold" | "Reject";
  confidence_score: number;
  strengths: string[];
  risks: string[];
  next_action: string;
  summary: string;
};

function aiClient() {
  const useGroq = Boolean(process.env.GROQ_API_KEY);
  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || "missing-key",
    baseURL: useGroq ? "https://api.groq.com/openai/v1" : undefined,
  });
  const model = useGroq
    ? process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
    : process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY) {
    throw new Error("GROQ_API_KEY or OPENAI_API_KEY missing");
  }

  return { client, model };
}

export async function screenCv(jobDescription: string, cvText: string): Promise<ScreeningAnalysis> {
  const { client, model } = aiClient();

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are an expert ATS recruiter. Analyze the CV against the job description. Return your analysis ONLY by calling the function 'submit_analysis'. Be objective and strict.",
      },
      { role: "user", content: `JOB DESCRIPTION:\n${jobDescription}\n\nCANDIDATE CV:\n${cvText}` },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "submit_analysis",
          description: "Submit ATS analysis for a candidate",
          parameters: {
            type: "object",
            properties: {
              candidate_name: { type: "string" },
              email: { type: "string" },
              ats_score: { type: "number", description: "0-100" },
              skills_match_percent: { type: "number", description: "0-100" },
              matched_skills: { type: "array", items: { type: "string" } },
              missing_skills: { type: "array", items: { type: "string" } },
              experience_relevance: { type: "string" },
              education_match: { type: "string" },
              recommendation: { type: "string", enum: ["Strong Fit", "Good Fit", "Average", "Poor Fit"] },
              summary: { type: "string" },
            },
            required: [
              "candidate_name",
              "email",
              "ats_score",
              "skills_match_percent",
              "matched_skills",
              "missing_skills",
              "experience_relevance",
              "education_match",
              "recommendation",
              "summary",
            ],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "submit_analysis" } },
  });

  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") throw new Error("AI did not return structured output");
  return JSON.parse(toolCall.function.arguments) as ScreeningAnalysis;
}

export async function generateHiringRecommendation(context: string): Promise<HiringRecommendation> {
  const { client, model } = aiClient();

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are a senior hiring manager. Make a concise hiring recommendation using only the supplied ATS, candidate, interview, review, and notes context. Be fair, practical, and explicit about risk.",
      },
      { role: "user", content: context },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "submit_hiring_recommendation",
          description: "Submit final hiring recommendation",
          parameters: {
            type: "object",
            properties: {
              recommendation: { type: "string", enum: ["Strong Hire", "Hire", "Hold", "Reject"] },
              confidence_score: { type: "number", description: "0-100" },
              strengths: { type: "array", items: { type: "string" } },
              risks: { type: "array", items: { type: "string" } },
              next_action: { type: "string" },
              summary: { type: "string" },
            },
            required: ["recommendation", "confidence_score", "strengths", "risks", "next_action", "summary"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "submit_hiring_recommendation" } },
  });

  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") throw new Error("AI did not return structured recommendation");
  return JSON.parse(toolCall.function.arguments) as HiringRecommendation;
}
