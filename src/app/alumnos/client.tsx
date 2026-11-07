"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { withStudentImportSource, type DirectoryStudentInput } from "@/lib/student-data";
import type { ColumnMapping } from "@/lib/student-import";

type Student = DirectoryStudentInput & { id: string; version: number };
type PreviewRow = DirectoryStudentInput & { sourceSheet: string; sourceRow: number };
type Sheet = { name: string; hidden: boolean; headers: string[]; rowCount: number; mapping: ColumnMapping };
const empty: DirectoryStudentInput = { name: "", dni: null, email: null, academicCode: null, groups: [], metadata: {} };
const fields = { name: "Nombre", lastName: "Apellidos", dni: "DNI/NIE", email: "Correo", academicCode: "Código académico", groups: "Grupos" } as const;

async function jsonRequest(url: string, method: string, input?: unknown) {
  const response = await fetch(url, { method, headers: input === undefined ? undefined : { "Content-Type": "application/json" }, body: input === undefined ? undefined : JSON.stringify(input), cache: "no-store" });
  if (response.status === 204) return {};
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "No se pudo completar la operación.");
  return result;
}

export default function StudentsClient({ initialStudents, exams }: { initialStudents: Student[]; exams: Array<{ id: string; title: string }> }) {
  const [students, setStudents] = useState(initialStudents);
  const [query, setQuery] = useState(""); const [group, setGroup] = useState("");
  const [selected, setSelected] = useState<string[]>([]); const [examId, setExamId] = useState("");
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<DirectoryStudentInput>(empty);
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetSelection, setSheetSelection] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [problems, setProblems] = useState<Array<{ sheet: string; row: number; message: string }>>([]);
  const [omitted, setOmitted] = useState<number[]>([]);
  const [acknowledged, setAcknowledged] = useState(false); const [stale, setStale] = useState(false);
  const groups = [...new Set(students.flatMap((s) => s.groups))].sort();
  const visible = students.filter((s) => (!group || s.groups.includes(group)) && `${s.name} ${s.dni ?? ""} ${s.email ?? ""} ${s.academicCode ?? ""}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));

  async function act(callback: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try { await callback(); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo completar la operación."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function reload() {
    const data = await jsonRequest("/api/students", "GET");
    setStudents(data.students); setSelected([]);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      const data = await jsonRequest(editing ? `/api/students/${editing}` : "/api/students", editing ? "PATCH" : "POST", { ...draft, groups: draft.groups.map((g) => g.trim()).filter(Boolean), ...(editing ? { expectedVersion: editVersion } : {}) });
      setStudents((current) => editing ? current.map((s) => s.id === editing ? data.student : s) : [...current, data.student]);
      setEditing(undefined); setMessage("Ficha guardada. Las inscripciones y notas de exámenes anteriores no se han modificado.");
    });
  }

  function inspect() {
    void act(async () => {
      if (!file) throw new Error("Selecciona un archivo XLSX.");
      if (file.size > 5 * 1024 * 1024 || !/\.xlsx$/i.test(file.name)) throw new Error("Selecciona un XLSX de hasta 5 MiB.");
      // ASCII JSON in headers also supports accented sheet names via escaped Unicode.
      const selection = JSON.stringify(sheets.filter((s) => sheetSelection.includes(s.name)).map((s) => ({ sheet: s.name, mapping: s.mapping }))).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
      const response = await fetch("/api/students/import", { method: "POST", headers: sheets.length ? { "x-sheet-selection": selection } : undefined, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo leer el archivo.");
      if (!sheets.length) { setSheets(result.sheets); setSheetSelection(result.sheets.filter((s: Sheet) => !s.hidden).map((s: Sheet) => s.name)); }
      setPreview(result.students); setProblems(result.problems); setOmitted([]); setAcknowledged(false); setStale(false);
      setMessage("Vista previa preparada. Todavía no se ha guardado ningún alumno.");
    });
  }

  function confirmImport() {
    void act(async () => {
      const records = preview.filter((_, i) => !omitted.includes(i)).map(({ sourceSheet, sourceRow, ...s }) => ({ ...s, metadata: withStudentImportSource(s.metadata, sourceSheet, sourceRow) }));
      const result = await jsonRequest("/api/students/import", "PATCH", { students: records, acknowledgeUnidentified: acknowledged });
      await reload(); setPreview([]); setSheets([]); setFile(null); setAcknowledged(false);
      setMessage(result.replayed ? "Este lote ya se había importado; no se han creado duplicados." : `Se han importado ${result.count} alumnos en tu cuenta.`);
    });
  }

  return <>
    <h1>Alumnos</h1>
    <p>Tu base privada, reutilizable entre tus exámenes. El DNI/NIE es recomendable, pero no obligatorio.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status" className="ok">{message}</p>}
    <section className="tarjeta" aria-labelledby="directory-title">
      <h2 id="directory-title">Base de alumnos ({students.length})</h2>
      <button type="button" className="secundario" disabled={busy} onClick={() => void act(async () => { await reload(); setEditing(undefined); setMessage("Fichas actualizadas. Abre de nuevo la ficha para editar los datos actuales."); })}>Recargar fichas</button>
      <label htmlFor="student-search">Buscar alumnos</label><input id="student-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre, correo, DNI o código" />
      <label htmlFor="student-group">Filtrar por grupo</label><select id="student-group" value={group} onChange={(e) => setGroup(e.target.value)}><option value="">Todos los grupos</option>{groups.map((g) => <option key={g}>{g}</option>)}</select>
      <div className="fila-acciones" style={{ marginTop: "1rem" }}><button type="button" disabled={busy} onClick={() => { setEditing(null); setDraft(empty); }}>Nuevo alumno</button><button type="button" className="secundario" disabled={busy || !visible.length} onClick={() => setSelected([...new Set([...selected, ...visible.map((s) => s.id)])])}>Seleccionar visibles</button><button type="button" className="secundario" disabled={busy || !selected.length} onClick={() => setSelected([])}>Limpiar selección</button></div>
      {visible.length === 0 && <p>No hay alumnos que mostrar. Puedes crear una ficha o importar el Excel.</p>}
      <ul className="student-directory-list">{visible.map((student) => <li key={student.id}>
        <label className="student-check"><input type="checkbox" aria-label={`Seleccionar ${student.name}`} checked={selected.includes(student.id)} disabled={busy} onChange={(e) => setSelected((current) => e.target.checked ? [...current, student.id] : current.filter((id) => id !== student.id))} /><span><strong>{student.name}</strong></span></label>
        <p>{student.email ?? "Sin correo"} · DNI: {student.dni ?? "No indicado"}{student.academicCode ? ` · Código: ${student.academicCode}` : ""}</p>
        <p>{student.groups.join(" · ") || "Sin grupo"}</p>
        {Object.keys(student.metadata).length > 0 && <details><summary>Datos adicionales</summary><dl>{Object.entries(student.metadata).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></details>}
        <div className="fila-acciones"><button className="secundario" type="button" disabled={busy} onClick={() => { setEditing(student.id); setEditVersion(student.version); setDraft({ name: student.name, dni: student.dni, email: student.email, academicCode: student.academicCode, groups: [...student.groups], metadata: { ...student.metadata } }); }}>Editar ficha</button><button className="secundario" type="button" disabled={busy} onClick={() => {
          if (window.confirm(`Eliminar la ficha de ${student.name}. Se conservarán las inscripciones y resultados anteriores.`)) void act(async () => { await jsonRequest(`/api/students/${student.id}`, "DELETE", { confirmation: "ELIMINAR FICHA" }); setStudents((s) => s.filter((v) => v.id !== student.id)); setSelected((s) => s.filter((v) => v !== student.id)); setMessage("Ficha eliminada. El historial de exámenes se conserva."); });
        }}>Eliminar ficha</button></div>
      </li>)}</ul>
      <fieldset disabled={busy || !selected.length}>
        <legend>Asignar {selected.length} alumnos a un examen</legend>
        <label htmlFor="destination-exam">Examen de destino</label><select id="destination-exam" value={examId} onChange={(e) => setExamId(e.target.value)}><option value="">Selecciona un examen</option>{exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select>
        <button type="button" disabled={busy || !examId || !selected.length} onClick={() => void act(async () => { const result = await jsonRequest("/api/students/assign", "POST", { examId, studentIds: selected }); setMessage(`Se han añadido ${result.count} inscripciones. Los alumnos ya asignados no se duplican.`); })}>Asignar seleccionados</button>
      </fieldset>
      {!exams.length && <p><Link href="/examenes">Crea un examen</Link> para poder asignarle alumnos.</p>}
    </section>
    {editing !== undefined && <section className="tarjeta" aria-labelledby="student-form-title"><h2 id="student-form-title">{editing ? "Editar ficha de alumno" : "Nuevo alumno"}</h2>
      <form onSubmit={save}><fieldset disabled={busy}><legend>Datos del alumno</legend>
        <label htmlFor="student-name">Nombre completo</label><input autoFocus id="student-name" required minLength={2} maxLength={160} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <label htmlFor="student-dni">DNI/NIE (opcional, recomendado)</label><input id="student-dni" maxLength={20} value={draft.dni ?? ""} onChange={(e) => setDraft({ ...draft, dni: e.target.value || null })} />
        <label htmlFor="student-email">Correo del alumno</label><input id="student-email" type="email" maxLength={254} value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value || null })} />
        <label htmlFor="student-code">Código académico (opcional)</label><input id="student-code" maxLength={100} value={draft.academicCode ?? ""} onChange={(e) => setDraft({ ...draft, academicCode: e.target.value || null })} />
        <label htmlFor="student-groups">Grupos (separados por comas)</label><input id="student-groups" value={draft.groups.join(",")} onChange={(e) => setDraft({ ...draft, groups: e.target.value.split(",") })} />
        {Object.entries(draft.metadata).map(([key, value], index) => <div key={key}><label htmlFor={`student-meta-${index}`}>{key}</label><input id={`student-meta-${index}`} maxLength={500} value={value} onChange={(e) => setDraft({ ...draft, metadata: { ...draft.metadata, [key]: e.target.value } })} /></div>)}
        <p className="nota">Editar esta ficha no modifica los datos históricos de los exámenes.</p>
        <div className="fila-acciones"><button type="submit">Guardar alumno</button><button type="button" className="secundario" onClick={() => setEditing(undefined)}>Cancelar</button></div>
      </fieldset></form>
    </section>}
    <section className="tarjeta" aria-labelledby="import-title"><h2 id="import-title">Importar Excel</h2>
      <p>XLSX hasta 5 MiB y 1000 alumnos por lote. Los datos se procesan aquí, sin enviarlos a la IA. Se conservan correo, grupos y anotaciones adicionales.</p>
      <label htmlFor="student-file">Archivo Excel</label><input id="student-file" type="file" accept=".xlsx" disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSheets([]); setPreview([]); setProblems([]); setAcknowledged(false); setStale(false); }} />
      {sheets.map((sheet, sheetIndex) => <fieldset key={sheet.name} disabled={busy}>
        <legend><label className="student-check"><input type="checkbox" checked={sheetSelection.includes(sheet.name)} onChange={(e) => { setSheetSelection((c) => e.target.checked ? [...c, sheet.name] : c.filter((s) => s !== sheet.name)); setStale(true); setAcknowledged(false); }} />{sheet.name} ({sheet.rowCount} filas){sheet.hidden ? " · hoja oculta" : ""}</label></legend>
        {sheetSelection.includes(sheet.name) && <div className="student-mapping">{Object.entries(fields).map(([key, label]) => <div key={key}><label htmlFor={`mapping-${sheetIndex}-${key}`}>{label}</label><select id={`mapping-${sheetIndex}-${key}`} value={sheet.mapping[key as keyof ColumnMapping] ?? -1} onChange={(e) => {
          setSheets((current) => current.map((s, i) => { if (i !== sheetIndex) return s; const mapping = { ...s.mapping }; const value = Number(e.target.value); if (value < 0 && key !== "name") delete mapping[key as keyof ColumnMapping]; else mapping[key as keyof ColumnMapping] = value; return { ...s, mapping }; })); setStale(true); setAcknowledged(false);
        }}><option value={-1}>{key === "name" ? "Selecciona columna" : "No existe"}</option>{sheet.headers.map((h, i) => <option value={i} key={i}>{h}</option>)}</select></div>)}</div>}
      </fieldset>)}
      <button type="button" disabled={busy || !file || (sheets.length > 0 && !sheetSelection.length)} onClick={inspect}>Previsualizar Excel</button>
      {stale && <p role="status">Actualiza la vista previa después de cambiar hojas o columnas.</p>}
      {problems.length > 0 && <div role="alert" className="error"><p>Revisa los problemas antes de importar. Las filas inválidas no se incluyen:</p><ul>{problems.map((p, i) => <li key={i}>{p.sheet}, fila {p.row}: {p.message}</li>)}</ul></div>}
      {preview.length > 0 && <>
        <h3>Vista previa ({preview.length - omitted.length} seleccionados)</h3><p>Desmarca las filas que no quieras importar. Los nombres repetidos no se fusionan; revisa los posibles homónimos.</p>
        <div className="student-preview-scroll"><table><thead><tr><th>Importar</th><th>Origen</th><th>Alumno</th><th>Correo</th><th>Grupos y notas</th></tr></thead><tbody>{preview.map((s, i) => <tr key={i}>
          <td><input type="checkbox" aria-label={`Importar fila ${s.sourceRow} de ${s.sourceSheet}`} checked={!omitted.includes(i)} disabled={busy || stale} onChange={(e) => { setOmitted((c) => e.target.checked ? c.filter((j) => i !== j) : [...c, i]); setAcknowledged(false); }} /></td>
          <td>{s.sourceSheet}, {s.sourceRow}</td><td>{s.name}<br />DNI: {s.dni ?? "No indicado"}{s.academicCode && <><br />Código: {s.academicCode}</>}{students.some((c) => c.name.toLocaleLowerCase("es") === s.name.toLocaleLowerCase("es") || (s.dni && c.dni === s.dni) || (s.academicCode && c.academicCode === s.academicCode)) && <p className="error">Posible alumno existente. Revisa u omite la fila.</p>}</td><td>{s.email ?? "No indicado"}</td><td>{s.groups.join(", ")}{Object.entries(s.metadata).map(([k, v]) => <div key={k}>{k}: {v}</div>)}</td>
        </tr>)}</tbody></table></div>
        <label className="student-check"><input type="checkbox" disabled={busy || stale} checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />He revisado las filas y los posibles homónimos. Acepto crear fichas independientes para alumnos sin DNI ni código.</label>
        <button type="button" disabled={busy || stale || !acknowledged || preview.length === omitted.length} onClick={confirmImport}>Confirmar importación</button>
      </>}
    </section>
  </>;
}
