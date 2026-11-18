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
  compilePersona,
  personaInputSchema,
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
  })
  .strict();
export const chatSchema = z
  .object({
    conversationId: z.string().uuid(),
    message: z.string().trim().max(40_000).optional(),
    action: z.enum(["send", "regenerate", "edit"]).default("send"),
    messageId: z.string().uuid().optional(),
    attachments: z.array(attachmentSchema).max(3).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
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

export async function publicConnection(r: ConnectionRow) {
  return publicAccountConnection(r);
}
export const publicPersona = (r: PersonaRow) => ({
  id: r.id,
  role: r.role,
  focus: r.focus,
  openingMessage: r.opening_message,
  color: r.color,
});
export const publicConversation = (r: ConversationRow) => ({
  id: r.id,
  title: r.title,
  personaId: r.persona_id,
  connectionId: r.connection_id,
  modelId: r.model_id,
  updatedAt: r.updated_at,
});
export const publicMessage = (r: MessageRow) => ({
  id: r.id,
  role: r.role,
  content: r.content,
  attachments: r.attachments ?? [],
  status: r.status,
  createdAt: r.created_at,
});

export async function ensureUser(user: UserIdentity) {
  await (
    await db()
  ).query(
    "INSERT INTO users (id,name,email) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name",
    [user.id, user.name, user.email ?? null],
  );
}
export async function bootstrap(user: UserIdentity) {
  await ensureUser(user);
  const database = await db();
  const [connections, personas, conversations] = await Promise.all([
    database.query<ConnectionRow>(
      "SELECT * FROM provider_connections WHERE user_id=$1 ORDER BY created_at ASC",
      [user.id],
    ),
    database.query<PersonaRow>(
      "SELECT * FROM personas WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [user.id],
    ),
    database.query<ConversationRow>(
      "SELECT * FROM conversations WHERE user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100",
      [user.id],
    ),
  ]);
  return {
    user: { id: user.id, name: user.name, development: user.development === true },
    connections: await Promise.all(connections.rows.filter(r => isAccountProvider(r.provider)).map(publicConnection)),
    personas: personas.rows.map(publicPersona),
    conversations: conversations.rows.map(publicConversation),
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
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify([
        user.id,
        input.role.toLowerCase().trim(),
        input.focus.toLowerCase().trim(),
        connection.provider,
        TEMPLATE_VERSION,
      ]),
    )
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
        JSON.stringify(compiled.definition),
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
export async function createConversation(
  user: UserIdentity,
  input: z.infer<typeof conversationSchema>,
) {
  const persona = await getPersona(user.id, input.personaId);
  const connection = await getConnection(user.id, input.connectionId);
  pickModel(connection, input.modelId);
  const id = randomUUID();
  await (
    await db()
  ).query(
    "INSERT INTO conversations (id,user_id,persona_id,connection_id,model_id,title) VALUES ($1,$2,$3,$4,$5,$6)",
    [
      id,
      user.id,
      persona.id,
      connection.id,
      input.modelId,
      `${persona.role} conversation`,
    ],
  );
  await insertMessage(id, "assistant", persona.opening_message, [], "greeting");
  return publicConversation(await getConversation(user.id, id));
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
  await getConversation(userId, id);
  const connection = await getConnection(userId, input.connectionId);
  pickModel(connection, input.modelId);
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
export async function prepareTurn(
  userId: string,
  input: z.infer<typeof chatSchema>,
) {
  const conversation = await getConversation(userId, input.conversationId);
  const connection = await getConnection(userId, conversation.connection_id);
  const model = pickModel(connection, conversation.model_id);
  const persona = await getPersona(userId, conversation.persona_id);
  let history = await getMessages(conversation.id);
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
      id: randomUUID(),
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
    .filter((m) => m.status !== "greeting" && m.status !== "failed")
    .map((m) => ({
      role: m.role,
      content:
        !model.supportsImages && m.attachments?.length
          ? `${m.content}\n[An image from this earlier turn is unavailable to the selected text-only model.]`
          : m.content,
      attachments: model.supportsImages ? (m.attachments ?? []) : [],
    }));
  // Validate the proposed transcript before any destructive edit or append.
  // A model switch to a smaller context must not erase the old answer when
  // regeneration or an edited replacement cannot fit.
  fitContext(
    persona.compiled_prompt,
    messages,
    model.contextWindow,
    Math.min(model.maxOutputTokens, 4096),
  );
  const firstUser = history.find((m) => m.role === "user");
  const title = firstUser?.content.slice(0, 75) || `${persona.role} · Image`;
  // A new send is durable even if the model later fails. Replacements remain
  // staged until their complete, validated response can be committed atomically.
  if (input.action === "send" && newUser) {
    const database = await db();
    await database.query(
      `INSERT INTO messages (id,conversation_id,role,content,attachments,status,created_at) VALUES ($1,$2,'user',$3,$4,'complete',${nextMessageTimestamp("$2")})`,
      [newUser.id, conversation.id, newUser.content, JSON.stringify(newUser.attachments)],
    );
    await database.query("UPDATE conversations SET title=CASE WHEN title_edited THEN title ELSE $1 END,updated_at=NOW() WHERE id=$2", [
      title,
      conversation.id,
    ]);
  }
  return {
    userId,
    action: input.action,
    conversation,
    connection,
    persona,
    model,
    messages,
    latestUser: history.findLast((m) => m.role === "user")?.content ?? "",
    title,
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
  const result = await database.query<{ id: string }>(
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
      WHERE $6::boolean RETURNING id
    ), answer AS (
      INSERT INTO messages (id,conversation_id,role,content,attachments,status,created_at)
      SELECT $7,$1,'assistant',$8,'[]'::jsonb,$9,
        stamp + CASE WHEN $6::boolean THEN INTERVAL '1 microsecond' ELSE INTERVAL '0' END
      FROM next_time RETURNING id
    ), updated AS (
      UPDATE conversations SET title=CASE WHEN title_edited THEN title ELSE $11 END,updated_at=clock_timestamp()
      WHERE id IN (SELECT id FROM owned) RETURNING id
    ) SELECT answer.id FROM answer CROSS JOIN updated`,
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
  if (!result.rows.length)
    throw new AppError(
      409,
      "conversation_unavailable",
      "This conversation is no longer available.",
    );
  return messageId;
}
