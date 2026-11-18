import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  type Model,
  type ProviderId,
  type Attachment,
  type UnifiedMessage,
} from "../providers";
import { db } from "./db";
import { decryptKey } from "./crypto";
import { accountConnectionSchema } from "./account-logins";
import { connectionCredential, disconnectAccount, isAccountProvider, publicAccountConnection } from "./account-connections";
import { AppError } from "./http";
import {
  contextPersonaDefinition,
  contextSnapshot,
  getContext,
  promptWithContext,
  readContextSnapshot,
} from "./contexts";
import {
  assemblePersona,
  compilePersona,
  personaInputSchema,
  promptWithProfessionBrief,
  readProfessionBrief,
  roleColor,
  TEMPLATE_VERSION,
  fitContext,
} from "./persona";

export type UserIdentity = { id: string; name: string; email?: string; development?: boolean };
export type ConnectionRow = {
  id: string;
  user_id: string;
  provider: ProviderId;
  name: string;
  last4: string;
  encrypted_key: Parameters<typeof decryptKey>[0];
  base_url: string | null;
  models: Model[];
  created_at: string;
};
export type PersonaRow = {
  id: string;
  user_id: string;
  role: string;
  focus: string;
  provider: string;
  cache_key: string;
  compiled_prompt: string;
  definition: unknown;
  opening_message: string;
  color: string;
  template_version: string;
};
export type ConversationRow = {
  id: string;
  user_id: string;
  persona_id: string;
  connection_id: string;
  model_id: string;
  title: string;
  title_edited: boolean;
  updated_at: string | Date;
  deleted_at: string | null;
};
export type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  attachments: Attachment[];
  status: string;
  created_at: string | Date;
};

export const connectionSchema = accountConnectionSchema;
export const conversationSchema = z
  .object({
    personaId: z.string().uuid(),
    connectionId: z.string().uuid(),
    modelId: z.string().min(1).max(200),
  })
  .strict();
export const switchSchema = z
  .object({
    connectionId: z.string().uuid(),
    modelId: z.string().min(1).max(200),
  })
  .strict();
export const renameConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$/, "Use a single-line conversation title."),
  })
  .strict();
export const conversationPatchSchema = z.union([switchSchema, renameConversationSchema]);
export const restoreConversationSchema = z.object({}).strict();
export const conversationListSchema = z.enum(["true", "false"]).optional();
const videoSampleSchema = z
  .object({
    durationSeconds: z.number().positive().max(86_400),
    timestampsSeconds: z.array(z.number().nonnegative()).min(1).max(4),
  })
  .strict()
  .refine(
    ({ durationSeconds, timestampsSeconds }) => timestampsSeconds.every((time, index) =>
      time <= durationSeconds && (index === 0 || time > timestampsSeconds[index - 1]),
    ),
    {
      path: ["timestampsSeconds"],
      message: "Sample timestamps must be in increasing order and within the video duration.",
    },
  );
const attachmentSchema = z
  .object({
    type: z.literal("image"),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    data: z
      .string()
      .min(4)
      .max(2_800_000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    name: z.string().min(1).max(200),
    video: videoSampleSchema.optional(),
  })
  .strict()
  // /9j/ is the Base64 encoding of the three JPEG signature bytes.
  .refine((attachment) => !attachment.video || (
    attachment.mimeType === "image/jpeg" && attachment.data.startsWith("/9j/")
  ), { path: ["video"], message: "Video samples must be a JPEG contact sheet." });
export const chatSchema = z
  .object({
    conversationId: z.string().uuid(),
    message: z.string().trim().max(40_000).optional(),
    action: z.enum(["send", "regenerate", "edit"]).default("send"),
    messageId: z.string().uuid().optional(),
    clientMessageId: z.string().uuid().transform((id) => id.toLowerCase()).optional(),
    attachments: z.array(attachmentSchema).max(3).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.clientMessageId && v.action !== "send")
      ctx.addIssue({
        code: "custom",
        path: ["clientMessageId"],
        message: "A client message ID is only used when sending a new message.",
      });
    if (v.action !== "regenerate" && !v.message && !v.attachments.length)
      ctx.addIssue({
        code: "custom",
        message: "Write a message or attach an image.",
      });
    if (v.action === "edit" && !v.messageId)
      ctx.addIssue({ code: "custom", message: "Choose the message to edit." });
    if (
      v.attachments.reduce(
        (n, a) => n + Math.floor((a.data.length * 3) / 4),
        0,
      ) > 2_000_000
    )
      ctx.addIssue({
        code: "custom",
        message: "Keep image attachments below 2 MB combined.",
      });
  });

