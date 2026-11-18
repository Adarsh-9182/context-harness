import { requestUser } from "@/lib/server/auth";
import { requireMutation, errorResponse } from "@/lib/server/http";
import { requireLocalAccounts, readAccountLogin, cancelAccountLogin } from "@/lib/server/account-logins";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await requestUser(request);
    requireLocalAccounts(request);
    return Response.json(readAccountLogin(user.id, (await context.params).id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    requireMutation(request);
    const user = await requestUser(request);
    requireLocalAccounts(request);
    return Response.json(cancelAccountLogin(user.id, (await context.params).id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
