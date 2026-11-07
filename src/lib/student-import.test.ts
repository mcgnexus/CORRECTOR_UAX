import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { inspectStudentWorkbook, mapStudentRows, type ImportSheet } from "./student-import";

async function workbookBuffer(build: (book: ExcelJS.Workbook) => void): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  build(book);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function rewriteXml(buffer: Buffer, file: string, transform: (xml: string) => string) {
  const zip = await JSZip.loadAsync(buffer);
  zip.file(file, transform(await zip.file(file)!.async("string")));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function sheet(rows: string[][], headers = ["Nombre", "DNI", "Email", "Codigo", "Grupos", "Extra"]): ImportSheet {
  return { name: "LAB sintetico", hidden: false, headers, rows: rows.map((cells, i) => ({ row: i + 2, cells })), mapping: { name: 0, dni: 1, email: 2, academicCode: 3, groups: 4 } };
}

test("inspecciona la estructura real sintetica, fechas, hyperlinks, hojas ocultas y filas vacias", async () => {
  const buffer = await workbookBuffer((book) => {
    for (const name of ["LAB1 GENETICA", "LAB2 GENETICA", "LAB3 GENETICA"]) {
      const ws = book.addWorksheet(name);
      ws.addRow(["Nombre", "Apellido(s)", "Dirección de correo", "Grupos", ...(name !== "LAB3 GENETICA" ? [null, new Date("2026-10-01T00:00:00Z")] : [])]);
      ws.addRow(["Alumna LAB1", "Sintética", { text: "alumna@example.test", hyperlink: "mailto:alumna@example.test" }, "Cambio LAB2; Grupo A", ...(name !== "LAB3 GENETICA" ? ["EXAMEN", "MENTORIA 2"] : [])]);
      ws.addRow([]);
      ws.addRow(["Otro", "Ejemplo"]);
    }
    book.addWorksheet("Oculta", { state: "veryHidden" }).addRow(["Nombre"]);
  });
  const sheets = await inspectStudentWorkbook(buffer);
  assert.equal(sheets.length, 4);
  assert.equal(sheets[3].hidden, true);
  assert.deepEqual(sheets[0].headers, ["Nombre", "Apellido(s)", "Dirección de correo", "Grupos", "Columna E", "2026-10-01T00:00:00.000Z"]);
  assert.deepEqual(sheets[0].mapping, { name: 0, lastName: 1, email: 2, groups: 3 });
  assert.deepEqual(sheets[0].rows.map((r) => r.row), [2, 4]);
  assert.equal(sheets[2].headers.length, 4);
  const before = structuredClone(sheets);
  const result = mapStudentRows(sheets, [{ sheet: sheets[0].name, mapping: sheets[0].mapping }]);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.students[0], {
    name: "Alumna LAB1 Sintética", dni: null, email: "alumna@example.test", academicCode: null,
    groups: ["LAB1 GENETICA", "Cambio LAB2", "Grupo A"],
    metadata: { "Columna E": "EXAMEN", "2026-10-01T00:00:00.000Z": "MENTORIA 2" }, sourceSheet: "LAB1 GENETICA", sourceRow: 2,
  });
  assert.deepEqual(sheets, before);
});

test("rechaza nombres de entrada worksheet no canonicos antes de cargar el libro", async () => {
  const buffer = await workbookBuffer((book) => { book.addWorksheet("Datos").addRows([["Nombre"], ["Alumno sintetico"]]); });
  const zip = await JSZip.loadAsync(buffer);
  const content = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  zip.remove("xl/worksheets/sheet1.xml");
  zip.file("xl/worksheets/sheet1.xml/extra.xml", content);
  await assert.rejects(inspectStudentWorkbook(await zip.generateAsync({ type: "nodebuffer" })), /canon|compatible|valido/i);
});