type PersonaSummaryRow = Pick<PersonaRow, "id" | "role" | "focus" | "opening_message" | "color">;
function personaSummary(r: PersonaSummaryRow, context?: { id: string; revision: number }) {
  return {
    id: r.id,
    role: r.role,
    focus: r.focus,
    openingMessage: r.opening_message,
    color: r.color,
    ...(context && { context: { id: context.id, revision: context.revision } }),
  };
}
export function publicPersona(r: PersonaRow) {
  return personaSummary(r, readContextSnapshot(r.definition));
}
export const publicConversation = (r: ConversationRow) => ({
  id: r.id,
  title: r.title,
  personaId: r.persona_id,
  connectionId: r.connection_id,
  modelId: r.model_id,
  updatedAt: r.updated_at,
});
type MessageMetadataRow = Pick<MessageRow, "id" | "role" | "status" | "created_at">;
const publicMessageMetadata = (r: MessageMetadataRow) => ({
  id: r.id,
  role: r.role,
  status: r.status,
  createdAt: r.created_at,
});
export const publicMessage = (r: MessageRow) => ({
  ...publicMessageMetadata(r),
  content: r.content,
  attachments: r.attachments ?? [],
});

export async function ensureUser(user: UserIdentity) {
  await (
    await db()
  ).query(
    "INSERT INTO users (id,name,email) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name",
    [user.id, user.name, user.email ?? null],
  );
}
export async function listConnections(userId: string) {
  const { rows } = await (await db()).query<ConnectionRow>(
    "SELECT * FROM provider_connections WHERE user_id=$1 AND provider IN ('chatgpt','claude') ORDER BY created_at ASC,id ASC",
    [userId],
  );
  return Promise.all(rows.map(async (row) => {
    try {
      return await publicAccountConnection(row);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "sign_in_required") throw error;
      return { id: row.id, provider: row.provider, name: row.name, models: row.models, accountLabel: "Reconnect this account" };
    }
  }));
}

export async function listPersonas(userId: string) {
  const { rows } = await (await db()).query<PersonaSummaryRow & { context_id: string | null; context_revision: string | null }>(
    `SELECT id,role,focus,opening_message,color,
       definition->'context'->>'id' AS context_id,definition->'context'->>'revision' AS context_revision
     FROM personas WHERE user_id=$1 ORDER BY created_at DESC,id ASC LIMIT 100`,
    [userId],
  );
  return rows.map((row) => {
    const revision = Number(row.context_revision);
    return personaSummary(row, row.context_id && Number.isSafeInteger(revision) && revision > 0
      ? { id: row.context_id, revision }
      : undefined);
  });
}

export async function bootstrap(user: UserIdentity) {
  const [connections, personas, conversations] = await Promise.all([
    listConnections(user.id),
    listPersonas(user.id),
    listConversations(user.id),
  ]);
  return {
    user: { id: user.id, name: user.name, development: user.development === true },
    connections,
    personas,
    conversations,
  };
}
export async function getConnection(userId: string, id: string) {
  const row = (
    await (
      await db()
    ).query<ConnectionRow>(
      "SELECT * FROM provider_connections WHERE id=$1 AND user_id=$2",
      [id, userId],
    )
  ).rows[0];
  if (!row)
    throw new AppError(
      404,
      "connection_not_found",
      "This provider connection is no longer available. Connect it again.",
    );
  if (!isAccountProvider(row.provider))
    throw new AppError(400, "account_connection_required", "Connect with Claude or ChatGPT, then select it for this conversation.");
  return row;
}
export function pickModel(connection: ConnectionRow, id: string): Model {
  const model = connection.models.find((m) => m.id === id);
  if (!model)
    throw new AppError(
      400,
      "model_unavailable",
      "Choose an available model from this provider connection.",
    );
  return model;
}
export async function removeConnection(userId: string, id: string) {
  return disconnectAccount(await getConnection(userId, id));
}
const compilationLocks = new Map<
  string,
  Promise<ReturnType<typeof publicPersona>>
