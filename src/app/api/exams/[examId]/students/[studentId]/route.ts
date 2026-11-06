import { z } from "zod";
import { auth } from "@/auth";
import { resolveExamAccess } from "@/lib/access";
import { deleteOwnedStudent, updateOwnedStudent } from "@/lib/exam-results";
import { readJsonLimited } from "@/lib/http";

type RouteContext = { params: Promise<{ examId: string; studentId: string }> };
const idSchema = z.string().uuid();

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const { examId, studentId } = await context.params;
  const exam = idSchema.safeParse(examId);
  const student = idSchema.safeParse(studentId);
  if (!exam.success || !student.success) return Response.json({ error: "Alumno no encontrado." }, { status: 404 });
  const access = await resolveExamAccess(session.user.id, exam.data);
  if (!access) return Response.json({ error: "Alumno no encontrado." }, { status: 404 });
  const input = await readJsonLimited(request, 8_000);
  if (input.status === "too_large") return Response.json({ error: "La solicitud supera el límite." }, { status: 413 });
  if (input.status === "invalid") return Response.json({ error: "Solicitud no válida." }, { status: 400 });
  const result = await updateOwnedStudent(access.ownerId, exam.data, student.data, input.value);
  if (result.status === "not_found" || result.status === "student_not_found") return Response.json({ error: "Alumno no encontrado." }, { status: 404 });
  if (result.status === "invalid") return Response.json({ error: result.message }, { status: 400 });
  if (result.status === "duplicate") return Response.json({ error: "Ya existe un alumno con ese DNI/NIE en este examen." }, { status: 409 });
  if (result.status === "conflict") return Response.json({ error: "Los datos del alumno han cambiado. Recarga antes de volver a editar." }, { status: 409 });
  return Response.json({ student: result.student });
}

export async function DELETE(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const { examId, studentId } = await context.params;
  const exam = idSchema.safeParse(examId);
  const student = idSchema.safeParse(studentId);
  if (!exam.success || !student.success) return Response.json({ error: "Alumno no encontrado." }, { status: 404 });
  const confirmResult = new URL(request.url).searchParams.get("confirmResult") === "true";
  const access = await resolveExamAccess(session.user.id, exam.data);
  if (!access) return Response.json({ error: "Alumno no encontrado." }, { status: 404 });
  const result = await deleteOwnedStudent(access.ownerId, exam.data, student.data, confirmResult);
  if (result.status === "not_found" || result.status === "student_not_found") return Response.json({ error: "Alumno no encontrado." }, { status: 404 });
  if (result.status === "result_requires_confirmation") return Response.json({ error: "Confirma que también se eliminará la lectura guardada." }, { status: 409 });
  return new Response(null, { status: 204 });
}
