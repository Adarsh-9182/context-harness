import { requestUser } from "@/lib/server/auth";
import { requireMutation, parseJson, errorResponse } from "@/lib/server/http";
import {
  conversationDetail,
  switchModel,
  conversationPatchSchema,
  renameConversation,
  removeConversation,
} from "@/lib/server/service";
import { consumeRateLimit } from "@/lib/server/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requestUser(request);
    await consumeRateLimit(user.id, "read");
    return Response.json(
      await conversationDetail(
        user.id,
        (await context.params).id,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireMutation(request);
    const user = await requestUser(request);
    await consumeRateLimit(user.id, "conversations");
    const id = (await context.params).id;
    const input = await parseJson(request, conversationPatchSchema);
    return Response.json(
      "title" in input
        ? await renameConversation(user.id, id, input.title)
        : await switchModel(user.id, id, input),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireMutation(request);
    const user = await requestUser(request);
    await consumeRateLimit(user.id, "conversations");
    await removeConversation(user.id, (await context.params).id);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
