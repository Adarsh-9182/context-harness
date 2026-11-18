export const CONTEXT_LIMITS = {
  name: 100,
  goal: 2_000,
  instructions: 3_000,
  references: 12_000,
  outputFormat: 2_000,
} as const;

export type ContextInput = {
  name: string;
  goal: string;
  instructions: string;
  references: string;
  outputFormat: string;
};

export type ContextSummary = Pick<ContextInput, "name" | "goal"> & {
  id: string;
  revision: number;
  updatedAt: string;
};

export type ContextBrief = ContextInput & ContextSummary;
