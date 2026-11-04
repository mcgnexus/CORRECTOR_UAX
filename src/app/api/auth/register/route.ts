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

  const allowed = await checkAuthRateLimit(parsed.data.email, requestIp(request.headers));
  if (!allowed) {
    return Response.json({ message: "Solicitud procesada. Prueba iniciar sesión." }, { status: 200 });
  }

  const creada = await registerUser(parsed.data);
  if (creada) await clearAuthRateLimit(parsed.data.email, requestIp(request.headers));
  return Response.json({ message: "Solicitud procesada. Prueba iniciar sesión." }, { status: 200 });
}
