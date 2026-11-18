export const PROFESSION_BRIEF_LIMITS = {
  goal: 1200,
  details: 5000,
  outputFormat: 1000,
} as const;

export type ProfessionBrief = {
  goal: string;
  details: string;
  outputFormat: string;
};
