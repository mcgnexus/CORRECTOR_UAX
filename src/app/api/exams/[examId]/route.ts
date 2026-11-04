import { auth } from "@/auth";
import { deleteOwnedExam, findOwnedExam, updateOwnedExam } from "@/lib/exams";
import { examUpdateSchema } from "@/lib/validation";
import { z } from "zod";

type RouteContext = { params: Promise<{ examId: string }> };
const idSchema = z.string().uuid();

async function ownedId(context: RouteContext) {
  const { examId } = await context.params;
  return idSchema.safeParse(examId);
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const id = await ownedId(context);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const exam = await findOwnedExam(session.user.id, id.data);
  if (!exam) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  return Response.json(exam);
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const id = await ownedId(context);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Solicitud no válida." }, { status: 400 });
  }
  const parsed = examUpdateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Los cambios no son válidos." }, { status: 400 });

  const exam = await updateOwnedExam(session.user.id, id.data, parsed.data);
  if (exam.status === "not_found") return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  if (exam.status === "results_exist") return Response.json({ error: "Elimina explícitamente las lecturas guardadas antes de cambiar preguntas u opciones." }, { status: 409 });
  return Response.json(exam.exam);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const id = await ownedId(context);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });

  const exam = await deleteOwnedExam(session.user.id, id.data);
  if (!exam) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  return new Response(null, { status: 204 });
}
