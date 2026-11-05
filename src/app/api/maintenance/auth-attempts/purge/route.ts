import { isCronAuthorized } from "@/lib/cron-auth";
import { purgeExpiredAuthAttempts } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || Buffer.byteLength(process.env.CRON_SECRET) < 32) return Response.json({ error: "Tarea no configurada." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "No autorizado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  await purgeExpiredAuthAttempts();
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
