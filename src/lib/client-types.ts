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
  last4: string;
  models: Model[];
};
export type Persona = {
  id: string;
  role: string;
  focus: string;
  openingMessage: string;
  color: string;
};
export type Conversation = {
  id: string;
  title: string;
  personaId: string;
  connectionId: string;
  modelId: string;
  updatedAt: string;
};
export type Attachment = {
  type: "image";
  mimeType: string;
  data: string;
  name: string;
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
};
export type Bootstrap = {
  user: { id: string; name: string; email?: string; development: boolean };
  connections: Connection[];
  personas: Persona[];
  conversations: Conversation[];
};
