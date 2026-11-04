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
  const input = await readJsonLimited(request, 24_000);
  if (input.status === "too_large") return Response.json({ error: "La lectura supera el límite de tamaño." }, { status: 413 });
  if (input.status === "invalid") return Response.json({ error: "Solicitud no válida." }, { status: 400 });
  const result = await saveOwnedReviewedResult(session.user.id, id.data, input.value);
  if (result.status === "not_found") return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  if (result.status === "student_not_found") return Response.json({ error: "Alumno no encontrado en este examen." }, { status: 404 });
  if (result.status === "exists") return Response.json({ error: "Este alumno ya tiene una lectura. Confirma el reemplazo." }, { status: 409 });
  if (result.status === "invalid") return Response.json({ error: result.message }, { status: 400 });
  return Response.json({ status: "saved" });
}
