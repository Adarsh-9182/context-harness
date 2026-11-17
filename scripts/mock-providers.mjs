// Explicitly test-only upstream. Normal application servers never import this file.
import http from "node:http";
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/health") {
    res.end("ok");
    return;
  }
  const provider = url.pathname.split("/")[1];
  const key =
    req.headers.authorization ||
    req.headers["x-api-key"] ||
    req.headers["x-goog-api-key"] ||
    "";
  if (!key || String(key).includes("invalid")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { message: "Invalid test key", type: "authentication_error" },
      }),
    );
    return;
  }
  if (req.method === "GET") {
    const model =
      provider === "anthropic"
        ? {
            id: "fixture-anthropic",
            display_name: "Harness Test Claude",
            type: "model",
            created_at: "2026-01-01T00:00:00Z",
            max_input_tokens: 16000,
            max_tokens: 4096,
          }
        : {
            id: `fixture-${provider}`,
            name: `Harness Test ${provider === "openai" ? "GPT" : provider}`,
            context_window: 16000,
            max_output_tokens: 4096,
            input_modalities: ["text", "image"],
          };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [model], has_more: false }));
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const system = body.system || body.messages?.[0]?.content || "";
  const last = body.messages?.at(-1)?.content || "";
  let output;
  if (String(system).includes("You compile safe")) {
    let role = "Expert";
    try {
      role = JSON.parse(typeof last === "string" ? last : "{}").role || role;
    } catch {}
    output = JSON.stringify({
      identity: `A rigorous and patient ${role} educational assistant.`,
      expertise_areas: [
        "Foundations",
        "Problem solving",
        "Evidence and verification",
      ],
      reasoning_style:
        "State assumptions, check calculations, and explain useful intermediate steps.",
      communication_style:
        "Clear, direct, friendly language adapted to the learner.",
      teaching_approach:
        "Use worked examples and then invite a short practice question.",
      honesty_rules:
        "State uncertainty, never fabricate citations or completed actions.",
      safety_boundaries:
        "Provide constructive education and appropriate professional boundaries.",
      opening_message: `Hello! I’m your ${role} thinking partner. What would you like to explore?`,
    });
  } else
    output =
      "Let’s work through it together.\n\nFor a right triangle, the relationship is:\n\n$$a^2 + b^2 = c^2$$\n\nHere is a small example:\n\n```python\ndef square(x):\n    return x * x\n```\n\n| Idea | Meaning |\n| --- | --- |\n| Hypotenuse | The longest side |\n\nWhat would you like to try next?";
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (provider === "anthropic") {
    res.write(
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 80, output_tokens: 0 } } })}\n\n`,
    );
    for (let i = 0; i < output.length; i += 18) {
      if (res.destroyed) break;
      emit({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: output.slice(i, i + 18) },
      });
      await new Promise((r) =>
        setTimeout(r, String(last).includes("slow") ? 120 : 3),
      );
    }
    emit({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 100 },
    });
    emit({ type: "message_stop" });
  } else {
    for (let i = 0; i < output.length; i += 18) {
      if (res.destroyed) break;
      emit({
        choices: [
          {
            index: 0,
            delta: { content: output.slice(i, i + 18) },
            finish_reason: null,
          },
        ],
      });
      await new Promise((r) =>
        setTimeout(r, String(last).includes("slow") ? 120 : 3),
      );
    }
    emit({
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 80, completion_tokens: 100 },
    });
    res.write("data: [DONE]\n\n");
  }
  res.end();
});
server.listen(4519, "127.0.0.1", () =>
  console.log("Test upstream ready on 4519"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
