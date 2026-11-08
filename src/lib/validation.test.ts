import assert from "node:assert/strict";
import test from "node:test";
import { examCreateSchema, examUpdateSchema, registrationSchema } from "@/lib/validation";

test("normaliza el email y acepta una contraseña robusta", () => {
  const result = registrationSchema.parse({
    name: " Ana Pérez ",
    email: " ANA@EXAMPLE.COM ",
    password: "una-frase-de-prueba-123",
  });

  assert.equal(result.name, "Ana Pérez");
  assert.equal(result.email, "ana@example.com");
});

test("rechaza contraseñas demasiado cortas y correos inválidos", () => {
  assert.equal(registrationSchema.safeParse({
    name: "Ana",
    email: "ana@example.com",
    password: "corta",
  }).success, false);
  assert.equal(registrationSchema.safeParse({
    name: "Ana",
    email: "no-es-email",
    password: "una-frase-de-prueba-123",
  }).success, false);
});

test("valida el rango de configuración de examen y aplica cuatro opciones por defecto", () => {
  assert.deepEqual(examCreateSchema.parse({ title: "Parcial", numQuestions: "100" }), {
    title: "Parcial",
    subject: null,
    numQuestions: 100,
    numOptions: 4,
    sheetFormat: "bubbles",
  });
  assert.equal(examCreateSchema.safeParse({ title: "Fuera de rango", numQuestions: 101 }).success, false);
  assert.equal(examCreateSchema.safeParse({ title: "Muy pocas", numQuestions: 10, numOptions: 1 }).success, false);
});

test("UAX exige 40 preguntas y cuatro opciones al crear", () => {
  assert.equal(examCreateSchema.safeParse({ title: "UAX", numQuestions: 40, sheetFormat: "uax-grid-40" }).success, true);
  assert.equal(examCreateSchema.safeParse({ title: "UAX", numQuestions: 39, sheetFormat: "uax-grid-40" }).success, false);
  assert.equal(examCreateSchema.safeParse({ title: "UAX", numQuestions: 40, numOptions: 5, sheetFormat: "uax-grid-40" }).success, false);
  assert.deepEqual(examUpdateSchema.parse({ sheetFormat: "uax-grid-40" }), { sheetFormat: "uax-grid-40" });
});

test("requiere campos editables para una actualización", () => {
  assert.equal(examUpdateSchema.safeParse({}).success, false);
  assert.equal(examUpdateSchema.safeParse({ title: "Nuevo título" }).success, true);
});

test("la configuracion normalizada admite subject nulo al revalidar persistencia", () => {
  const input = examCreateSchema.parse({ title: "Persistido", numQuestions: 40 });
  assert.deepEqual(examCreateSchema.parse(input), input);
});
