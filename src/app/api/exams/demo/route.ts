import { auth } from "@/auth";
import { createOwnedDemo, isDemoConfirmation } from "@/lib/exam-demo";
import { readJsonLimited } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const body = await readJsonLimited(request, 1024);
  if (body.status === "too_large") return Response.json({ error: "Solicitud demasiado grande." }, { status: 413 });
  if (body.status !== "ok" || !isDemoConfirmation(body.value)) {
    return Response.json({ error: "Confirma explícitamente la creación del ejemplo ficticio." }, { status: 400 });
  }
  const result = await createOwnedDemo(session.user.id);
  if (result.status === "not_found") return Response.json({ error: "Cuenta no disponible." }, { status: 401 });
  return Response.json(result, { status: result.status === "created" ? 201 : 200 });
}
