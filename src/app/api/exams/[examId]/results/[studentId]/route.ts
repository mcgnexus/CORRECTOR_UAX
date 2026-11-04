import { z } from "zod";
import { auth } from "@/auth";
import { deleteOwnedReviewedResult } from "@/lib/exam-results";

type RouteContext = { params: Promise<{ examId: string; studentId: string }> };
const idSchema = z.string().uuid();

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const { examId, studentId } = await context.params;
  const exam = idSchema.safeParse(examId);
  const student = idSchema.safeParse(studentId);
  if (!exam.success || !student.success) return Response.json({ error: "Lectura no encontrada." }, { status: 404 });
  const result = await deleteOwnedReviewedResult(session.user.id, exam.data, student.data);
  if (result.status !== "deleted") return Response.json({ error: "Lectura no encontrada." }, { status: 404 });
  return new Response(null, { status: 204 });
}
