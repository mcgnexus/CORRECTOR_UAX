import { auth } from "@/auth";
import { resolveExamAccess } from "@/lib/access";
import { deleteOwnedExam, findOwnedExam, updateOwnedExam } from "@/lib/exams";
import { examUpdateSchema } from "@/lib/validation";
import { z } from "zod";
import { matchesQueueAccount } from "@/lib/offline-queue/account";

type RouteContext = { params: Promise<{ examId: string }> };
const idSchema = z.string().uuid();

async function ownedId(context: RouteContext) {
  const { examId } = await context.params;
  return idSchema.safeParse(examId);
}

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  if (!matchesQueueAccount(request.headers, session.user.id)) return Response.json({ error: "Inicia sesión con la cuenta original de la entrega.", code: "account_changed" }, { status: 401 });
  const id = await ownedId(context);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const access = await resolveExamAccess(session.user.id, id.data);
  if (!access) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const exam = await findOwnedExam(access.ownerId, id.data);
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

  const access = await resolveExamAccess(session.user.id, id.data);
  if (!access) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const exam = await updateOwnedExam(access.ownerId, id.data, parsed.data);
  if (exam.status === "not_found") return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  if (exam.status === "invalid") return Response.json({ error: "La configuracion no es valida. UAX requiere 40 preguntas y cuatro opciones." }, { status: 400 });
  if (exam.status === "results_exist") return Response.json({ error: "Elimina explícitamente las lecturas guardadas antes de cambiar preguntas, opciones o formato." }, { status: 409 });
  return Response.json(exam.exam);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const id = await ownedId(context);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });

  const access = await resolveExamAccess(session.user.id, id.data);
  if (!access) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const exam = await deleteOwnedExam(access.ownerId, id.data);
  if (!exam) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  return new Response(null, { status: 204 });
}