test("localiza cabecera tras titulo, reconoce alias y permite mapeo explicito desconocido", async () => {
  const sheets = await inspectStudentWorkbook(await workbookBuffer((book) => {
    const ws = book.addWorksheet("Alias");
    ws.addRow(["Listado sintetico"]);
    ws.addRow([]);
    ws.addRow(["Nombre completo", "NIE", "Correo electrónico", "Código académico", "Grupo"]);
    ws.addRow(["Ejemplo", " x 1234567 l ", "test@example.test", "0007", "A,A|B\nC"]);
    book.addWorksheet("Manual").addRows([["Participante", "Dato"], ["Ejemplo manual", "dato"]]);
  }));
  assert.deepEqual(sheets[0].mapping, { name: 0, dni: 1, email: 2, academicCode: 3, groups: 4 });
  assert.equal(sheets[0].rows[0].row, 4);
  const result = mapStudentRows(sheets, [{ sheet: "Alias", mapping: sheets[0].mapping }]);
  assert.equal(result.students[0].dni, "X1234567L");
  assert.equal(result.students[0].academicCode, "0007");
  assert.deepEqual(result.students[0].groups, ["Alias", "A", "B", "C"]);
  assert.equal(sheets[1].mapping.name, -1);
  assert.equal(mapStudentRows(sheets, [{ sheet: "Manual", mapping: { name: 0 } }]).students.length, 1);
});

test("conserva rich text, fechas de celda, cabeceras repetidas y claves especiales sin perder extras", async () => {
  const sheets = await inspectStudentWorkbook(await workbookBuffer((book) => {
    book.addWorksheet("Datos").addRows([
      ["Nombre", "Extra", "Extra", "__proto__", null],
      [{ richText: [{ text: "Alumno " }, { text: "sintetico" }] }, "uno", "dos", "tres", new Date("2026-10-01T00:00:00Z")],
    ]);
  }));
  const result = mapStudentRows(sheets, [{ sheet: "Datos", mapping: { name: 0 } }]);
  assert.equal(result.students[0].name, "Alumno sintetico");
  assert.deepEqual(Object.values(result.students[0].metadata), ["uno", "dos", "tres", "2026-10-01T00:00:00.000Z"]);
  assert.equal(Object.hasOwn(result.students[0].metadata, "__proto__"), true);
});

test("valida campos presentes, filas malformadas y conserva homonimos y duplicados sin DB", () => {
  const input = sheet([
    ["Ejemplo", "", "", "", "", ""],
    ["Ejemplo", "", "", "", "", ""],
    ["", "", "", "", "", "dato"],
    ["Ejemplo", "12345678A", "", "", "", ""],
    ["Ejemplo", "", "no-es-email", "", "", ""],
    ["Ejemplo"],
    ["", "", "", "", "", ""],
    ["Ejemplo", "12345678Z", "ok@example.test", "", "", ""],
    ["Ejemplo", "12345678Z", "ok@example.test", "", "", ""],
    ["x".repeat(161), "", "", "", "", ""],
  ]);
  const result = mapStudentRows([input], [{ sheet: input.name, mapping: input.mapping }]);
  assert.equal(result.students.length, 4);
  assert.deepEqual(result.problems.map((p) => p.row), [4, 5, 6, 7, 11]);
  assert.equal(JSON.stringify(result.problems).includes("12345678A"), false);
});

test("rechaza mappings repetidos, fraccionarios, fuera de rango y selecciones ambiguas", () => {
  const input = sheet([["Ejemplo", "", "", "", "", ""]]);
  for (const mapping of [{ name: 0, email: 0 }, { name: -1 }, { name: 0.5 }, { name: 6 }, { name: 0, dni: NaN }]) {
    const result = mapStudentRows([input], [{ sheet: input.name, mapping }]);
    assert.equal(result.students.length, 0);
    assert.equal(result.problems.length, 1);
  }
  assert.equal(mapStudentRows([input], [{ sheet: "Inexistente", mapping: { name: 0 } }]).problems.length, 1);
  assert.equal(mapStudentRows([input], [{ sheet: input.name, mapping: { name: 0 } }, { sheet: input.name, mapping: { name: 0 } }]).students.length, 0);
  assert.deepEqual(mapStudentRows([input], []), { students: [], problems: [] });
});

