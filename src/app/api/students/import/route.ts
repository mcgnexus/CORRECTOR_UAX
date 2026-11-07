import { z } from "zod";
import { auth } from "@/auth";
import { readJsonLimited } from "@/lib/http";
import { inspectStudentWorkbook, mapStudentRows } from "@/lib/student-import";
import { importDirectoryStudents } from "@/lib/students";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autorizado." }, { status: 401 });
  const max = 5 * 1024 * 1024;
  if (Number(request.headers.get("content-length") ?? 0) > max) return Response.json({ error: "El XLSX supera 5 MiB." }, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Selecciona un archivo XLSX." }, { status: 400 });
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > max) { await reader.cancel(); return Response.json({ error: "El XLSX supera 5 MiB." }, { status: 413 }); }
      chunks.push(chunk.value);
    }
    const selectionHeader = request.headers.get("x-sheet-selection");
    if (selectionHeader && selectionHeader.length > 8000) return Response.json({ error: "La selección de columnas es demasiado grande." }, { status: 400 });
    const sheets = await inspectStudentWorkbook(Buffer.concat(chunks));
    const selections = selectionHeader ? JSON.parse(selectionHeader) : sheets.filter((s) => !s.hidden).map((s) => ({ sheet: s.name, mapping: s.mapping }));
    const preview = mapStudentRows(sheets, selections);
    return Response.json({ sheets: sheets.map(({ rows, ...sheet }) => ({ ...sheet, rowCount: rows.length })), ...preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo leer el XLSX." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autorizado." }, { status: 401 });
  const body = await readJsonLimited(request, 5 * 1024 * 1024);
  const parsed = body.status === "ok" ? z.object({ students: z.array(z.unknown()).min(1).max(1000), acknowledgeUnidentified: z.boolean() }).strict().safeParse(body.value) : null;
  if (!parsed?.success) return Response.json({ error: "Revisa el lote y confirma la importación." }, { status: body.status === "too_large" ? 413 : 400 });
  const result = await importDirectoryStudents(session.user.id, parsed.data.students, parsed.data.acknowledgeUnidentified);
  if (result.status === "invalid") return Response.json({ error: result.message }, { status: 400 });
  if (result.status === "not_found") return Response.json({ error: "No autorizado." }, { status: 401 });
  if (result.status === "conflict" || result.status === "confirmation_required") return Response.json({ error: result.message }, { status: 409 });
  return Response.json(result);
}
