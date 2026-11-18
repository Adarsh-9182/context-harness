import { randomUUID } from "node:crypto";
import { createProvider, ProviderError } from "@/lib/providers";
import { requestUser } from "@/lib/server/auth";
import {
  requireMutation,
  parseJson,
  errorResponse,
  AppError,
} from "@/lib/server/http";
import {
  chatSchema,
  prepareTurn,
  commitTurn,
  insertMessage,
} from "@/lib/server/service";
import { connectionCredential } from "@/lib/server/account-connections";
import { db } from "@/lib/server/db";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { logEvent } from "@/lib/server/logger";
import {
  fitContext,
  DisclosureGuard,
  isDisclosureRequest,
  DISCLOSURE_REFUSAL,
} from "@/lib/server/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const active = new Set<string>();

export async function POST(request: Request) {
  let lock = "";
  let acquired = false;
  try {
    requireMutation(request);
    const user = await requestUser(request);
    await consumeRateLimit(user.id, "chat");
    const input = await parseJson(request, chatSchema);
    lock = `${user.id}:${input.conversationId}`;
    if (active.has(lock))
      throw new AppError(
        409,
        "generation_active",
        "This conversation is already responding. Stop it before sending another message.",
      );
    active.add(lock);
    acquired = true;
    const turn = await prepareTurn(user.id, input);
    const maxTokens = Math.min(turn.model.maxOutputTokens, 4096);
    const fitted = fitContext(
      turn.persona.compiled_prompt,
      turn.messages,
      turn.model.contextWindow,
      maxTokens,
    );
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal]);
    const encoder = new TextEncoder();
    let ended = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (event: string, data: unknown) => {
          if (!ended && !signal.aborted)
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
        };
        const started = Date.now();
        let output = "";
        let inputTokens = 0;
        let outputTokens = 0;
        let status = "complete";
        const timer = setTimeout(
          () => abort.abort(new Error("Generation deadline exceeded")),
          115_000,
        );
        void (async () => {
          try {
            if (isDisclosureRequest(turn.latestUser)) {
              output = DISCLOSURE_REFUSAL;
              emit("text", { text: output });
              status = "disclosure_refused";
            } else {
              const provider = createProvider(
                turn.connection.provider,
                turn.connection.base_url ?? undefined,
              );
              const guard = new DisclosureGuard(turn.persona.compiled_prompt);
              for await (const chunk of provider.stream({
                apiKey: await connectionCredential(turn.connection),
                model: turn.model.id,
                systemPrompt: turn.persona.compiled_prompt,
                messages: fitted.messages,
                maxTokens,
                signal,
              })) {
                if (signal.aborted)
                  throw new AppError(499, "cancelled", "Response stopped.");
                if (chunk.type === "text") {
                  const text = guard.push(chunk.text);
                  if (text) {
                    output += text;
                    emit("text", { text });
                  }
                } else if (chunk.type === "usage") {
                  inputTokens = chunk.inputTokens;
                  outputTokens = chunk.outputTokens;
                } else if (chunk.type === "tool_call")
                  throw new AppError(
                    400,
                    "tools_unavailable",
                    "This chat has no external tools connected. Ask for an explanation or a reviewable plan instead.",
                  );
                if (output.length > 200_000)
                  throw new AppError(
                    502,
                    "output_limit",
                    "The response reached the application length limit.",
                  );
              }
              const tail = guard.push("", true);
              if (tail) {
                output += tail;
                emit("text", { text: tail });
              }
              if (!output.trim())
                throw new AppError(
                  502,
                  "empty_response",
                  "The model returned no text. Try regenerating or select another model.",
                );
            }
            const messageId = await commitTurn(
              turn,
              output,
              status,
              signal,
            );
            emit("usage", { inputTokens, outputTokens });
            emit("done", {
              messageId,
              conversationId: turn.conversation.id,
              truncatedTurns: fitted.dropped,
            });
          } catch (error) {
            status = signal.aborted ? "cancelled" : "failed";
            if (
              output &&
              turn.action === "send" &&
              !(
                error instanceof AppError &&
                error.code === "instruction_disclosure_blocked"
              )
            )
              await insertMessage(
                turn.conversation.id,
                "assistant",
                output,
                [],
                status,
              ).catch(() => {});
            const safe =
              error instanceof AppError || error instanceof ProviderError
                ? { code: error.code, message: error.message }
                : {
                    code: signal.aborted ? "cancelled" : "generation_failed",
                    message: signal.aborted
                      ? "Response stopped."
                      : "The response could not be completed. Try again or choose another model.",
                  };
            if (!signal.aborted) emit("error", safe);
          } finally {
            clearTimeout(timer);
            const latencyMs = Date.now() - started;
            await (
              await db()
            )
              .query(
                "INSERT INTO usage_logs (id,user_id,conversation_id,provider,model_id,input_tokens,output_tokens,latency_ms,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                [
                  randomUUID(),
                  user.id,
                  turn.conversation.id,
                  turn.connection.provider,
                  turn.model.id,
                  inputTokens,
                  outputTokens,
                  latencyMs,
                  status,
                ],
              )
              .catch(() => {});
            logEvent("chat.completed", {
              provider: turn.connection.provider,
              modelId: turn.model.id,
              latencyMs,
              status,
              inputTokens,
              outputTokens,
            });
            active.delete(lock);
            ended = true;
            try {
              controller.close();
            } catch {}
          }
        })();
      },
      cancel() {
        ended = true;
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (acquired) active.delete(lock);
    return errorResponse(error);
  }
}
