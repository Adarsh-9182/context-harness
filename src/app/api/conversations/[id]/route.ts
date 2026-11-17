import { requestUser } from "@/lib/server/auth";
import { requireMutation, parseJson, errorResponse } from "@/lib/server/http";
import {
  conversationDetail,
  switchModel,
  switchSchema,
  removeConversation,
} from "@/lib/server/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(
      await conversationDetail(
        (await requestUser(request)).id,
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
    return Response.json(
      await switchModel(
        user.id,
        (await context.params).id,
        await parseJson(request, switchSchema),
      ),
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
    await removeConversation(user.id, (await context.params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