>();
export async function createPersona(
  user: UserIdentity,
  input: z.infer<typeof personaInputSchema>,
  signal?: AbortSignal,
) {
  await ensureUser(user);
  const connection = await getConnection(user.id, input.connectionId);
  const model = pickModel(connection, input.modelId);
  const { brief } = input;
  const cacheInput = [
    user.id,
    input.role.toLowerCase().trim(),
    input.focus.toLowerCase().trim(),
    connection.provider,
    TEMPLATE_VERSION,
  ];
  if (brief) cacheInput.push(brief.goal, brief.details, brief.outputFormat);
  const cacheKey = createHash("sha256")
    .update(JSON.stringify(cacheInput))
    .digest("hex");
  const existing = (
    await (
      await db()
    ).query<PersonaRow>(
      "SELECT * FROM personas WHERE cache_key=$1 AND user_id=$2",
      [cacheKey, user.id],
    )
  ).rows[0];
  if (existing) return publicPersona(existing);
  const pending = compilationLocks.get(cacheKey);
  if (pending) return pending;
  const work = (async () => {
    const compiled = await compilePersona({
      role: input.role,
      focus: input.focus,
      provider: connection.provider,
      baseUrl: connection.base_url ?? undefined,
      apiKey: await connectionCredential(connection),
      model,
      signal,
    });
    const definition = brief ? { ...compiled.definition, professionBrief: brief } : compiled.definition;
    const id = randomUUID();
    await (
      await db()
    ).query(
      "INSERT INTO personas (id,user_id,role,focus,provider,cache_key,compiled_prompt,definition,opening_message,color,template_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (user_id,cache_key) DO NOTHING",
      [
        id,
        user.id,
        input.role,
        input.focus,
        connection.provider,
        cacheKey,
        compiled.systemPrompt,
        JSON.stringify(definition),
        compiled.definition.opening_message,
        roleColor(input.role),
        TEMPLATE_VERSION,
      ],
    );
    const row = (
      await (
        await db()
      ).query<PersonaRow>(
        "SELECT * FROM personas WHERE cache_key=$1 AND user_id=$2",
        [cacheKey, user.id],
      )
    ).rows[0];
    return publicPersona(row);
  })();
  compilationLocks.set(cacheKey, work);
  try {
    return await work;
  } finally {
    compilationLocks.delete(cacheKey);
  }
}
export async function getPersona(userId: string, id: string) {
  const row = (
    await (
      await db()
    ).query<PersonaRow>("SELECT * FROM personas WHERE id=$1 AND user_id=$2", [
      id,
      userId,
    ])
  ).rows[0];
  if (!row)
    throw new AppError(
      404,
      "persona_not_found",
      "This role was not found. Create a new role to continue.",
    );
  return row;
}

function personaSystemPrompt(persona: PersonaRow): string {
  const brief = readProfessionBrief(persona.definition);
  return brief
    ? promptWithProfessionBrief(persona.compiled_prompt, brief)
    : promptWithContext(persona.compiled_prompt, readContextSnapshot(persona.definition));
}

function assertPinnedContextFits(persona: PersonaRow, model: Model) {
  const systemPrompt = personaSystemPrompt(persona);
  if (systemPrompt !== persona.compiled_prompt) assertContextFits(systemPrompt, model);
}

export async function createConversation(
  user: UserIdentity,
  input: z.infer<typeof conversationSchema>,
) {
  const persona = await getPersona(user.id, input.personaId);
  const connection = await getConnection(user.id, input.connectionId);
  const model = pickModel(connection, input.modelId);
  assertPinnedContextFits(persona, model);
  return insertConversation(user.id, persona, connection.id, model.id);
}

