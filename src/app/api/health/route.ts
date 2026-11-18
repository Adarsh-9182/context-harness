import { checkReadiness } from "@/lib/server/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_MS = 3000;
let cached: { ready: boolean; expires: number } | undefined;
let pending: Promise<boolean> | undefined;

async function ready() {
  if (cached && cached.expires > Date.now()) return cached.ready;
  // Public health requests share a short cache and one probe per Node process.
  if (!pending)
    pending = checkReadiness()
      .catch(() => false)
      .then((value) => {
        cached = { ready: value, expires: Date.now() + CACHE_MS };
        return value;
      })
      .finally(() => {
        pending = undefined;
      });
  return pending;
}

export async function GET(request: Request) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (new URL(request.url).searchParams.get("mode") === "live")
    return Response.json({ status: "alive" }, { headers });
  const value = await ready();
  return Response.json(
    { status: value ? "ready" : "not_ready" },
    { status: value ? 200 : 503, headers },
  );
}
