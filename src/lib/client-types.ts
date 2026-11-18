import type { Attachment } from "./providers/types";

export type { Attachment } from "./providers/types";

export type Model = {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsImages: boolean;
  supportsTools: boolean;
};
export type Connection = {
  id: string;
  provider: string;
  name: string;
  accountLabel?: string;
  models: Model[];
};
export type Persona = {
  id: string;
  role: string;
  focus: string;
  openingMessage: string;
  color: string;
  context?: { id: string; revision: number };
};
export type Conversation = {
  id: string;
  title: string;
  personaId: string;
  connectionId: string;
  modelId: string;
  updatedAt: string;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  status?: string;
  createdAt?: string;
};
export type ConversationDetail = Conversation & {
  persona: Persona;
  messages: Message[];
  initialGoal?: string;
};
export type Bootstrap = {
  user: { id: string; name: string; email?: string; development: boolean };
  connections: Connection[];
  personas: Persona[];
  conversations: Conversation[];
};
export type AccountLogin = {
  id: string;
  provider: "chatgpt" | "claude";
  status: "pending" | "connected" | "failed" | "cancelled";
  authUrl?: string;
  connection?: Connection;
  message?: string;
  expiresAt: number;
};