async function insertConversation(userId: string, persona: PersonaRow, connectionId: string, modelId: string) {
  const id = randomUUID();
  const { rows } = await (await db()).query<ConversationRow>(
    `WITH conversation AS (
       INSERT INTO conversations (id,user_id,persona_id,connection_id,model_id,title)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
     ), greeting AS (
       INSERT INTO messages (id,conversation_id,role,content,status)
       SELECT $7,id,'assistant',$8,'greeting' FROM conversation
     )
     SELECT * FROM conversation`,
    [id, userId, persona.id, connectionId, modelId, `${persona.role} conversation`, randomUUID(), persona.opening_message],
  );
  return publicConversation(rows[0]);
}

export async function runContext(userId: string, id: string, input: z.infer<typeof switchSchema>) {
  const snapshot = contextSnapshot(await getContext(userId, id));
  const connection = await getConnection(userId, input.connectionId);
  const model = pickModel(connection, input.modelId);
  // Custom context is data inside the system prompt, not an injected role label.
  const { systemPrompt } = assemblePersona("Context assistant", "", contextPersonaDefinition);
  assertContextFits(promptWithContext(systemPrompt, snapshot), model);
  const database = await db();
  const cacheKey = `context:${snapshot.id}:${snapshot.revision}:${TEMPLATE_VERSION}`;
  const { rows } = await database.query<PersonaRow>(
    `INSERT INTO personas (id,user_id,role,provider,cache_key,compiled_prompt,definition,opening_message,color,template_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (user_id,cache_key) DO NOTHING RETURNING *`,
    [randomUUID(), userId, snapshot.name, connection.provider, cacheKey, systemPrompt,
      JSON.stringify({ ...contextPersonaDefinition, context: snapshot }), contextPersonaDefinition.opening_message,
      roleColor(snapshot.name), TEMPLATE_VERSION],
  );
  const persona = rows[0] ?? (await database.query<PersonaRow>(
    "SELECT * FROM personas WHERE user_id=$1 AND cache_key=$2",
    [userId, cacheKey],
  )).rows[0];
  const conversation = await insertConversation(userId, persona, connection.id, model.id);
  return { ...(await conversationDetail(userId, conversation.id)), initialGoal: snapshot.goal };
}

