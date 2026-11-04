import { z } from "zod";
import { auth } from "@/auth";
import { deleteOwnedMatrixProfile, getOwnedMatrixProfile, saveOwnedMatrixProfile } from "@/lib/exam-matrix";
import { readJsonLimited } from "@/lib/http";

type RouteContext = { params: Promise<{ examId: string }> };
const idSchema = z.string().uuid();
const MAX_BODY_BYTES = 400_000;

async function ownedExamId(context: RouteContext) {
  const { examId } = await context.params;
  return idSchema.safeParse(examId);
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });

  const id = await ownedExamId(context);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });

  const profile = await getOwnedMatrixProfile(session.user.id, id.data);
  return Response.json({ profile });
}

export async function PUT(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });

  const id = await ownedExamId(context);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });

  const input = await readJsonLimited(request, MAX_BODY_BYTES);
  if (input.status === "too_large") return Response.json({ error: "La calibración supera el límite de tamaño." }, { status: 413 });
  if (input.status === "invalid") return Response.json({ error: "Solicitud no válida." }, { status: 400 });

  const result = await saveOwnedMatrixProfile(session.user.id, id.data, input.value);
  if (result.status === "not_found") return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  if (result.status === "invalid") {
    return Response.json({ error: "La calibración no coincide con el examen.", problems: result.problems }, { status: 422 });
  }
  return Response.json({ status: "saved" });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });

  const id = await ownedExamId(context);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });

  const result = await deleteOwnedMatrixProfile(session.user.id, id.data);
  if (result.status === "not_found") return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  return new Response(null, { status: 204 });
}
