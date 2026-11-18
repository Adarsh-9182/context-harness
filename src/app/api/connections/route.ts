import { requestUser } from "@/lib/server/auth";
import { requireMutation, parseJson, errorResponse } from "@/lib/server/http";
import {
  bootstrap,
  connectionSchema,
} from "@/lib/server/service";
import { requireLocalAccounts, startAccountLogin } from "@/lib/server/account-logins";
import { consumeRateLimit } from "@/lib/server/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return Response.json(
      (await bootstrap(await requestUser(request))).connections,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    requireMutation(request);
    const user = await requestUser(request);
    requireLocalAccounts(request);
    await consumeRateLimit(user.id, "connection");
    const input = await parseJson(request, connectionSchema);
    const login = await startAccountLogin(user.id, input.provider);
    return Response.json(login, {
      status: login.status === "connected" ? 201 : 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