function assertContextFits(systemPrompt: string, model: Model) {
  const maxTokens = Math.min(model.maxOutputTokens, 4096);
  try {
    fitContext(systemPrompt, [], model.contextWindow, maxTokens);
  } catch (error) {
    if (error instanceof AppError && error.code === "context_too_large") {
      throw new AppError(400, "context_too_large", "Shorten this context or choose a model with a larger context window.");
    }
    throw error;
  }
}
export async function getConversation(userId: string, id: string) {
  const row = (
    await (
      await db()
    ).query<ConversationRow>(
      "SELECT * FROM conversations WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
      [id, userId],
    )
  ).rows[0];
  if (!row)
    throw new AppError(
      404,
      "conversation_not_found",
      "This conversation was not found.",
    );
  return row;
}
export async function listConversations(userId: string, archived = false) {
  const rows = await (await db()).query<ConversationRow>(
    archived
      ? "SELECT * FROM conversations WHERE user_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC,id ASC LIMIT 100"
      : "SELECT * FROM conversations WHERE user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC,id ASC LIMIT 100",
    [userId],
  );
  return rows.rows.map(publicConversation);
}
export async function renameConversation(userId: string, id: string, title: string) {
  const input = renameConversationSchema.parse({ title });
  const result = await (await db()).query<ConversationRow>(
    "UPDATE conversations SET title=$1,title_edited=TRUE,updated_at=clock_timestamp() WHERE id=$2 AND user_id=$3 AND deleted_at IS NULL RETURNING *",
    [input.title, id, userId],
  );
  if (!result.rows[0])
    throw new AppError(404, "conversation_not_found", "This conversation was not found.");
  return publicConversation(result.rows[0]);
}
export async function restoreConversation(userId: string, id: string) {
  const result = await (await db()).query<ConversationRow>(
    "UPDATE conversations SET deleted_at=NULL,updated_at=CASE WHEN deleted_at IS NULL THEN updated_at ELSE clock_timestamp() END WHERE id=$1 AND user_id=$2 RETURNING *",
    [id, userId],
  );
  if (!result.rows[0])
    throw new AppError(404, "conversation_not_found", "This conversation was not found.");
  return publicConversation(result.rows[0]);
}
export async function conversationDetail(userId: string, id: string) {
  const row = await getConversation(userId, id);
  const persona = await getPersona(userId, row.persona_id);
  const messages = await getMessages(id);
  return {
    ...publicConversation(row),
    persona: publicPersona(persona),
    messages: messages.map(publicMessage),
  };
}
export async function switchModel(
  userId: string,
  id: string,
  input: z.infer<typeof switchSchema>,
) {
  const conversation = await getConversation(userId, id);
  const connection = await getConnection(userId, input.connectionId);
  const model = pickModel(connection, input.modelId);
  const persona = await getPersona(userId, conversation.persona_id);
  assertPinnedContextFits(persona, model);
  await (
    await db()
  ).query(
    "UPDATE conversations SET connection_id=$1,model_id=$2,updated_at=NOW() WHERE id=$3 AND user_id=$4",
    [input.connectionId, input.modelId, id, userId],
  );
  return publicConversation(await getConversation(userId, id));
}
export async function removeConversation(userId: string, id: string) {
  await getConversation(userId, id);
  await (
    await db()
  ).query(
    "UPDATE conversations SET deleted_at=NOW() WHERE id=$1 AND user_id=$2",
    [id, userId],
  );
}
export async function getMessages(conversationId: string) {
  return (
    await (
      await db()
    ).query<MessageRow>(
      "SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC,id ASC",
      [conversationId],
    )
  ).rows;
}
function nextMessageTimestamp(conversationParameter: "$1" | "$2") {
  // Timestamp precision can tie on very fast/mock streams. A strict database
  // ordering avoids a random UUID tie-break placing a reply before its request.
  return `GREATEST(clock_timestamp(),COALESCE((SELECT MAX(created_at)+INTERVAL '1 microsecond' FROM messages WHERE conversation_id=${conversationParameter}),'-infinity'::timestamptz))`;
}
export async function insertMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  attachments: Attachment[] = [],
  status = "complete",
) {
  const id = randomUUID();
  await (
    await db()
  ).query(
    `INSERT INTO messages (id,conversation_id,role,content,attachments,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,${nextMessageTimestamp("$2")})`,
    [id, conversationId, role, content, JSON.stringify(attachments), status],
  );
  return id;
}

function messageAlreadySent() {
  return new AppError(409, "message_already_sent", "This message was already sent.");
}

export async function requireUnsentMessage(userId: string, conversationId: string, messageId: string) {
  const existing = await (await db()).query(
    `SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id
     WHERE m.id=$1 AND m.role='user' AND c.id=$2 AND c.user_id=$3 AND c.deleted_at IS NULL`,
    [messageId, conversationId, userId],
  );
  if (existing.rows.length) throw messageAlreadySent();
}

async function acceptMessage(userId: string, message: MessageRow, title: string) {
  const accepted = await (await db()).query<{
    id: string | null;
    created_at: MessageRow["created_at"];
  }>(
    `WITH owned AS MATERIALIZED (
      SELECT id FROM conversations WHERE id=$2 AND user_id=$5 AND deleted_at IS NULL FOR UPDATE
    ), message AS (
      INSERT INTO messages (id,conversation_id,role,content,attachments,status,created_at)
      SELECT $1,id,'user',$3,$4::jsonb,'complete',${nextMessageTimestamp("$2")} FROM owned
      ON CONFLICT (id) DO NOTHING RETURNING id,created_at
    ), updated AS (
      UPDATE conversations SET title=CASE WHEN title_edited THEN title ELSE $6 END,updated_at=clock_timestamp()
      WHERE id IN (SELECT id FROM owned) AND EXISTS (SELECT 1 FROM message) RETURNING id
    ) SELECT message.id,message.created_at FROM owned LEFT JOIN message ON TRUE`,
    [message.id, message.conversation_id, message.content, JSON.stringify(message.attachments), userId, title],
  );
  const row = accepted.rows[0];
  if (!row) throw new AppError(409, "conversation_unavailable", "This conversation is no longer available.");
  if (!row.id) {
    // The unique key can also collide with a message outside this chat. Only an
    // owned user message in the requested conversation confirms an earlier send.
    await requireUnsentMessage(userId, message.conversation_id, message.id);
    throw new AppError(409, "message_id_conflict", "This message ID could not be used. Try sending it again.");
  }
  return publicMessageMetadata({ ...message, created_at: row.created_at });
}

