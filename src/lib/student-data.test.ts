import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDirectoryStudent, withStudentImportSource } from "./student-data";

test("valida ficha ampliada sin documento y preserva metadatos", () => {
  const result = normalizeDirectoryStudent({ name: "  Alumna  Prueba ", groups: ["LAB1", "LAB1"], metadata: { "Mentoria": "3" }, email: "DEMO@test.invalid" });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.name, "Alumna Prueba"); assert.equal(result.data.dni, null);
    assert.equal(result.data.email, "demo@test.invalid"); assert.deepEqual(result.data.groups, ["LAB1"]);
    assert.deepEqual(result.data.metadata, { Mentoria: "3" });
  }
});

test("rechaza inyeccion de propietario y datos adicionales no acotados", () => {
  for (const extra of [{ ownerId: "otra-cuenta" }, { email: "mal" }, { metadata: { x: "a".repeat(501) } }, { groups: Array(51).fill("a") }]) {
    assert.equal(normalizeDirectoryStudent({ name: "Alumno", ...extra }).success, false);
  }
});

test("procedencia sintetica no sobrescribe una columna original Origen", () => {
  assert.deepEqual(withStudentImportSource({ Origen: "Dato original", "Origen (2)": "Otra nota" }, "LAB1", 2), {
    Origen: "Dato original", "Origen (2)": "Otra nota", "Origen (3)": "LAB1, fila 2",
  });
  assert.deepEqual(withStudentImportSource({}, "LAB1", 2), { Origen: "LAB1, fila 2" });
});

test("conserva cabeceras especiales como texto sin cambiar prototipos", () => {
  const result = normalizeDirectoryStudent({ name: "Alumno", metadata: Object.fromEntries([["__proto__", "Nota original"]]) });
  assert.equal(result.success, true);
  if (result.success) assert.deepEqual(Object.entries(result.data.metadata), [["__proto__", "Nota original"]]);
  assert.equal(normalizeDirectoryStudent({ name: "Alumno", metadata: Object.fromEntries([["__proto__", {}]]) }).success, false);
});
