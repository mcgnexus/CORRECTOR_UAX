import { checkAuthRateLimit, clearAuthRateLimit, requestIp } from "@/lib/rate-limit";
import { registerUser } from "@/lib/users";
import { registrationSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Revisa el nombre, correo y contraseña." }, { status: 400 });
  }

  const ip = requestIp(request.headers);
  try {
    const allowed = await checkAuthRateLimit(parsed.data.email, ip);
    if (!allowed) {
      return Response.json({ message: "Solicitud procesada. Prueba iniciar sesión." }, { status: 200 });
    }

    const creada = await registerUser(parsed.data);
    if (creada) await clearAuthRateLimit(parsed.data.email, ip);
    return Response.json({ message: "Solicitud procesada. Prueba iniciar sesión." }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout|terminating connection|Connection terminated/i.test(message)
      ? "db_unavailable"
      : "unexpected";
    console.error(JSON.stringify({ event: "register_failed", code }));
    return Response.json(
      { error: "No se pudo completar el registro por un problema temporal. Inténtalo de nuevo en unos segundos." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
