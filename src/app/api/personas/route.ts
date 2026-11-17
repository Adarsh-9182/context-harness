import { requestUser } from "@/lib/server/auth";
import { requireMutation, parseJson, errorResponse } from "@/lib/server/http";
import { bootstrap, createPersona } from "@/lib/server/service";
import { personaInputSchema } from "@/lib/server/persona";
import { consumeRateLimit } from "@/lib/server/rate-limit";
export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return Response.json(
      (await bootstrap(await requestUser(request))).personas,
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
    await consumeRateLimit(user.id, "persona");
    return Response.json(
      await createPersona(
        user,
        await parseJson(request, personaInputSchema),
        request.signal,
      ),
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
