import type { ContextInput } from "@/lib/contexts";
import type { ProfessionBrief } from "@/lib/profession-brief";

export type ConversationContext =
  | (ContextInput & { kind: "saved"; contextId: string; revision: number })
  | (ProfessionBrief & { kind: "setup"; role: string; focus: string })
  | { kind: "role"; role: string; focus: string };