function messageForModel(message: MessageRow, supportsImages: boolean): UnifiedMessage {
  const attachments = message.attachments ?? [];
  const notes = attachments.flatMap(({ video }, index) => {
    if (!video) return [];
    const label = `Attachment ${index + 1} is a sampled video contact sheet.`;
    if (!supportsImages)
      return [`[${label} Its frames are unavailable to the selected text-only model. No audio is available.]`];
    // Ordinals follow the image order sent to the provider. File names are
    // kept in the transcript and omitted from the model-facing description.
    const timestamps = video.timestampsSeconds.map((time) => `${time}s`).join(", ");
    return [
      `[${label} Reported video duration: ${video.durationSeconds}s. Sampled times in reading order: ${timestamps}.` +
      " Use only the visible frames as evidence. No audio is available." +
      " State when an observation requires footage between the sampled times or the soundtrack.]",
    ];
  });
  if (!supportsImages && attachments.some((item) => !item.video))
    notes.push("[An image from this earlier turn is unavailable to the selected text-only model.]");
  return {
    role: message.role,
    content: notes.length ? [message.content, ...notes].join("\n") : message.content,
    attachments: supportsImages ? attachments : [],
  };
}

export async function prepareTurn(
  userId: string,
  input: z.infer<typeof chatSchema>,
) {
  const conversation = await getConversation(userId, input.conversationId);
  const connection = await getConnection(userId, conversation.connection_id);
  const model = pickModel(connection, conversation.model_id);
  const persona = await getPersona(userId, conversation.persona_id);
  let history = await getMessages(conversation.id);
  if (input.clientMessageId && history.some((m) => m.role === "user" && m.id === input.clientMessageId))
    throw messageAlreadySent();
  let removedIds: string[] = [];
  if (input.attachments.length && !model.supportsImages)
    throw new AppError(
      400,
      "images_unsupported",
      "The selected model does not support images. Choose a vision model or remove the attachment.",
    );
  if (input.action === "send" && history.length >= 299)
    throw new AppError(
      400,
      "conversation_limit",
      "This conversation is full. Start a new conversation with the same role.",
    );
  if (input.action === "edit") {
    const target = history.find(
      (m) => m.id === input.messageId && m.role === "user",
    );
    if (!target)
      throw new AppError(
        400,
        "invalid_message",
        "Choose one of your messages to edit.",
      );
    const index = history.findIndex((m) => m.id === target.id);
    removedIds = history.slice(index).map((m) => m.id);
    history = history.slice(0, index);
  } else if (input.action === "regenerate") {
    const lastUserIndex = history.findLastIndex((m) => m.role === "user");
    if (lastUserIndex < 0)
      throw new AppError(
        400,
        "invalid_message",
        "Send a message before regenerating a response.",
      );
    removedIds = history.slice(lastUserIndex + 1).map((m) => m.id);
    history = history.slice(0, lastUserIndex + 1);
  }
  const newUser: MessageRow | undefined = input.action !== "regenerate"
    ? {
      id: input.clientMessageId ?? randomUUID(),
      conversation_id: conversation.id,
      role: "user",
      content: input.message ?? "",
      attachments: input.attachments,
      status: "complete",
      created_at: new Date(),
    }
    : undefined;
  if (newUser) history.push(newUser);
  if (history.length > 300)
    throw new AppError(
      400,
      "conversation_limit",
      "This conversation is full. Start a new conversation with the same role.",
    );
  const messages: UnifiedMessage[] = history
    .filter((m) => m.status !== "greeting" && m.status !== "failed" && m.status !== "cancelled")
    .map((m) => messageForModel(m, model.supportsImages));
  // Validate the proposed transcript before any destructive edit or append.
  // A model switch to a smaller context must not erase the old answer when
  // regeneration or an edited replacement cannot fit.
  const systemPrompt = personaSystemPrompt(persona);
  const maxTokens = Math.min(model.maxOutputTokens, 4096);
  const fitted = fitContext(
    systemPrompt,
    messages,
    model.contextWindow,
    maxTokens,
  );
  const firstUser = history.find((m) => m.role === "user");
  const title = firstUser?.content.slice(0, 75) || `${persona.role} · Image`;
  // A new send is durable even if the model later fails. Replacements remain
  // staged until their complete, validated response can be committed atomically.
  const accepted = input.action === "send" && newUser ? await acceptMessage(userId, newUser, title) : undefined;
  return {
    userId,
    action: input.action,
    conversation,
    connection,
    persona,
    model,
    systemPrompt,
    maxTokens,
    fitted,
    latestUser: history.findLast((m) => m.role === "user")?.content ?? "",
    title,
    accepted,
    replacement: input.action === "send" ? undefined : { removedIds, newUser },
  };
}

