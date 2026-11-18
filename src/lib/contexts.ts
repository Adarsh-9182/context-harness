export { CONTEXT_LIMITS } from "./context-portable.mjs";

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
