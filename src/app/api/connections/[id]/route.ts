import { requestUser } from "@/lib/server/auth";
import { requireMutation, errorResponse } from "@/lib/server/http";
import { removeConnection } from "@/lib/server/service";
export const runtime = "nodejs";
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireMutation(request);
    const user = await requestUser(request);
    await removeConnection(user.id, (await context.params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
