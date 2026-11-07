import { hash } from "@node-rs/argon2";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "../../src/db";
import { exams, examStudents, students, users } from "../../src/db/schema";
import { validateTestDatabaseUrl } from "../../src/lib/database-url-safety";
import type { DirectoryStudentInput } from "../../src/lib/student-data";

const password = "DirectoryIntegration!2026";
const fixtures = [
  { sheet: "LAB 1 sintetico", first: "Alba", last: "Sintetica Uno", email: "alba@example.test", group: "Turno A", notes: "Material sintetico uno", origin: "Columna original uno" },
  { sheet: "LAB 2 sintetico", first: "Berta", last: "Sintetica Dos", email: "berta@example.test", group: "Turno B", notes: "Material sintetico dos", origin: "Columna original dos" },
  { sheet: "LAB 3 sintetico", first: "Celia", last: "Sintetica Tres", email: "celia@example.test", group: "Turno C", notes: "Material sintetico tres", origin: "Columna original tres" },
];

function assertDisposableDatabase() {
  const testUrl = validateTestDatabaseUrl({
    DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
    DATABASE_URL: process.env.DATABASE_URL_NORMAL,
  });
  if (process.env.DATABASE_URL !== testUrl) {
    throw new Error("Esta integracion requiere la configuracion raiz apuntando a DATABASE_URL_TEST.");
  }
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/examenes$/, { timeout: 45_000 });
}

function studentCard(page: Page, name: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("checkbox", { name: `Seleccionar ${name}`, exact: true }) });
}

async function previewWorkbook(page: Page, buffer: Buffer) {
  await page.getByLabel("Archivo Excel", { exact: true }).setInputFiles({
    name: "directorio-sintetico.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  const pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/students/import" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Previsualizar Excel", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const preview = await response.json();
  expect(preview.problems).toEqual([]);
  expect(preview.sheets).toHaveLength(3);
  expect(preview.students).toHaveLength(3);
  for (const fixture of fixtures) {
    expect(preview.sheets).toContainEqual(expect.objectContaining({ name: fixture.sheet, hidden: false, rowCount: 1, mapping: { name: 0, lastName: 1, email: 2, groups: 3 } }));
    expect(preview.students).toContainEqual({
      name: `${fixture.first} ${fixture.last}`, dni: null, email: fixture.email, academicCode: null,
      groups: [fixture.sheet, fixture.group], metadata: { Notas: fixture.notes, Origen: fixture.origin },
      sourceSheet: fixture.sheet, sourceRow: 2,
    });
    const row = page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: `Importar fila 2 de ${fixture.sheet}`, exact: true }) });
    await expect(row).toContainText(`${fixture.first} ${fixture.last}`);
    await expect(row).toContainText(fixture.email);
    await expect(row).toContainText(fixture.group);
    await expect(row).toContainText(fixture.notes);
    await expect(row).toContainText(fixture.origin);
  }
  await expect(page.getByRole("button", { name: "Confirmar importación", exact: true })).toBeDisabled();
}

async function confirmWorkbook(page: Page, replayed: boolean) {
  await page.getByRole("checkbox", { name: /He revisado/i }).check();
  const pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/students/import" && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Confirmar importación", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ count: 3, replayed });
  await expect(page.getByRole("status")).toContainText(replayed ? "Este lote ya se había importado" : "Se han importado 3 alumnos");
}

