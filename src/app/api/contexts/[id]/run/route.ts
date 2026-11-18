import { requestUser } from "@/lib/server/auth";
import { errorResponse, json, parseJson, requireMutation } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { runContext, switchSchema } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireMutation(request);
    const user = await requestUser(request);
    await consumeRateLimit(user.id, "conversations");
    const input = await parseJson(request, switchSchema);
    return json(await runContext(user.id, (await params).id, input), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
