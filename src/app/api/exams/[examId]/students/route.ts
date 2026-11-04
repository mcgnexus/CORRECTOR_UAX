import { z } from "zod";
import { auth } from "@/auth";
import { createOwnedStudent, listOwnedExamRoster } from "@/lib/exam-results";
import { findOwnedExam } from "@/lib/exams";
import { readJsonLimited } from "@/lib/http";

type RouteContext = { params: Promise<{ examId: string }> };
const idSchema = z.string().uuid();

async function ownedExamId(context: RouteContext) {
  const { examId } = await context.params;
  return idSchema.safeParse(examId);
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const id = await ownedExamId(context);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  if (!await findOwnedExam(session.user.id, id.data)) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  return Response.json({ students: await listOwnedExamRoster(session.user.id, id.data) });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const id = await ownedExamId(context);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const input = await readJsonLimited(request, 8_000);
  if (input.status === "too_large") return Response.json({ error: "La solicitud supera el límite." }, { status: 413 });
  if (input.status === "invalid") return Response.json({ error: "Solicitud no válida." }, { status: 400 });
  const result = await createOwnedStudent(session.user.id, id.data, input.value);
  if (result.status === "not_found") return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  if (result.status === "invalid") return Response.json({ error: result.message }, { status: 400 });
  if (result.status === "duplicate") return Response.json({ error: "Ya existe un alumno con ese DNI en este examen." }, { status: 409 });
  return Response.json({ student: result.student }, { status: 201 });
}
