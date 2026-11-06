export type ExamStudentInput = { name: string; dni: string };
export type ReviewedAnswer = { questionNo: number; optionIndex: number | null };
export type CsvProblem = { row: number; message: string };

export const MAX_ROSTER_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_ROSTER_CSV_ROWS = 1000;

export function normalizeStudentDocument(input: string): { success: true; data: string } | { success: false; message: string } {
  const dni = input.trim().replace(/\s+/g, "").toUpperCase();
  if (!/^(?:[0-9]{8}|[XYZ][0-9]{7})[A-Z]$/.test(dni)) {
    return { success: false, message: "El DNI/NIE debe contener ocho cifras y una letra, o X/Y/Z, siete cifras y una letra, sin signos." };
  }
  const number = dni.slice(0, -1).replace(/^[XYZ]/, (prefix) => String("XYZ".indexOf(prefix)));
  if ("TRWAGMYFPDXBNJZSQVHLCKE"[Number(number) % 23] !== dni.at(-1)) {
    return { success: false, message: "La letra de control del DNI/NIE no es correcta." };
  }
  return { success: true, data: dni };
}

export function normalizeStudent(input: unknown): { success: true; data: ExamStudentInput } | { success: false; message: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { success: false, message: "Los datos del alumno no son válidos." };
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "name" && key !== "dni")) return { success: false, message: "Los datos contienen campos no permitidos." };
  if (typeof value.name !== "string" || typeof value.dni !== "string") return { success: false, message: "Indica nombre y DNI/NIE." };
  const name = value.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 160) return { success: false, message: "El nombre debe tener entre 2 y 160 caracteres." };
  const document = normalizeStudentDocument(value.dni);
  if (!document.success) return document;
  return { success: true, data: { name, dni: document.data } };
}

function parseCsvRows(csv: string): { rows: Array<{ row: number; cells: string[] }>; error?: CsvProblem } {
  const rows: Array<{ row: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let rowLine = 1;
  let atCellStart = true;

  const pushCell = () => {
    cells.push(cell);
    cell = "";
    atCellStart = true;
    closedQuote = false;
  };
  const pushRow = () => {
    pushCell();
    if (cells.some((value) => value.trim() !== "")) rows.push({ row: rowLine, cells });
    cells = [];
    rowLine = line + 1;
  };

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else { cell += char; if (char === "\n") line += 1; }
      continue;
    }
    if (char === '"') {
      if (!atCellStart || cell.trim() !== "") return { rows, error: { row: line, message: "Comillas CSV mal formadas." } };
      cell = "";
      quoted = true;
      atCellStart = false;
    } else if (char === ",") pushCell();
    else if (char === "\n") { pushRow(); line += 1; }
    else if (char === "\r") {
      if (csv[i + 1] === "\n") { pushRow(); i += 1; line += 1; }
      else cell += char;
    } else {
      if (closedQuote && char.trim() !== "") return { rows, error: { row: line, message: "Hay contenido después del cierre de comillas." } };
      if (!closedQuote) cell += char;
      atCellStart = false;
    }
  }
  if (quoted) return { rows, error: { row: rowLine, message: "Hay un campo CSV sin cerrar." } };
  if (cells.length > 0 || cell.length > 0) pushRow();
  return { rows };
}

export function parseRosterCsv(csv: unknown): { success: true; students: ExamStudentInput[]; rows: number[] } | { success: false; problems: CsvProblem[] } {
  if (typeof csv !== "string") return { success: false, problems: [{ row: 1, message: "El CSV debe ser texto UTF-8." }] };
  if (new TextEncoder().encode(csv).byteLength > MAX_ROSTER_CSV_BYTES) return { success: false, problems: [{ row: 1, message: "El CSV supera el límite de 2 MB." }] };
  const parsed = parseCsvRows(csv.replace(/^\uFEFF/, ""));
  if (parsed.error) return { success: false, problems: [parsed.error] };
  if (parsed.rows.length < 2) return { success: false, problems: [{ row: 1, message: "El CSV debe incluir encabezado y al menos un alumno." }] };
  const headers = parsed.rows[0].cells.map((cell) => cell.trim().toLocaleLowerCase("es-ES"));
  const nameIndex = headers.indexOf("nombre");
  const dniIndex = headers.indexOf("dni");
  if (nameIndex < 0 || dniIndex < 0 || nameIndex === dniIndex || headers.length !== 2) {
    return { success: false, problems: [{ row: parsed.rows[0].row, message: "El encabezado debe contener únicamente las columnas nombre,dni." }] };
  }
  const dataRows = parsed.rows.slice(1);
  const problems: CsvProblem[] = [];
  const students: ExamStudentInput[] = [];
  const studentRows: number[] = [];
  const seen = new Set<string>();
  if (dataRows.length > MAX_ROSTER_CSV_ROWS) return { success: false, problems: [{ row: dataRows[MAX_ROSTER_CSV_ROWS].row, message: `El CSV supera el límite de ${MAX_ROSTER_CSV_ROWS} alumnos.` }] };

  for (const record of dataRows) {
    if (record.cells.length !== 2) {
      problems.push({ row: record.row, message: "La fila debe tener exactamente dos columnas." });
      continue;
    }
    const normalized = normalizeStudent({ name: record.cells[nameIndex], dni: record.cells[dniIndex] });
    if (!normalized.success) {
      problems.push({ row: record.row, message: normalized.message });
      continue;
    }
    if (seen.has(normalized.data.dni)) {
      problems.push({ row: record.row, message: "El DNI está duplicado en el archivo." });
      continue;
    }
    seen.add(normalized.data.dni);
    students.push(normalized.data);
    studentRows.push(record.row);
  }
  return problems.length ? { success: false, problems } : { success: true, students, rows: studentRows };
}

export function validateReviewedAnswers(value: unknown, numQuestions: number, numOptions: number): { success: true; answers: ReviewedAnswer[] } | { success: false; message: string } {
  if (!Array.isArray(value) || value.length !== numQuestions) return { success: false, message: `Debes confirmar exactamente ${numQuestions} respuestas.` };
  const answers: ReviewedAnswer[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { success: false, message: "Hay una respuesta no válida." };
    const candidate = item as Record<string, unknown>;
    const { questionNo, optionIndex } = candidate;
    if (!Number.isInteger(questionNo) || (questionNo as number) < 1 || (questionNo as number) > numQuestions || seen.has(questionNo as number)) {
      return { success: false, message: "Las preguntas deben ser únicas y estar dentro del examen." };
    }
    if (optionIndex !== null && (!Number.isInteger(optionIndex) || (optionIndex as number) < 0 || (optionIndex as number) >= numOptions)) {
      return { success: false, message: "Hay una opción fuera del rango del examen." };
    }
    if (Object.keys(candidate).some((key) => key !== "questionNo" && key !== "optionIndex")) return { success: false, message: "Una respuesta contiene campos no permitidos." };
    seen.add(questionNo as number);
    answers.push({ questionNo: questionNo as number, optionIndex: optionIndex as number | null });
  }
  answers.sort((a, b) => a.questionNo - b.questionNo);
  if (answers.some((answer, index) => answer.questionNo !== index + 1)) return { success: false, message: "Falta confirmar alguna pregunta." };
  return { success: true, answers };
}