test("@mobile directorio real: Excel multihoja, persistencia, aislamiento, instantanea e idempotencia", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  assertDisposableDatabase();
  const createdUsers: Array<{ id: string; email: string }> = [];
  let outsiderContext: BrowserContext | undefined;
  try {
    // No getDb at module scope: --list must neither connect nor create fixtures.
    const db = getDb();
    const nonce = randomUUID();
    const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    for (const role of ["owner", "outsider"]) {
      const [user] = await db.insert(users).values({ name: `Directory synthetic ${role}`, email: `directory-${role}-${nonce}@test.invalid`, passwordHash }).returning({ id: users.id, email: users.email });
      createdUsers.push(user);
    }
    const [owner, outsider] = createdUsers;
    const [ownerExam] = await db.insert(exams).values({ ownerId: owner.id, title: "Directorio sintetico integracion", numQuestions: 2, numOptions: 4, status: "key_pending" }).returning({ id: exams.id });
    const [outsiderExam] = await db.insert(exams).values({ ownerId: outsider.id, title: "Examen privado de otra cuenta", numQuestions: 2, numOptions: 4, status: "key_pending" }).returning({ id: exams.id });

    const workbook = new ExcelJS.Workbook();
    for (const fixture of fixtures) {
      const sheet = workbook.addWorksheet(fixture.sheet);
      sheet.addRow(["Nombre", "Apellidos", "Correo", "Grupos", "Notas", "Origen"]);
      sheet.addRow([fixture.first, fixture.last, fixture.email, fixture.group, fixture.notes, fixture.origin]);
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await signIn(page, owner.email);
    await page.goto("/alumnos");
    await expect(page.getByRole("heading", { name: "Alumnos", exact: true })).toBeVisible();
    await previewWorkbook(page, buffer);
    const empty = await page.request.get("/api/students");
    expect(empty.status()).toBe(200);
    expect(await empty.json()).toEqual({ students: [] });
    expect(await db.select().from(students).where(eq(students.ownerId, owner.id))).toEqual([]);
    await confirmWorkbook(page, false);

    const stored = await db.select().from(students).where(eq(students.ownerId, owner.id)).orderBy(students.name);
    expect(stored).toHaveLength(3);
    for (const fixture of fixtures) {
      expect(stored).toContainEqual(expect.objectContaining({
        ownerId: owner.id, name: `${fixture.first} ${fixture.last}`, dni: null, email: fixture.email, academicCode: null,
        groups: [fixture.sheet, fixture.group].sort(),
        metadata: { Notas: fixture.notes, Origen: fixture.origin, "Origen (2)": `${fixture.sheet}, fila 2` },
      }));
    }
    await page.reload();
    const persisted = await page.request.get("/api/students");
    expect(persisted.status()).toBe(200);
    const persistedRows = (await persisted.json()).students;
    expect(persistedRows).toHaveLength(3);
    for (const student of stored) {
      expect(persistedRows).toContainEqual(expect.objectContaining({ id: student.id, name: student.name, dni: null, email: student.email, groups: student.groups, metadata: student.metadata }));
      const card = studentCard(page, student.name);
      await expect(card).toBeVisible();
      await card.getByText("Datos adicionales", { exact: true }).click();
      await expect(card).toContainText(student.metadata.Origen);
      await expect(card).toContainText(student.metadata["Origen (2)"]);
    }

    await previewWorkbook(page, buffer);
    expect(await db.select().from(students).where(eq(students.ownerId, owner.id)).orderBy(students.name)).toEqual(stored);
    await confirmWorkbook(page, true);
    expect(await db.select().from(students).where(eq(students.ownerId, owner.id)).orderBy(students.name)).toEqual(stored);

    const student = stored[0];
    await page.getByRole("checkbox", { name: `Seleccionar ${student.name}`, exact: true }).check();
    await page.getByLabel("Examen de destino", { exact: true }).selectOption(ownerExam.id);
    const assigned = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/students/assign" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Asignar seleccionados", exact: true }).click();
    expect((await assigned).status()).toBe(200);
    await expect(page.getByRole("status")).toContainText("Se han añadido 1 inscripciones");
    const snapshot = await db.select().from(examStudents).where(eq(examStudents.examId, ownerExam.id));
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ studentId: student.id, name: student.name, dni: null });
    await studentCard(page, student.name).getByRole("button", { name: "Editar ficha", exact: true }).click();
    const changedName = "Alba Ficha Modificada Sintetica";
    await page.getByLabel("Nombre completo", { exact: true }).fill(changedName);
    const updated = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/students/${student.id}` && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Guardar alumno", exact: true }).click();
    expect((await updated).status()).toBe(200);
    await expect(studentCard(page, changedName)).toBeVisible();
    await page.reload();
    await expect(studentCard(page, changedName)).toBeVisible();
    const [changed] = await db.select().from(students).where(and(eq(students.ownerId, owner.id), eq(students.id, student.id)));
    expect(changed).toMatchObject({ name: changedName, dni: null, email: student.email, groups: student.groups, metadata: student.metadata });
    expect(await db.select().from(examStudents).where(eq(examStudents.examId, ownerExam.id))).toEqual(snapshot);

    outsiderContext = await browser.newContext({ baseURL });
    const otherPage = await outsiderContext.newPage();
    await signIn(otherPage, outsider.email);
    await otherPage.goto("/alumnos");
    const otherDirectory = await otherPage.request.get(`/api/students?ownerId=${owner.id}`);
    expect(otherDirectory.status()).toBe(200);
    expect(await otherDirectory.json()).toEqual({ students: [] });
    await expect(otherPage.getByRole("checkbox", { name: /^Seleccionar / })).toHaveCount(0);
    const intrusion: DirectoryStudentInput = { name: "Intento ajeno sintetico", dni: null, email: student.email, academicCode: null, groups: student.groups, metadata: student.metadata };
    expect((await otherPage.request.patch(`/api/students/${student.id}`, { data: { ...intrusion, expectedVersion: 1 } })).status()).toBe(404);
    for (const examId of [ownerExam.id, outsiderExam.id]) {
      expect((await otherPage.request.post("/api/students/assign", { data: { examId, studentIds: [student.id] } })).status()).toBe(404);
    }
    expect(await db.select().from(students).where(eq(students.id, student.id))).toEqual([changed]);
    expect(await db.select().from(students).where(eq(students.ownerId, outsider.id))).toEqual([]);
    expect(await db.select().from(examStudents).where(eq(examStudents.examId, outsiderExam.id))).toEqual([]);
    expect(await db.select().from(examStudents).where(eq(examStudents.examId, ownerExam.id))).toEqual(snapshot);

    // A foreign real exam and a nonexistent valid UUID would both return 404
    // after access resolution. The queue identity must instead reject with 401.
    for (const examId of [ownerExam.id, randomUUID()]) {
      const keyCheck = await otherPage.request.get(`/api/exams/${examId}`, { headers: { "X-Queue-Owner": owner.id } });
      expect(keyCheck.status()).toBe(401);
      expect(await keyCheck.json()).toMatchObject({ code: "account_changed" });
      const rejected = await otherPage.request.post(`/api/exams/${examId}/results`, {
        headers: { "X-Queue-Owner": owner.id, "Idempotency-Key": randomUUID() },
        data: { studentId: snapshot[0].id, answers: [], replace: false, expectedVersion: null },
      });
      expect(rejected.status()).toBe(401);
      expect(await rejected.json()).toMatchObject({ code: "account_changed" });
    }
  } finally {
    try {
      await outsiderContext?.close();
    } finally {
      try {
        if (createdUsers.length) {
          assertDisposableDatabase();
          // Cascade cleanup is restricted to exact IDs AND emails created above.
          for (const user of createdUsers) await getDb().delete(users).where(and(eq(users.id, user.id), eq(users.email, user.email)));
        }
      } finally {
        await closeDb();
      }
    }
  }
});
