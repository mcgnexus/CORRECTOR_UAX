import { z } from "zod";
import { auth } from "@/auth";
import { getOwnedScoringRule, saveOwnedScoringRule } from "@/lib/exam-scoring";
import { readJsonLimited } from "@/lib/http";

type RouteContext = { params: Promise<{ examId: string }> };
const idSchema = z.string().uuid();

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const { examId } = await context.params;
  const id = idSchema.safeParse(examId);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const data = await getOwnedScoringRule(session.user.id, id.data);
  if (!data) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  return Response.json(data);
}

export async function PUT(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const { examId } = await context.params;
  const id = idSchema.safeParse(examId);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const input = await readJsonLimited(request, 4_000);
  if (input.status === "too_large") return Response.json({ error: "La regla supera el límite." }, { status: 413 });
  if (input.status === "invalid") return Response.json({ error: "Solicitud no válida." }, { status: 400 });
  const result = await saveOwnedScoringRule(session.user.id, id.data, input.value);
  if (result.status === "not_found") return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  if (result.status === "invalid") return Response.json({ error: result.message }, { status: 400 });
  if (result.status === "key_invalid") return Response.json({ error: "La clave marcada como validada no supera la validación." }, { status: 409 });
  return Response.json({ status: "saved", rule: result.rule, recalculated: result.recalculated, keyValidated: result.keyValidated });
}