export async function commitTurn(
  turn: Awaited<ReturnType<typeof prepareTurn>>,
  output: string,
  status: string,
  signal: AbortSignal,
) {
  const database = await db();
  // Never replace an earlier branch after a stop/deadline/disconnect. Once this
  // atomic statement starts, its entire transcript change succeeds or rolls back.
  if (signal.aborted)
    throw new AppError(499, "cancelled", "Response stopped.");
  const messageId = randomUUID();
  const edited = turn.replacement?.newUser;
  const result = await database.query<ConversationRow & {
    answer_id: string;
    answer_status: string;
    answer_created_at: MessageRow["created_at"];
    edited_id: string | null;
    edited_created_at: MessageRow["created_at"];
  }>(
    `WITH owned AS MATERIALIZED (
      SELECT id FROM conversations
      WHERE id=$1 AND user_id=$10 AND deleted_at IS NULL FOR UPDATE
    ), next_time AS MATERIALIZED (
      SELECT ${nextMessageTimestamp("$1")} AS stamp FROM owned
    ), removed AS (
      DELETE FROM messages WHERE conversation_id IN (SELECT id FROM owned)
      AND id=ANY($2::text[]) RETURNING id
    ), edited AS (
      INSERT INTO messages (id,conversation_id,role,content,attachments,status,created_at)
      SELECT $3,$1,'user',$4,$5::jsonb,'complete',stamp FROM next_time
      WHERE $6::boolean RETURNING id,created_at
    ), answer AS (
      INSERT INTO messages (id,conversation_id,role,content,attachments,status,created_at)
      SELECT $7,$1,'assistant',$8,'[]'::jsonb,$9,
        stamp + CASE WHEN $6::boolean THEN INTERVAL '1 microsecond' ELSE INTERVAL '0' END
      FROM next_time RETURNING id,status,created_at
    ), updated AS (
      UPDATE conversations SET title=CASE WHEN title_edited THEN title ELSE $11 END,updated_at=clock_timestamp()
      WHERE id IN (SELECT id FROM owned) RETURNING id,title,persona_id,connection_id,model_id,updated_at
    ) SELECT updated.*,answer.id AS answer_id,answer.status AS answer_status,
      answer.created_at AS answer_created_at,edited.id AS edited_id,edited.created_at AS edited_created_at
      FROM answer CROSS JOIN updated LEFT JOIN edited ON TRUE`,
    [
      turn.conversation.id,
      turn.replacement?.removedIds ?? [],
      edited?.id ?? randomUUID(),
      edited?.content ?? "",
      JSON.stringify(edited?.attachments ?? []),
      !!edited,
      messageId,
      output,
      status,
      turn.userId,
      turn.title,
    ],
  );
  const row = result.rows[0];
  if (!row)
    throw new AppError(
      409,
      "conversation_unavailable",
      "This conversation is no longer available.",
    );
  const user = row.edited_id
    ? publicMessageMetadata({ id: row.edited_id, role: "user", status: "complete", created_at: row.edited_created_at })
    : turn.accepted;
  return {
    conversation: publicConversation(row),
    assistant: publicMessageMetadata({
      id: row.answer_id, role: "assistant", status: row.answer_status, created_at: row.answer_created_at,
    }),
    ...(user && { user }),
  };
}
