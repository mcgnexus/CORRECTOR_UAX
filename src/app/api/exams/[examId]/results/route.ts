import { z } from "zod";
import { auth } from "@/auth";
import { saveOwnedReviewedResult } from "@/lib/exam-results";
import { readJsonLimited } from "@/lib/http";

type RouteContext = { params: Promise<{ examId: string }> };
const idSchema = z.string().uuid();

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const { examId } = await context.params;
  const id = idSchema.safeParse(examId);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
  if (!z.string().uuid().safeParse(idempotencyKey).success) return Response.json({ error: "Falta una clave Idempotency-Key UUID válida." }, { status: 400 });
  const input = await readJsonLimited(request, 24_000);
  if (input.status === "too_large") return Response.json({ error: "La lectura supera el límite de tamaño." }, { status: 413 });
  if (input.status === "invalid") return Response.json({ error: "Solicitud no válida." }, { status: 400 });
  const result = await saveOwnedReviewedResult(session.user.id, id.data, input.value, idempotencyKey);
  if (result.status === "not_found") return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  if (result.status === "student_not_found") return Response.json({ error: "Alumno no encontrado en este examen." }, { status: 404 });
  if (result.status === "exists") return Response.json({ error: "Este alumno ya tiene una lectura. Confirma el reemplazo.", code: "exists" }, { status: 409 });
  if (result.status === "key_not_validated") return Response.json({ error: "Valida la clave del examen antes de guardar entregas.", code: "key_not_validated" }, { status: 409 });
  if (result.status === "key_invalid") return Response.json({ error: "La clave validada no supera la validación." }, { status: 409 });
  if (result.status === "version_conflict") return Response.json({ error: "La entrega cambió desde que se abrió. Recarga el roster antes de volver a guardar.", code: "version_conflict" }, { status: 409 });
  if (result.status === "idempotency_conflict") return Response.json({ error: "La clave de idempotencia ya se usó con otros datos.", code: "idempotency_conflict" }, { status: 409 });
  if (result.status === "replayed_deleted") return Response.json({ error: "La entrega asociada a este reintento se eliminó; inicia una nueva corrección." }, { status: 410 });
  if (result.status === "invalid") return Response.json({ error: result.message }, { status: 400 });
  return Response.json({ status: "saved", replayed: result.replayed, result: result.result });
}
