import { requestUser } from "@/lib/server/auth";
import { contextInputSchema, getContext, updateContext } from "@/lib/server/contexts";
import { errorResponse, json, parseJson, requireMutation } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await requestUser(request);
    await consumeRateLimit(user.id, "read");
    return json(await getContext(user.id, (await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    requireMutation(request);
    const user = await requestUser(request);
    await consumeRateLimit(user.id, "personas");
    const input = await parseJson(request, contextInputSchema);
    return json(await updateContext(user.id, (await params).id, input));
  } catch (error) {
    return errorResponse(error);
  }
}
