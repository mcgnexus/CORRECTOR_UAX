import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStudent, parseRosterCsv } from "./exam-roster";

test("el DNI es opcional pero un documento presente debe ser valido", () => {
  for (const dni of [undefined, null, "", "   "]) {
    assert.deepEqual(normalizeStudent({ name: "Alumno Sin Documento", dni }), {
      success: true, data: { name: "Alumno Sin Documento", dni: null },
    });
  }
  assert.equal(normalizeStudent({ name: "Alumno", dni: "12345678A" }).success, false);
  assert.equal(normalizeStudent({ name: "Alumno", dni: 1234 }).success, false);
});

test("CSV permite homonimos sin DNI sin confundirlos con duplicados", () => {
  const parsed = parseRosterCsv("nombre,dni\nAlumno Uno,\nAlumno Uno,\nAlumno Dos,12345678Z");
  assert.equal(parsed.success, true);
  if (parsed.success) assert.deepEqual(parsed.students.map((s) => s.dni), [null, null, "12345678Z"]);
  assert.equal(parseRosterCsv("nombre,dni\nAlumno Uno,12345678Z\nAlumno Dos,12345678Z").success, false);
});
