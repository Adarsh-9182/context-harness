#!/usr/bin/env node
// Explicit native-client fixture. Never selected by normal Harness startup.
import { existsSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
if (process.env.HARNESS_E2E !== "true") process.exit(2);
const args = process.argv.slice(2);
const account = resolve(process.env.CLAUDE_CONFIG_DIR, ".fixture-account");
if (args[0] === "auth") {
  if (args[1] === "login") {
    console.log("Complete sign-in at https://claude.ai/oauth/authorize?fixture=true");
    await new Promise(resolve => setTimeout(resolve, 100));
    await writeFile(account, "fixture-only", { mode: 0o600 });
  } else if (args[1] === "logout") await rm(account, { force: true });
  else console.log(JSON.stringify({ loggedIn: existsSync(account), authMethod: "claude.ai" }));
  process.exit(0);
}
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const prompt = JSON.parse(raw).message.content.find(c => c.type === "text").text;
const system = args[args.indexOf("--system-prompt") + 1];
let text;
if (system.includes("You compile safe")) {
  const role = JSON.parse(JSON.parse(prompt.split("\n")[1])[0].content).role;
  text = JSON.stringify({
    identity: `A rigorous and patient ${role} educational assistant.`, expertise_areas: ["Foundations", "Problem solving"],
    reasoning_style: "Check calculations and explain useful intermediate steps.",
    communication_style: "Clear language adapted to the learner.", teaching_approach: "Use examples and invite practice.",
    honesty_rules: "State uncertainty and never fabricate citations.", safety_boundaries: "Provide constructive education and professional boundaries.",
    opening_message: `Hello! I’m your ${role} thinking partner. What would you like to explore?`,
  });
} else text = "Let’s work through it together.\n\n$$a^2 + b^2 = c^2$$\n\n```python\ndef square(x):\n    return x * x\n```\n\n| Idea | Meaning |\n| --- | --- |\n| Hypotenuse | The longest side |\n\nWhat would you like to try next?";
for (let i = 0; i < text.length; i += 18) {
  console.log(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: text.slice(i, i + 18) } } }));
  await new Promise(resolve => setTimeout(resolve, prompt.includes("slow") ? 120 : 3));
}
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, usage: { input_tokens: 80, output_tokens: 100 } }));
