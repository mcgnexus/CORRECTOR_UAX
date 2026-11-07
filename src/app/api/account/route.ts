import { eq } from "drizzle-orm";
import { verify } from "@node-rs/argon2";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { checkAuthRateLimit, clearAuthRateLimit, requestIp } from "@/lib/rate-limit";
import { readJsonLimited } from "@/lib/http";
import { getAccountProfile, updateAccountProfile } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autorizado." }, { status: 401, headers: privateHeaders });
  const profile = await getAccountProfile(session.user.id, session.user.sessionVersion);
  if (!profile) return Response.json({ error: "No autorizado." }, { status: 401, headers: privateHeaders });
  return Response.json(profile, { headers: privateHeaders });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autorizado." }, { status: 401, headers: privateHeaders });
  const parsed = await readJsonLimited(request, 4096);
  if (parsed.status !== "ok") return Response.json({ error: "Datos de perfil invalidos." }, { status: parsed.status === "too_large" ? 413 : 400, headers: privateHeaders });
  const result = await updateAccountProfile(session.user.id, session.user.sessionVersion, parsed.value, requestIp(request.headers));
  if (result.status === "updated") return Response.json({ profile: result.profile, reauthenticate: result.reauthenticate }, { headers: privateHeaders });
  const errors = {
    invalid: [400, "Revisa los campos y la confirmacion de contrasena."],
    unauthorized: [401, "La sesion ha caducado. Inicia sesion de nuevo."],
    forbidden: [403, "No se pudo verificar la contrasena actual."],
    rate_limited: [429, "Demasiados intentos. Espera antes de volver a intentarlo."],
    conflict: [409, "La cuenta ha cambiado. Inicia sesion de nuevo antes de reintentar."],
    duplicate: [409, "Ese correo ya esta en uso."],
  } as const;
  const [status, error] = errors[result.status];
  return Response.json({ error, code: result.status }, { status, headers: privateHeaders });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autorizado." }, { status: 401 });

  const parsed = await readJsonLimited(request, 4096);
  if (parsed.status !== "ok" || !parsed.value || typeof parsed.value !== "object") {
    return Response.json({ error: "Confirma la eliminación y proporciona tu contraseña actual." }, { status: 400 });
  }
  const data = parsed.value as Record<string, unknown>;
  if (Object.keys(data).some((key) => key !== "password" && key !== "confirmation") || typeof data.password !== "string" || data.password.length < 1 || data.password.length > 128 || data.confirmation !== "ELIMINAR CUENTA") {
    return Response.json({ error: "Confirma la eliminación y proporciona tu contraseña actual." }, { status: 400 });
  }

  const db = getDb();
  const [user] = await db.select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user) return Response.json({ error: "No autorizado." }, { status: 401 });
  const ip = requestIp(request.headers);
  if (!await checkAuthRateLimit(user.email, ip)) return Response.json({ error: "No se pudo verificar la contraseña." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  let valid = false;
  try { valid = await verify(user.passwordHash, data.password); } catch { /* Tratado como credencial inválida. */ }
  if (!valid) return Response.json({ error: "No se pudo verificar la contraseña." }, { status: 403 });

  await clearAuthRateLimit(user.email, ip);
  await db.transaction(async (tx) => { await tx.delete(users).where(eq(users.id, user.id)); });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
