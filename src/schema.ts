import { z } from 'zod';

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = [
  'bug',
  'security',
  'performance',
  'tests',
  'maintainability',
  'style',
] as const;

export const FindingSchema = z.object({
  severity: z.enum(SEVERITIES),
  category: z.enum(CATEGORIES),
  file: z.string().min(1),
  line: z.number().int().positive().nullable(),
  title: z.string().min(3).max(140),
  explanation: z.string().min(3),
  suggestion: z.string().nullable().optional(),
});

export const ReviewSchema = z.object({
  summary: z.string().min(1),
  risk: z.enum(['low', 'medium', 'high']),
  labels: z.array(z.string()).max(8).default([]),
  findings: z.array(FindingSchema),
});

export type Finding = z.infer<typeof FindingSchema>;
export type Review = z.infer<typeof ReviewSchema>;

export function severityRank(s: Severity): number {
  return SEVERITIES.indexOf(s);
}

/** Pulls the first JSON object out of a model reply (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in model output');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
