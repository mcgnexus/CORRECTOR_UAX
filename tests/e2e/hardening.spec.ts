import AxeBuilder from "@axe-core/playwright";
import { hash } from "@node-rs/argon2";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "../../src/db";
import { answerKeyItems, examMatrixProfiles, examResultAnswers, examResults, examStudents, exams, scoringRules, users } from "../../src/db/schema";
import type { QueuedResult } from "../../src/lib/offline-queue/indexed-db";

test.describe.configure({ mode: "serial" });

const password = "UaxTestPassword!2026";
const db = getDb();
let ownerId = "";
let examId = "";
let deletedExamId = "";
let pendingStudentId = "";
let conflictStudentId = "";
let ownerEmail = "";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(ownerEmail);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/examenes$/, { timeout: 45_000 });
}

async function addQueueRecord(page: Page, entry: QueuedResult) {
  await page.evaluate(async (record) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("corrector-uax-offline", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("results")) {
          const store = database.createObjectStore("results", { keyPath: "id" });
          store.createIndex("ownerId", "ownerId");
          store.createIndex("ownerExam", ["ownerId", "examId"]);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("results", "readwrite");
      transaction.objectStore("results").put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, entry);
}

async function readQueueRows(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("corrector-uax-offline", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("results")) {
          const store = db.createObjectStore("results", { keyPath: "id" });
          store.createIndex("ownerId", "ownerId");
          store.createIndex("ownerExam", ["ownerId", "examId"]);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      if (!database.objectStoreNames.contains("results")) {
        resolve([]);
        return;
      }
      const request = database.transaction("results").objectStore("results").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return rows;
  });
}

function queueEntry(studentId: string, settings: Partial<QueuedResult> = {}): QueuedResult {
  const id = randomUUID();
  return {
    id,
    ownerId,
    examId,
    studentId,
    answers: [{ questionNo: 1, optionIndex: 1 }, { questionNo: 2, optionIndex: 0 }],
    replace: false,
    expectedVersion: null,
    idempotencyKey: id,
    createdAt: new Date().toISOString(),
    status: "pending",
    retries: 0,
    lastError: null,
    ...settings,
  };
}

async function assertNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.beforeAll(async () => {
  const nonce = randomUUID();
  ownerEmail = `hardening-${nonce}@test.invalid`;
  const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const [user] = await db.insert(users).values({ name: "Playwright Owner", email: ownerEmail, passwordHash }).returning({ id: users.id });
  ownerId = user.id;
  const [exam] = await db.insert(exams).values({ ownerId, title: "Hardening synthetic fixture", numQuestions: 2, numOptions: 4, status: "key_validated" }).returning({ id: exams.id });
  examId = exam.id;
  const [deletedExam] = await db.insert(exams).values({ ownerId, title: "Stale queue fixture", numQuestions: 2, numOptions: 4, status: "key_validated" }).returning({ id: exams.id });
  deletedExamId = deletedExam.id;
  const students = await db.insert(examStudents).values([
    { examId, name: "Pending synthetic student", dni: `${nonce.slice(0, 8)}P` },
    { examId, name: "Conflict synthetic student", dni: `${nonce.slice(0, 8)}C` },
  ]).returning({ id: examStudents.id });
  [pendingStudentId, conflictStudentId] = students.map((student) => student.id);
  await db.insert(answerKeyItems).values([
    { examId, questionNo: 1, correctOption: "A" },
    { examId, questionNo: 2, correctOption: "B" },
  ]);
  await db.insert(examMatrixProfiles).values({
    examId,
    bubbles: Array.from({ length: 8 }, (_, index) => ({
      questionNo: Math.floor(index / 4) + 1,
      optionIndex: index % 4,
      x: 0.28 + (index % 4) * 0.12,
      y: Math.floor(index / 4) === 0 ? 0.3 : 0.68,
    })),
    bubbleRadius: 0.012,
    rowsPerBlock: 1,
    blocks: 2,
    optionsPerBlock: 4,
  });
  await db.insert(scoringRules).values({ examId, pointsCorrect: "1", pointsWrong: "0", pointsBlank: "0", maxScore: "10" });
  await db.insert(examResults).values({ studentId: conflictStudentId, correct: 2, wrong: 0, blank: 0, rawScore: "2", score: "10", version: 2 });
  await db.insert(examResultAnswers).values([
    { studentId: conflictStudentId, questionNo: 1, selectedOption: 0 },
    { studentId: conflictStudentId, questionNo: 2, selectedOption: 1 },
  ]);
});

