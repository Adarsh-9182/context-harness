import { requestUser } from "@/lib/server/auth";
import { requireMutation, parseJson, errorResponse } from "@/lib/server/http";
import {
  bootstrap,
  createConversation,
  conversationSchema,
} from "@/lib/server/service";
import { consumeRateLimit } from "@/lib/server/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return Response.json(
      (await bootstrap(await requestUser(request))).conversations,
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
    await consumeRateLimit(user.id, "conversations");
    return Response.json(
      await createConversation(
        user,
        await parseJson(request, conversationSchema),
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
