import { z } from "zod";
import { auth } from "@/auth";
import { resolveExamAccess } from "@/lib/access";
import { importOwnedStudents } from "@/lib/exam-results";
import { readJsonLimited } from "@/lib/http";

type RouteContext = { params: Promise<{ examId: string }> };
const idSchema = z.string().uuid();
const MAX_BODY_BYTES = 2 * 1024 * 1024 + 8_000;

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const { examId } = await context.params;
  const id = idSchema.safeParse(examId);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const access = await resolveExamAccess(session.user.id, id.data);
  if (!access) return Response.json({ error: "Examen no encontrado." }, { status: 404 });

  const input = await readJsonLimited(request, MAX_BODY_BYTES);
  if (input.status === "too_large") return Response.json({ error: "El CSV supera el límite de tamaño." }, { status: 413 });
  if (input.status === "invalid") return Response.json({ error: "Solicitud no válida." }, { status: 400 });
  const csv = input.value && typeof input.value === "object" && !Array.isArray(input.value)
    ? (input.value as Record<string, unknown>).csv
    : undefined;
  const result = await importOwnedStudents(access.ownerId, id.data, csv);
  if (result.status === "not_found") return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  if (result.status === "invalid") return Response.json({ error: "No se importó ningún alumno. Corrige las filas indicadas.", problems: result.problems }, { status: 422 });
  return Response.json({ imported: result.count }, { status: 201 });
}
