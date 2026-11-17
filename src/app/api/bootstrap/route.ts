import { requestUser, developmentCookie } from "@/lib/server/auth";
import { bootstrap } from "@/lib/server/service";
import { errorResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requestUser(request);
    const headers = new Headers({ "Cache-Control": "no-store" });
    const cookie = developmentCookie(request);
    if (cookie) headers.set("Set-Cookie", await cookie);
    return Response.json(await bootstrap(user), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
