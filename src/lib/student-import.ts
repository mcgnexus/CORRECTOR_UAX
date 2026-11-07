import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { SaxesParser } from "saxes";
import { z } from "zod";
import { normalizeStudentDocument } from "./exam-roster";
import { normalizeDirectoryStudent } from "./student-data";

export type ImportStudent = {
  name: string;
  dni: string | null;
  email: string | null;
  academicCode: string | null;
  groups: string[];
  metadata: Record<string, string>;
};

export type ColumnMapping = {
  name: number;
  lastName?: number;
  dni?: number;
  email?: number;
  academicCode?: number;
  groups?: number;
};

export type ImportSheet = {
  name: string;
  hidden: boolean;
  headers: string[];
  rows: Array<{ row: number; cells: string[] }>;
  mapping: ColumnMapping;
};

const MAX_EXPANSION = 20 * 1024 * 1024;
const MAPPING_KEYS = ["name", "lastName", "dni", "email", "academicCode", "groups"] as const;
class ImportError extends Error {}

function checkReference(reference: string) {
  for (const part of reference.split(":")) {
    const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(part);
    if (!match) throw new ImportError("El XLSX contiene coordenadas de celda no validas.");
    let column = 0;
    for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
    if (column > 50) throw new ImportError("El XLSX supera el limite de 50 columnas por hoja.");
    if (Number(match[2]) > 10000) throw new ImportError("El XLSX supera el limite de 10000 filas por hoja.");
  }
}

function checkXml(xml: string, filename: string) {
  const worksheet = /^xl\/worksheets\/[^/]+\.xml$/i.test(filename);
  let rowCount = 0;
  let cellCount = 0;
  let sheetCount = 0;
  const parser = new SaxesParser();
  parser.on("doctype", () => { throw new ImportError("El XLSX contiene XML con DTD no permitido."); });
  parser.on("error", () => { throw new ImportError("El XLSX contiene XML corrupto o no compatible."); });
  parser.on("opentag", (tag) => {
    const name = tag.name.split(":").at(-1);
    if (filename === "[Content_Types].xml" && /macroEnabled|vbaProject/i.test(String(tag.attributes.ContentType ?? ""))) {
      throw new ImportError("No se admiten macros en el XLSX.");
    }
    if (filename === "xl/workbook.xml" && name === "sheet" && ++sheetCount > 30) {
      throw new ImportError("El XLSX supera el limite de 30 hojas.");
    }
    if (!worksheet) return;
    if (name === "f") throw new ImportError("El XLSX contiene una formula. Exporta los valores de todas las celdas antes de importar.");
    if (name === "row") {
      cellCount = 0;
      if (++rowCount > 10000 || (tag.attributes.r !== undefined && (!/^[1-9][0-9]*$/.test(String(tag.attributes.r)) || Number(tag.attributes.r) > 10000))) {
        throw new ImportError("El XLSX supera el limite de 10000 filas por hoja.");
      }
    }
    if (name === "c") {
      if (++cellCount > 50) throw new ImportError("El XLSX supera el limite de 50 columnas por hoja.");
      if (tag.attributes.r !== undefined) checkReference(String(tag.attributes.r));
    }
    if ((name === "dimension" || name === "mergeCell") && tag.attributes.ref !== undefined) checkReference(String(tag.attributes.ref));
    if (name === "col" && (Number(tag.attributes.min) > 50 || Number(tag.attributes.max) > 50)) {
      throw new ImportError("El XLSX supera el limite de 50 columnas por hoja.");
    }
  });
  parser.write(xml).close();
}

