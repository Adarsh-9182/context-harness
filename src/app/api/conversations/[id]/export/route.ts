import { requestUser } from "@/lib/server/auth";
import { conversationDetail } from "@/lib/server/service";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { errorResponse } from "@/lib/server/http";
import {
  conversationExportFilename,
  conversationMarkdown,
} from "@/lib/server/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requestUser(request);
    await consumeRateLimit(user.id, "read");
    const conversation = await conversationDetail(user.id, (await context.params).id);
    return new Response(conversationMarkdown(conversation), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${conversationExportFilename(conversation.title)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
