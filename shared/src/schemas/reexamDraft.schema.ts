import { z } from "zod";

const MIN_QUOTE_LENGTH = 20;

export const supportingEvidenceSchema = z.object({
  label: z.string(),
  quote: z.string().optional(),
  confidence: z.enum(["high", "medium", "low"]),
}).transform((data) => {
  const hasValidQuote = data.quote != null && data.quote.length >= MIN_QUOTE_LENGTH;
  if ((data.confidence === "high" || data.confidence === "medium") && !hasValidQuote) {
    return { ...data, confidence: "low" as const };
  }
  return data;
});

export const reexamResponseItemSchema = z.object({
  rejectionGroundCode: z.string(),
  category: z.string(),
  applicantArgumentSummary: z.string(),
  examinerResponse: z.string(),
  conclusion: z.enum([
    "argument-accepted",
    "argument-partially-accepted",
    "argument-rejected",
    "needs-further-review"
  ]),
  supportingEvidence: z.array(supportingEvidenceSchema).optional(),
});

export const reexamDraftSchema = z.object({
  claimNumber: z.number(),
  responseItems: z.array(reexamResponseItemSchema),
  overallAssessment: z.string(),
  defectReviewSummary: z.string().optional(),
  legalCaution: z.string(),
});

export type ReexamDraftOutput = z.infer<typeof reexamDraftSchema>;