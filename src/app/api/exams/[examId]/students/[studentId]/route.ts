import { z } from "zod";
import { auth } from "@/auth";
import { resolveExamAccess } from "@/lib/access";
import { deleteOwnedStudent } from "@/lib/exam-results";

type RouteContext = { params: Promise<{ examId: string; studentId: string }> };
const idSchema = z.string().uuid();

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
