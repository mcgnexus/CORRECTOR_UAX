import { z } from "zod";
import { auth } from "@/auth";
import { resolveExamAccess } from "@/lib/access";
import { validateOwnedAnswerKey } from "@/lib/exam-keys";

type RouteContext = { params: Promise<{ examId: string }> };
const idSchema = z.string().uuid();

export async function POST(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });

  const { examId } = await context.params;
  const id = idSchema.safeParse(examId);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });

  const access = await resolveExamAccess(session.user.id, id.data);
  if (!access) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const result = await validateOwnedAnswerKey(access.ownerId, id.data);
  if (result.status === "not_found") return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  if (result.status === "invalid") {
    return Response.json({ error: "La clave no está completa o contiene respuestas inválidas.", problems: result.problems }, { status: 422 });
  }
  return Response.json({ status: "key_validated", recalculated: result.recalculated });
}
