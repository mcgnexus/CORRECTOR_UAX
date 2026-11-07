import { z } from "zod";
import { auth } from "@/auth";
import { readJsonLimited } from "@/lib/http";
import { deleteDirectoryStudent, updateDirectoryStudent } from "@/lib/students";

type Context = { params: Promise<{ studentId: string }> };

export async function PATCH(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autorizado." }, { status: 401 });
  const { studentId } = await context.params;
  if (!z.string().uuid().safeParse(studentId).success) return Response.json({ error: "Alumno no encontrado." }, { status: 404 });
  const body = await readJsonLimited(request, 40_000);
  if (body.status !== "ok") return Response.json({ error: "Datos no válidos." }, { status: 400 });
  const result = await updateDirectoryStudent(session.user.id, studentId, body.value);
  if (result.status === "not_found") return Response.json({ error: "Alumno no encontrado." }, { status: 404 });
  if (result.status === "invalid") return Response.json({ error: result.message }, { status: 400 });
  if (result.status === "duplicate") return Response.json({ error: "El DNI o código académico ya está registrado." }, { status: 409 });
  if (result.status === "conflict") return Response.json({ error: "La ficha cambió en otra pestaña. Recarga las fichas y vuelve a abrir la edición; tus cambios no se han guardado.", code: "version_conflict" }, { status: 409 });
  return Response.json({ student: result.student });
}

export async function DELETE(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autorizado." }, { status: 401 });
  const { studentId } = await context.params;
  if (!z.string().uuid().safeParse(studentId).success) return Response.json({ error: "Alumno no encontrado." }, { status: 404 });
  const body = await readJsonLimited(request, 1024);
  const parsed = body.status === "ok" ? z.object({ confirmation: z.literal("ELIMINAR FICHA") }).strict().safeParse(body.value) : null;
  if (!parsed?.success) return Response.json({ error: "Confirma la eliminación de la ficha." }, { status: 400 });
  const result = await deleteDirectoryStudent(session.user.id, studentId, true);
  if (result.status === "not_found") return Response.json({ error: "Alumno no encontrado." }, { status: 404 });
  return new Response(null, { status: 204 });
}
