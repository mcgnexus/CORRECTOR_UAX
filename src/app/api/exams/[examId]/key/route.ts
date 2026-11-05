import { z } from "zod";
import { auth } from "@/auth";
import { resolveExamAccess } from "@/lib/access";
import { saveOwnedAnswerKeyDraft } from "@/lib/exam-keys";
import { readJsonLimited } from "@/lib/http";

type RouteContext = { params: Promise<{ examId: string }> };
const idSchema = z.string().uuid();
const MAX_BODY_BYTES = 64_000;

export async function PUT(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });

  const { examId } = await context.params;
  const id = idSchema.safeParse(examId);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });

  const access = await resolveExamAccess(session.user.id, id.data);
  if (!access) return Response.json({ error: "Examen no encontrado." }, { status: 404 });

  const input = await readJsonLimited(request, MAX_BODY_BYTES);
  if (input.status === "too_large") return Response.json({ error: "La clave supera el límite de tamaño." }, { status: 413 });
  if (input.status === "invalid") return Response.json({ error: "Solicitud no válida." }, { status: 400 });

  const result = await saveOwnedAnswerKeyDraft(access.ownerId, id.data, input.value);
  if (result.status === "not_found") return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  if (result.status === "invalid") return Response.json({ error: result.message }, { status: 400 });
  return Response.json({ status: "key_pending" });
}
