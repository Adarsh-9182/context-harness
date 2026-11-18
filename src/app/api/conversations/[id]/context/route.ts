import type { ConversationContext } from "@/lib/conversation-context";
import { requestUser } from "@/lib/server/auth";
import { readContextSnapshot } from "@/lib/server/contexts";
import { errorResponse } from "@/lib/server/http";
import { readProfessionBrief } from "@/lib/server/persona";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { getConversation, getPersona } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requestUser(request);
    await consumeRateLimit(user.id, "read");
    const conversation = await getConversation(user.id, (await context.params).id);
    const { role, focus, definition } = await getPersona(user.id, conversation.persona_id);
    const snapshot = readContextSnapshot(definition);
    const setup = readProfessionBrief(definition);

    let details: ConversationContext;
    if (snapshot) {
      const { id, revision, name, goal, instructions, references, outputFormat } = snapshot;
      details = { kind: "saved", contextId: id, revision, name, goal, instructions, references, outputFormat };
    } else if (setup) {
      const { goal, details: sourceDetails, outputFormat } = setup;
      details = { kind: "setup", role, focus, goal, details: sourceDetails, outputFormat };
    } else {
      details = { kind: "role", role, focus };
    }

    return Response.json(details, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
