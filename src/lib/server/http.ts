import { ZodError, type ZodType } from "zod";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function requireMutation(request: Request): void {
  const configured = process.env.APP_ORIGIN;
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new AppError(
      503,
      "configuration_error",
      "The application origin has not been configured.",
    );
  }
  const origin = configured
    ? new URL(configured).origin
    : new URL(request.url).origin;
  if (
    request.headers.get("origin") !== origin ||
    request.headers.get("x-harness-request") !== "1"
  ) {
    throw new AppError(
      403,
      "forbidden",
      "This request must come from your Harness workspace.",
    );
  }
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") || "",
    )
  ) {
    throw new AppError(415, "invalid_request", "Send this request as JSON.");
  }
}

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  const max = 4 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > max)
    throw new AppError(413, "input_too_large", "This request is too large.");
  if (!request.body)
    throw new AppError(
      400,
      "invalid_request",
      "A JSON request body is required.",
    );
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "",
    bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > max) {
        await reader.cancel();
        throw new AppError(
          413,
          "input_too_large",
          "This request is too large.",
        );
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      throw new AppError(
        400,
        "invalid_request",
        "The request must contain valid JSON.",
      );
    }
    return schema.parse(value);
  } finally {
    reader.releaseLock();
  }
}

const upstreamMessages: Record<string, [number, string]> = {
  invalid_key: [
    401,
    "The provider rejected this API key. Check the key and try again.",
  ],
  rate_limit: [
    429,
    "The provider is rate limiting this account. Please try again shortly.",
  ],
  model_unavailable: [
    400,
    "This model is not available to your provider account. Choose another model.",
  ],
  timeout: [504, "The provider took too long to respond. Please try again."],
  network_error: [
    502,
    "Harness could not reach the provider. Please try again.",
  ],
  invalid_request: [
    400,
    "The provider could not accept this request. Check the model and attachments.",
  ],
  upstream_error: [
    502,
    "The provider could not complete this request. Please try again.",
  ],
};

export function safeError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  if (error instanceof AppError)
    return { status: error.status, code: error.code, message: error.message };
  if (error instanceof ZodError)
    return {
      status: 400,
      code: "invalid_request",
      message: error.issues
        .map((issue) => `${issue.path.join(".") || "Input"}: ${issue.message}`)
        .slice(0, 3)
        .join(" "),
    };
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    upstreamMessages[error.code]
  ) {
    const [status, message] = upstreamMessages[error.code];
    return { status, code: error.code, message };
  }
  return {
    status: 500,
    code: "internal_error",
    message: "Something went wrong. Please try again.",
  };
}

export function errorResponse(error: unknown): Response {
  const { status, code, message } = safeError(error);
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(status === 429 ? { "Retry-After": "60" } : {}),
      },
    },
  );
}

export function json(value: unknown, init: ResponseInit = {}): Response {
  return Response.json(value, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init.headers },
  });
}