test.afterAll(async () => {
  if (ownerId) await db.delete(users).where(eq(users.id, ownerId));
  await closeDb();
});

test("login page meets automated WCAG 2.2 A/AA axe rules", async ({ page }) => {
  await page.goto("/login");
  await assertNoAxeViolations(page);
});

test("DeepSeek UI uses the loopback stub only after explicit consent", async ({ page }) => {
  await signIn(page);
  await page.goto(`/examenes/${examId}`);
  await assertNoAxeViolations(page);
  await page.locator("#exam-text").fill("Texto sintético de examen para probar el generador local de claves de respuestas.");
  await page.locator(".aviso-privacidad input").check();
  await page.getByRole("button", { name: "Generar clave con DeepSeek" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Propuesta generada" })).toBeVisible();
  expect(await page.locator("#exam-text").inputValue()).toContain("Texto sintético");
});

test("synthetic OMR image stays local and only reviewed answers enter IndexedDB after network failure", async ({ page }) => {
  await signIn(page);
  const sentBodies: string[] = [];
  await page.route(`**/api/exams/${examId}/results`, async (route) => {
    sentBodies.push(route.request().postData() ?? "");
    await route.abort("internetdisconnected");
  });
  await page.goto(`/examenes/${examId}`);
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1200;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas no disponible");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    for (const [x, y] of [[60, 60], [840, 60], [60, 1140], [840, 1140]]) context.fillRect(x - 6, y - 6, 13, 13);
    for (const [questionNo, optionIndex] of [[1, 0], [2, 1]]) {
      const x = 60 + (0.28 + (optionIndex as number) * 0.12) * 780;
      const y = 60 + ((questionNo as number) === 1 ? 0.3 : 0.68) * 1080;
      context.beginPath();
      context.arc(x, y, 7, 0, Math.PI * 2);
      context.fill();
    }
    return canvas.toDataURL("image/png");
  });
  const imageBytes = Buffer.from(dataUrl.split(",")[1], "base64");
  await page.locator("#omr-image").setInputFiles({ name: "synthetic-answer-sheet.png", mimeType: "image/png", buffer: imageBytes });
  await expect(page.getByRole("status").filter({ hasText: "Lectura provisional terminada" })).toBeVisible();
  await assertNoAxeViolations(page);
  await page.locator("#omr-student").selectOption(pendingStudentId);
  await page.getByRole("button", { name: "Confirmar todas las respuestas" }).click();
  await expect(page.getByText("Confirmada", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Confirmar entrega y nota" }).click();
  await expect(page.getByText("Entrega guardada en la cola local", { exact: false })).toBeVisible();
  await expect(page.locator("canvas.omr-preview")).toBeHidden();
  expect(sentBodies).toHaveLength(1);
  expect(sentBodies[0]).not.toMatch(/File|Blob|multipart|image|synthetic-answer-sheet/);
  expect(Object.keys(JSON.parse(sentBodies[0])).sort()).toEqual(["answers", "expectedVersion", "replace", "studentId"].sort());

  const localQueue = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("corrector-uax-offline", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<QueuedResult[]>((resolve, reject) => {
      const request = database.transaction("results").objectStore("results").getAll();
      request.onsuccess = () => resolve(request.result as QueuedResult[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return rows;
  });
  expect(localQueue).toHaveLength(1);
  expect(Object.keys(localQueue[0]).sort()).toEqual(["answers", "createdAt", "examId", "expectedVersion", "id", "idempotencyKey", "lastError", "ownerId", "replace", "retries", "status", "studentId"].sort());
  expect(localQueue[0].answers).toEqual([{ questionNo: 1, optionIndex: 0 }, { questionNo: 2, optionIndex: 1 }]);
});

test("calibra la plantilla subida y lee una hoja marcada sin recargar", async ({ page }) => {
  await signIn(page);
  await page.goto(`/examenes/${examId}`);
  const drawSheet = async (filled: Array<[number, number]>) => page.evaluate((marks) => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 800;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas no disponible");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    const rect = (x: number, y: number, w: number, h: number) => context.fillRect(x, y, w, h);
    const ring = (x: number, y: number, radius: number) => {
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.lineWidth = 2;
      context.strokeStyle = "black";
      context.stroke();
    };
    rect(40, 30, 520, 4);
    rect(70, 50, 460, 4);
    rect(140, 70, 320, 4);
    for (const [x, y] of [[15, 15], [585, 15], [15, 145], [585, 145]]) rect(x - 7, y - 7, 14, 14);
    for (const [x, y] of [[90, 160], [510, 160], [90, 600], [510, 600]]) rect(x - 7, y - 7, 14, 14);
    for (let option = 0; option < 4; option += 1) {
      rect(140 + option * 50 - 3, 340, 6, 12);
      rect(330 + option * 50 - 3, 340, 6, 12);
    }
    rect(112, 372, 6, 16);
    rect(302, 372, 6, 16);
    for (let option = 0; option < 4; option += 1) {
      ring(140 + option * 50, 380, 8);
      ring(330 + option * 50, 380, 8);
    }
    for (const [x, y] of marks) {
      context.fillStyle = "black";
      context.beginPath();
      context.arc(x, y, 9, 0, Math.PI * 2);
      context.fill();
    }
    return canvas.toDataURL("image/png");
  }, filled);

  const template = await drawSheet([]);
  await page.locator("#matrix-image").setInputFiles({ name: "template.png", mimeType: "image/png", buffer: Buffer.from(template.split(",")[1], "base64") });
  await expect(page.getByRole("status").filter({ hasText: "Rejilla detectada:" })).toBeVisible();
  await page.getByRole("button", { name: "Guardar calibración" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Calibración guardada" })).toBeVisible();

  const marked = await drawSheet([[140, 380], [430, 380]]);
  await page.locator("#omr-image").setInputFiles({ name: "marked.png", mimeType: "image/png", buffer: Buffer.from(marked.split(",")[1], "base64") });
  await expect(page.getByRole("status").filter({ hasText: "Lectura provisional terminada" })).toBeVisible();
  await expect(page.getByLabel("Respuesta final pregunta 1")).toHaveValue("0");
  await expect(page.getByLabel("Respuesta final pregunta 2")).toHaveValue("2");
});

test("offline replay survives a reload with identical body and idempotency key, then ACK purges it", async ({ page }) => {
  await signIn(page);
  const entry = queueEntry(pendingStudentId);
  await addQueueRecord(page, entry);
  const requests: Array<{ key: string | undefined; body: string; contentType: string | undefined }> = [];
  let allowAck = false;
  await page.route(`**/api/exams/${examId}/results`, async (route) => {
    const request = route.request();
    requests.push({
      key: request.headers()["idempotency-key"],
      body: request.postData() ?? "",
      contentType: request.headers()["content-type"],
    });
    if (!allowAck) await route.abort("internetdisconnected");
    else await route.continue();
  });

  await page.goto(`/examenes/${examId}`);
  await expect(page.locator("li").filter({ hasText: "Sin conexión; se reintentará" }).first()).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(1);
  const firstRequest = requests[0];
  const localRecord = await readQueueRows(page);
  expect(JSON.stringify(localRecord)).not.toMatch(/File|Blob|image|confidence|dni|score/i);

  const attemptsBeforeReconnect = requests.length;
  await page.context().setOffline(true);
  await page.goto("about:blank");
  await page.context().setOffline(false);
  allowAck = true;
  await page.goto(`/examenes/${examId}`);
  await expect(page.getByText("No hay entregas pendientes para este examen.")).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThan(attemptsBeforeReconnect);
  const replayRequest = requests[requests.length - 1];
  expect(replayRequest.key).toBe(entry.idempotencyKey);
  expect(firstRequest.key).toBe(replayRequest.key);
  expect(firstRequest.body).toBe(replayRequest.body);
  expect(firstRequest.contentType).toMatch(/^application\/json/);
  expect(firstRequest.body).not.toMatch(/File|Blob|multipart|image/i);
  const sent = JSON.parse(firstRequest.body) as Record<string, unknown>;
  expect(Object.keys(sent).sort()).toEqual(["answers", "expectedVersion", "replace", "studentId"].sort());
});

test("conflicts compare each answer and require explicit versioned replacement with a new key", async ({ page }) => {
  await signIn(page);
  const entry = queueEntry(conflictStudentId, { replace: true, expectedVersion: 1 });
  await addQueueRecord(page, entry);
  const requests: Array<{ key: string | undefined; body: string }> = [];
  await page.route(`**/api/exams/${examId}/results`, async (route) => {
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() ?? "" });
    await route.continue();
  });

  await page.goto(`/examenes/${examId}`);
  await page.getByRole("button", { name: "Comparar respuestas" }).click();
  const comparison = page.getByRole("table", { name: "Comparación pregunta a pregunta: cola local frente al servidor" });
  await expect(comparison).toBeVisible();
  await assertNoAxeViolations(page);
  await expect(comparison.getByRole("row").nth(1)).toContainText("B");
  await expect(comparison.getByRole("row").nth(1)).toContainText("A");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Revisar y reemplazar explícitamente" }).click();
  const confirmButtons = page.getByRole("button", { name: "Confirmar", exact: true });
  await confirmButtons.first().click();
  await confirmButtons.first().click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Confirmar entrega y nota" }).click();

  await expect(page.getByText("No hay entregas pendientes para este examen.")).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
  const replacement = requests[requests.length - 1];
  expect(requests[0].key).toBe(entry.idempotencyKey);
  expect(replacement.key).not.toBe(entry.idempotencyKey);
  expect(JSON.parse(replacement.body)).toMatchObject({ expectedVersion: 2, replace: true });
});

test("dashboard discards an offline queue item after its exam was deleted on another device", async ({ page }) => {
  await signIn(page);
  const deletion = await page.request.delete(`/api/exams/${deletedExamId}`);
  expect(deletion.status()).toBe(204);
  const staleEntry = queueEntry(randomUUID(), { examId: deletedExamId });
  await addQueueRecord(page, staleEntry);
  await page.goto("/examenes");
  await expect(page.getByText("Se descartó una entrega local porque el examen o alumno ya no existe.")).toBeVisible();
  const remaining = await readQueueRows(page);
  expect(remaining).toEqual([]);
});

test("exam page axe audit and account deletion purge this owner's local partition", async ({ page }) => {
  await signIn(page);
  await page.goto(`/examenes/${examId}`);
  await assertNoAxeViolations(page);

  const localEntry = queueEntry(pendingStudentId);
  const browser = page.context().browser();
  if (!browser) throw new Error("El test requiere un navegador real.");
  const remoteContext = await browser.newContext();
  try {
    await remoteContext.addCookies(await page.context().cookies());
    const remotePage = await remoteContext.newPage();
    await remotePage.goto("http://localhost:3100/login");
    await addQueueRecord(remotePage, queueEntry(pendingStudentId));

    await page.goto("/examenes");
    await assertNoAxeViolations(page);
    await addQueueRecord(page, localEntry);
    await page.getByLabel("Contraseña actual").fill("incorrect-password");
    await page.getByLabel("Escribe ELIMINAR CUENTA para confirmar").fill("ELIMINAR CUENTA");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Eliminar cuenta permanentemente" }).click();
    await expect(page.getByText("No se pudo verificar la contraseña.")).toBeVisible();
    await assertNoAxeViolations(page);
    await page.getByLabel("Contraseña actual").fill(password);
    const staleCookieHeader = (await page.context().cookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Eliminar cuenta permanentemente" }).click();
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await expect(page).toHaveURL("http://localhost:3100/login");
    const staleSessionResponse = await page.request.get(`/api/exams/${examId}`, { headers: { Cookie: staleCookieHeader } });
    expect(staleSessionResponse.status()).toBe(404);
    expect(await staleSessionResponse.json()).toMatchObject({ error: "Examen no encontrado." });
    await remotePage.goto("http://localhost:3100/examenes");
    await expect(remotePage.getByText("Se descartó una entrega local porque el examen o alumno ya no existe.")).toBeVisible();
    const remoteQueueAfterRemoval = await readQueueRows(remotePage);
    expect(remoteQueueAfterRemoval).toEqual([]);
  } finally {
    await remoteContext.close();
  }

  const queuedAfterRemoval = await readQueueRows(page);
  expect(queuedAfterRemoval).toEqual([]);
});