test("vista previa valida los mismos limites de ficha que la confirmacion", () => {
  const input = sheet([["Alumno", "", "", "", "", "a".repeat(501)]]);
  const result = mapStudentRows([input], [{ sheet: input.name, mapping: input.mapping }]);
  assert.equal(result.students.length, 0);
  assert.equal(result.problems.length, 1);
});

test("limita a 1000 filas seleccionadas entre hojas sin truncar el lote silenciosamente", () => {
  const input = sheet(Array.from({ length: 1000 }, () => ["Ejemplo", "", "", "", "", ""]));
  const other = { ...sheet([["Otro ejemplo", "", "", "", "", ""]]), name: "Otra" };
  assert.equal(mapStudentRows([input, other], [{ sheet: input.name, mapping: input.mapping }]).students.length, 1000);
  const result = mapStudentRows([input, other], [{ sheet: input.name, mapping: input.mapping }, { sheet: other.name, mapping: other.mapping }]);
  assert.equal(result.students.length, 0);
  assert.match(result.problems[0].message, /1000/);
});

test("rechaza formulas incluso ocultas o fuera de columnas mapeadas sin mostrar contenido", async () => {
  for (const value of [{ formula: "1+1", result: 2 }, { sharedFormula: "B2", result: 2 }]) {
    const buffer = await workbookBuffer((book) => {
      const ws = book.addWorksheet("Oculta", { state: "hidden" });
      ws.addRows([["Nombre", "Extra"], ["Ejemplo", { formula: "1+1", result: 2 }]]);
      ws.getCell("B3").value = value;
    });
    await assert.rejects(inspectStudentWorkbook(buffer), /f[oó]rmula/i);
  }
});

test("rechaza archivos corruptos, cifrados y mayores de 5 MiB", async () => {
  await assert.rejects(inspectStudentWorkbook(Buffer.from("no es xlsx")), /XLSX|ZIP|corrupto/i);
  await assert.rejects(inspectStudentWorkbook(Buffer.alloc(5 * 1024 * 1024 + 1)), /5 MiB/);
  const buffer = await workbookBuffer((book) => book.addWorksheet("Datos").addRow(["Nombre"]));
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  buffer.writeUInt16LE(buffer.readUInt16LE(central + 8) | 1, central + 8);
  await assert.rejects(inspectStudentWorkbook(buffer), /cifrado|ZIP/i);
});

test("limita expansion real y declarada antes de ExcelJS, incluso con longitudes ZIP manipuladas", async () => {
  const zip = new JSZip();
  zip.file("xl/worksheets/sheet1.xml", " ".repeat(20 * 1024 * 1024 + 1));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await assert.rejects(inspectStudentWorkbook(buffer), /20 MiB/);
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  buffer.writeUInt32LE(1, central + 24);
  buffer.writeUInt32LE(1, 22);
  await assert.rejects(inspectStudentWorkbook(buffer), /20 MiB|ZIP|corrupto/i);
});

test("limita hojas, filas y columnas incluyendo coordenadas dispersas antes de cargar ExcelJS", async () => {
  const tooMany = await workbookBuffer((book) => {
    for (let i = 0; i < 31; i++) book.addWorksheet(`Hoja ${i}`).addRow(["Nombre"]);
  });
  await assert.rejects(inspectStudentWorkbook(tooMany), /30/);
  const base = await workbookBuffer((book) => book.addWorksheet("Datos").addRows([["Nombre"], ["Ejemplo"]]));
  for (const [from, to, limit] of [["A2", "A10001", /10000/], ["A2", "AY2", /50/], ["A2", "A&#49;0001", /10000/]] as const) {
    const buffer = await rewriteXml(base, "xl/worksheets/sheet1.xml", (xml) => xml.replace(`r="${from}"`, `r="${to}"`));
    await assert.rejects(inspectStudentWorkbook(buffer), limit);
  }
  const allowed = await workbookBuffer((book) => {
    for (let i = 0; i < 30; i++) book.addWorksheet(`Hoja ${i}`).addRow(["Nombre"]);
    book.worksheets[0].getCell("AX10000").value = "extremo";
  });
  const sheets = await inspectStudentWorkbook(allowed);
  assert.equal(sheets.length, 30);
  assert.equal(sheets[0].headers.length, 50);
});

