import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ProviderError } from "./types";

const APPROVED = [
  "openrouter.ai",
  "api.groq.com",
  "api.together.xyz",
  "api.fireworks.ai",
  "api.cerebras.ai",
  "api.mistral.ai",
  "api.openai.com",
  "api.deepseek.com",
];
const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
function unbracket(value: string) {
  return value.replace(/^\[|\]$/g, "").toLowerCase();
}

export function isPublicAddress(address: string): boolean {
  const value = unbracket(address);
  if (isIP(value) === 4) {
    const [a, b] = value.split(".").map(Number);
    const [, , c] = value.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(value) === 6) {
    // Permit global unicast only; excludes loopback, ULA, link-local, mapped IPv4, multicast.
    return /^[23][a-f0-9]{0,3}:/.test(value) && !value.startsWith("2001:db8:");
  }
  return false;
}

export function normalizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ProviderError(
      "invalid_request",
      400,
      "compatible",
      "Enter a valid provider API base URL.",
    );
  }
  const host = unbracket(url.hostname);
  const local =
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_LOCAL_MODELS === "true" &&
    LOCAL.has(host);
  const allowlist = new Set([
    ...APPROVED,
    ...(process.env.COMPATIBLE_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  ]);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["https:", ...(local ? ["http:"] : [])].includes(url.protocol) ||
    (!local && url.port && url.port !== "443") ||
    (!local && !allowlist.has(host))
  ) {
    throw new ProviderError(
      "invalid_request",
      400,
      "compatible",
      "Use an HTTPS API endpoint approved in COMPATIBLE_ALLOWED_HOSTS. Local endpoints require ALLOW_LOCAL_MODELS in development.",
    );
  }
  return url.href.replace(/\/$/, "");
}

/** Validate each outbound request. Redirects are separately forbidden in transport. */
export async function assertSafeEndpoint(input: string): Promise<void> {
  const url = new URL(normalizeBaseUrl(input));
  const host = unbracket(url.hostname);
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_LOCAL_MODELS === "true" &&
    LOCAL.has(host)
  )
    return;
  let addresses: { address: string }[];
  try {
    addresses = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ProviderError("network_error", 502, "compatible");
  }
  if (
    !addresses.length ||
    addresses.some((item) => !isPublicAddress(item.address))
  )
    throw new ProviderError(
      "invalid_request",
      400,
      "compatible",
      "This provider endpoint resolves to a private or reserved address.",
    );
}