// Validate both declared and actual expansion before ExcelJS/JSZip allocate workbook models.
function checkZip(buffer: Buffer) {
  const invalid = () => new ImportError("El archivo no es un XLSX/ZIP valido, esta corrupto o utiliza un formato ZIP no compatible.");
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw invalid();
  const count = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12);
  const centralStart = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || count !== buffer.readUInt16LE(end + 8) || !count || count > 2048 || centralStart + centralSize !== end) throw invalid();
  let position = centralStart;
  let declaredTotal = 0;
  let actualTotal = 0;
  let worksheets = 0;
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || buffer.readUInt32LE(position) !== 0x02014b50) throw invalid();
    const flags = buffer.readUInt16LE(position + 8);
    const method = buffer.readUInt16LE(position + 10);
    const compressed = buffer.readUInt32LE(position + 20);
    const expanded = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const local = buffer.readUInt32LE(position + 42);
    const next = position + 46 + nameLength + extraLength + commentLength;
    if (next > end || local + 30 > centralStart || compressed === 0xffffffff || expanded === 0xffffffff || buffer.readUInt16LE(position + 34)) throw invalid();
    if (flags & 1) throw new ImportError("No se admiten archivos XLSX cifrados.");
    if (method !== 0 && method !== 8) throw invalid();
    const nameBytes = buffer.subarray(position + 46, position + 46 + nameLength);
    const filename = nameBytes.toString("utf8");
    if (!filename || filename.includes("\\") || filename.startsWith("/") || filename.split("/").some((part) => part === "." || part === "..") || names.has(filename)) throw invalid();
    names.add(filename);
    // ExcelJS recognizes this pattern even inside a longer ZIP path. Only accept
    // canonical worksheet entries so every parsed sheet receives preflight checks.
    if (/xl\/worksheets\/sheet\d+\.xml/.test(filename) && !/^xl\/worksheets\/sheet\d+\.xml$/.test(filename)) throw invalid();
    if (/vbaProject|macrosheets|externalLinks/i.test(filename)) throw new ImportError("No se admiten macros ni vinculos externos de libros en el XLSX.");
    if (/^xl\/worksheets\/[^/]+\.xml$/i.test(filename) && ++worksheets > 30) throw new ImportError("El XLSX supera el limite de 30 hojas.");
    declaredTotal += expanded;
    if (declaredTotal > MAX_EXPANSION) throw new ImportError("La expansion ZIP del XLSX supera el limite de 20 MiB.");
    if (buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method) throw invalid();
    const localNameLength = buffer.readUInt16LE(local + 26);
    const dataStart = local + 30 + localNameLength + buffer.readUInt16LE(local + 28);
    if (dataStart + compressed > centralStart || !buffer.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)) throw invalid();
    if (!(flags & 8) && (buffer.readUInt32LE(local + 18) !== compressed || buffer.readUInt32LE(local + 22) !== expanded)) throw invalid();
    const data = buffer.subarray(dataStart, dataStart + compressed);
    let content: Buffer;
    try {
      content = method === 0 ? data : inflateRawSync(data, { maxOutputLength: MAX_EXPANSION - actualTotal + 1 });
    } catch {
      throw new ImportError("El ZIP esta corrupto o su expansion supera el limite de 20 MiB.");
    }
    actualTotal += content.length;
    if (actualTotal > MAX_EXPANSION) throw new ImportError("La expansion ZIP del XLSX supera el limite de 20 MiB.");
    if (content.length !== expanded) throw invalid();
    if (/\.(xml|rels)$/i.test(filename)) {
      const xml = content.toString("utf8");
      checkXml(xml, filename);
    }
    position = next;
  }
  if (position !== end || !names.has("xl/workbook.xml") || !names.has("[Content_Types].xml")) throw invalid();
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if ("formula" in value || "sharedFormula" in value) throw new ImportError("El XLSX contiene una formula. Exporta los valores antes de importar.");
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("text" in value) return value.text;
  throw new ImportError("El XLSX contiene una celda con error o un tipo de valor no compatible.");
}

function detectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = { name: -1 };
  const aliases: Record<keyof ColumnMapping, string[]> = {
    name: ["nombre", "nombre completo", "nombre y apellidos", "name"],
    lastName: ["apellido", "apellidos", "apellido(s)", "last name"],
    dni: ["dni", "nie", "dni/nie", "documento"],
    email: ["email", "e-mail", "correo", "correo electronico", "direccion de correo"],
    academicCode: ["codigo academico", "codigo de alumno", "numero de alumno", "academic code"],
    groups: ["grupo", "grupos", "groups"],
  };
  for (const key of MAPPING_KEYS) {
    const index = headers.findIndex((header) => aliases[key].includes(header.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
    if (index >= 0) mapping[key] = index;
  }
  return mapping;
}

export async function inspectStudentWorkbook(buffer: Buffer): Promise<ImportSheet[]> {
  if (buffer.length > 5 * 1024 * 1024) throw new ImportError("El XLSX supera el limite de 5 MiB.");
  try {
    checkZip(buffer);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    if (book.worksheets.length > 30) throw new ImportError("El XLSX supera el limite de 30 hojas.");
    return book.worksheets.map((worksheet) => {
      if (worksheet.rowCount > 10000) throw new ImportError("El XLSX supera el limite de 10000 filas por hoja.");
      if (worksheet.columnCount > 50) throw new ImportError("El XLSX supera el limite de 50 columnas por hoja.");
      const rows: ImportSheet["rows"] = [];
      worksheet.eachRow((row) => {
        const cells = Array.from({ length: worksheet.columnCount }, (_, index) => cellText(row.getCell(index + 1).value));
        if (cells.some((cell) => cell.trim() !== "")) rows.push({ row: row.number, cells });
      });
      const recognized = rows.findIndex((row) => detectMapping(row.cells).name >= 0);
      const headerIndex = recognized >= 0 ? recognized : 0;
      const originalHeaders = rows[headerIndex]?.cells ?? [];
      const used = new Set<string>();
      const headers = originalHeaders.map((value, index) => {
        const column = `${index >= 26 ? "A" : ""}${String.fromCharCode(65 + index % 26)}`;
        const base = value.trim() || `Columna ${column}`;
        let title = base;
        let suffix = 2;
        while (used.has(title)) title = `${base} (${suffix++})`;
        used.add(title);
        return title;
      });
      return { name: worksheet.name, hidden: worksheet.state !== "visible", headers, rows: rows.slice(headerIndex + 1), mapping: detectMapping(originalHeaders) };
    });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("No se puede leer el XLSX: archivo corrupto, cifrado o no compatible.");
  }
}

export function mapStudentRows(sheets: ImportSheet[], selections: Array<{ sheet: string; mapping: ColumnMapping }>): {
  students: Array<ImportStudent & { sourceSheet: string; sourceRow: number }>;
  problems: Array<{ sheet: string; row: number; message: string }>;
} {
  const students: Array<ImportStudent & { sourceSheet: string; sourceRow: number }> = [];
  const problems: Array<{ sheet: string; row: number; message: string }> = [];
  const selected: Array<{ sheet: ImportSheet; mapping: ColumnMapping }> = [];
  for (const selection of selections) {
    const matches = sheets.filter((sheet) => sheet.name === selection.sheet);
    if (matches.length !== 1 || selections.filter((item) => item.sheet === selection.sheet).length !== 1) {
      problems.push({ sheet: selection.sheet, row: 0, message: "La hoja seleccionada no existe o esta repetida." });
      continue;
    }
    const sheet = matches[0];
    const mapping = selection.mapping;
    const values = Object.values(mapping).filter((value) => value !== undefined);
    if (!Number.isInteger(mapping.name) || mapping.name < 0 || Object.keys(mapping).some((key) => !MAPPING_KEYS.includes(key as keyof ColumnMapping)) || values.some((value) => !Number.isInteger(value) || value < 0 || value >= sheet.headers.length) || new Set(values).size !== values.length) {
      problems.push({ sheet: sheet.name, row: 1, message: "El mapeo debe indicar columnas validas, diferentes y con indices enteros desde cero, incluido el nombre." });
      continue;
    }
    selected.push({ sheet, mapping });
  }
  if (problems.length) return { students, problems };
  const total = selected.reduce((count, { sheet }) => count + sheet.rows.filter(({ cells }) => cells.some((cell) => typeof cell !== "string" || cell.trim() !== "")).length, 0);
  if (total > 1000) return { students, problems: [{ sheet: selected.at(-1)!.sheet.name, row: 0, message: "La seleccion supera el limite de 1000 alumnos. Reduce las hojas o filas seleccionadas." }] };
  for (const { sheet, mapping } of selected) {
    for (const { row, cells } of sheet.rows) {
      const problem = (message: string) => problems.push({ sheet: sheet.name, row, message });
      if (!Number.isInteger(row) || row < 1 || row > 10000 || cells.length !== sheet.headers.length || cells.some((cell) => typeof cell !== "string")) {
        problem("Fila malformada: el numero de fila o las celdas no coinciden con las columnas de la hoja.");
        continue;
      }
      if (cells.every((cell) => !cell.trim())) continue;
      const field = (key: keyof ColumnMapping) => mapping[key] === undefined ? "" : cells[mapping[key]!].trim();
      const firstName = field("name");
      const name = [firstName, field("lastName")].filter(Boolean).join(" ");
      if (!firstName || name.length < 2 || name.length > 160) {
        problem("El nombre es obligatorio y debe tener entre 2 y 160 caracteres.");
        continue;
      }
      const document = field("dni") ? normalizeStudentDocument(field("dni")) : null;
      if (document && !document.success) { problem(document.message); continue; }
      const email = field("email") || null;
      if (email && !z.email().safeParse(email).success) { problem("El correo electronico no es valido."); continue; }
      const mappedColumns = new Set(Object.values(mapping));
      const metadata = Object.fromEntries(sheet.headers.flatMap((header, index) => !mappedColumns.has(index) && cells[index] !== "" ? [[header, cells[index]]] : []));
      const student = {
        name, dni: document?.success ? document.data : null, email, academicCode: field("academicCode") || null,
        groups: [...new Set([sheet.name, ...field("groups").split(/[,;|\r\n]+/).map((group) => group.trim()).filter(Boolean)])],
        metadata,
      };
      const normalized = normalizeDirectoryStudent(student);
      if (!normalized.success) { problem(normalized.message); continue; }
      students.push({ ...student, sourceSheet: sheet.name, sourceRow: row });
    }
  }
  return { students, problems };
}
