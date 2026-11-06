import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ROSTER_CSV_BYTES, normalizeStudent, normalizeStudentDocument, parseRosterCsv, validateReviewedAnswers } from "@/lib/exam-roster";

test("normaliza nombre y DNI/NIE con checksum", () => {
  assert.deepEqual(normalizeStudent({ name: "  Ana   Pérez ", dni: " x 1234567 l " }), {
    success: true,
    data: { name: "Ana Pérez", dni: "X1234567L" },
  });
});

test("importa CSV UTF-8 con nombres entrecomillados y detecta DNI repetido sin exponerlo", () => {
  const parsed = parseRosterCsv('nombre,dni\r\n"Pérez, Ana",X1234567L\r\nLuis,x1234567l\r\n');
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.deepEqual(parsed.problems, [{ row: 3, message: "El DNI está duplicado en el archivo." }]);
  assert.equal(JSON.stringify(parsed).includes("X1234567L"), false);
});

test("valida DNI/NIE, conserva ceros y rechaza letras, signos y prefijos incorrectos", () => {
  for (const dni of ["00000000T", "12345678Z", "X1234567L", "Y1234567X", "Z1234567R"]) {
    assert.deepEqual(normalizeStudentDocument(dni.toLowerCase()), { success: true, data: dni });
  }
  for (const dni of ["00000000A", "12345678A", "A1234567L", "X123456L", "12345678-Z", "12345678;Z", "legacy"]) {
    assert.equal(normalizeStudentDocument(dni).success, false);
    assert.equal(normalizeStudent({ name: "Ana", dni }).success, false);
  }
});

test("CSV con documento inválido devuelve solo problemas por fila, nunca importación parcial", () => {
  const parsed = parseRosterCsv("nombre,dni\nAna,12345678Z\nLuis,12345678A");
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.deepEqual(parsed.problems.map((problem) => problem.row), [3]);
  assert.equal("students" in parsed, false);
});

test("CSV mal formado o con columnas incorrectas no se acepta parcialmente", () => {
  assert.equal(parseRosterCsv("nombre,dni\n\"Ana,X123\n").success, false);
  assert.equal(parseRosterCsv("nombre,dni,extra\nAna,X123,x").success, false);
  assert.equal(parseRosterCsv("nombre,dni\nAna,X123\nLuis,").success, false);
});

test("aplica límite de tamaño CSV", () => {
  const parsed = parseRosterCsv("a".repeat(MAX_ROSTER_CSV_BYTES + 1));
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.match(parsed.problems[0].message, /2 MB/);
});

test("aplica límite de 1000 filas y rechaza campos personales extra", () => {
  const csv = `nombre,dni\n${Array.from({ length: 1001 }, (_, index) => `Alumno ${index},X${index + 10000}`).join("\n")}`;
  const parsed = parseRosterCsv(csv);
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.match(parsed.problems[0].message, /1000 alumnos/);
  assert.equal(normalizeStudent({ name: "Ana Pérez", dni: "X123", image: "private" }).success, false);
});

test("exige una respuesta por pregunta y permite el blanco explícito", () => {
  assert.deepEqual(validateReviewedAnswers([
    { questionNo: 2, optionIndex: null },
    { questionNo: 1, optionIndex: 3 },
  ], 2, 4), {
    success: true,
    answers: [{ questionNo: 1, optionIndex: 3 }, { questionNo: 2, optionIndex: null }],
  });
  assert.equal(validateReviewedAnswers([{ questionNo: 1, optionIndex: 0 }], 2, 4).success, false);
  assert.equal(validateReviewedAnswers([{ questionNo: 1, optionIndex: 4 }, { questionNo: 2, optionIndex: null }], 2, 4).success, false);
  assert.equal(validateReviewedAnswers([{ questionNo: 1, optionIndex: 0 }, { questionNo: 1, optionIndex: null }], 2, 4).success, false);
  assert.equal(validateReviewedAnswers([{ questionNo: 1, optionIndex: 0, confidence: 1 }, { questionNo: 2, optionIndex: null }], 2, 4).success, false);
});