test("rechaza macros y XML con DTD sin ejecutar enlaces; conserva texto literal tipo formula", async () => {
  const base = await workbookBuffer((book) => book.addWorksheet("Datos").addRows([["Nombre", "Extra"], ["Ejemplo", "=1+1"]]));
  const zip = await JSZip.loadAsync(base);
  zip.file("xl/vbaProject.bin", "macro sintetica");
  await assert.rejects(inspectStudentWorkbook(await zip.generateAsync({ type: "nodebuffer" })), /macro/i);
  const dtd = await rewriteXml(base, "xl/worksheets/sheet1.xml", (xml) => xml.replace("?>", '?><!DOCTYPE worksheet [<!ENTITY x "dato">]>'));
  await assert.rejects(inspectStudentWorkbook(dtd), /DTD|XML/i);
  const sheets = await inspectStudentWorkbook(base);
  assert.equal(sheets[0].rows[0].cells[1], "=1+1");
});

test("valida rangos combinados antes de que ExcelJS pueda expandirlos", async (context) => {
  const base = await workbookBuffer((book) => book.addWorksheet("Datos").addRows([["Nombre"], ["Ejemplo"]]));
  const oversized = await rewriteXml(base, "xl/worksheets/sheet1.xml", (xml) => xml.replace("</worksheet>", '<mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells></worksheet>'));
  // A guard is necessary here: a regressed preflight must not allocate the malicious range.
  context.mock.method(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), "load", async () => { throw new Error("ExcelJS no debe cargar este rango"); });
  await assert.rejects(inspectStudentWorkbook(oversized), /50 columnas|10000 filas/);
});

test("expansion ZIP total incluye entradas no worksheet y no solo la entrada mayor", async () => {
  const zip = new JSZip();
  zip.file("uno.bin", "a".repeat(11 * 1024 * 1024));
  zip.file("dos.bin", "b".repeat(11 * 1024 * 1024));
  await assert.rejects(inspectStudentWorkbook(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })), /20 MiB/);
});

test("rechaza estructuras ZIP truncadas o con nombres y offsets incoherentes", async () => {
  const base = await workbookBuffer((book) => book.addWorksheet("Datos").addRow(["Nombre"]));
  await assert.rejects(inspectStudentWorkbook(base.subarray(0, base.length - 3)), /ZIP|corrupto/);
  const central = base.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const wrongOffset = Buffer.from(base);
  wrongOffset.writeUInt32LE(base.length + 10, central + 42);
  await assert.rejects(inspectStudentWorkbook(wrongOffset), /ZIP|corrupto/);
  const wrongName = Buffer.from(base);
  wrongName[central + 46] = 0x7a;
  await assert.rejects(inspectStudentWorkbook(wrongName), /ZIP|corrupto/);
});

test("identifica macros por estructura, no por palabras en los datos originales", async () => {
  const base = await workbookBuffer((book) => book.addWorksheet("Datos").addRows([["Nombre", "Nota"], ["Ejemplo", "vbaProject macroEnabled"]]));
  const sheets = await inspectStudentWorkbook(base);
  assert.equal(sheets[0].rows[0].cells[1], "vbaProject macroEnabled");
  const macroType = await rewriteXml(base, "[Content_Types].xml", (xml) => xml.replace("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml", "application/vnd.ms-excel.sheet.macroEnabled.main+xml"));
  await assert.rejects(inspectStudentWorkbook(macroType), /macro/i);
});
