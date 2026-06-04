import { z } from "zod";

export const extractCaseFieldsSchema = z.object({
  title: z.string().nullable(),
  applicationNumber: z.string().nullable(),
  applicant: z.string().nullable(),
  applicationDate: z.string().nullable(),
  priorityDate: z.string().nullable(),
  claims: z.array(z.object({
    claimNumber: z.number(),
    type: z.enum(["independent", "dependent"]),
    dependsOn: z.array(z.number()),
    rawText: z.string(),
  })),
});
