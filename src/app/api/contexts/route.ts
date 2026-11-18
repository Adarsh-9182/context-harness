import { requestUser } from "@/lib/server/auth";
import { contextInputSchema, createContext, listContexts } from "@/lib/server/contexts";
import { errorResponse, json, parseJson, requireMutation } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requestUser(request);
    await consumeRateLimit(user.id, "read");
    return json(await listContexts(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireMutation(request);
    const user = await requestUser(request);
    await consumeRateLimit(user.id, "personas");
    const input = await parseJson(request, contextInputSchema);
    return json(await createContext(user.id, input), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
