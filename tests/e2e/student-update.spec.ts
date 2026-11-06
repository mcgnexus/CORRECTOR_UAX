import { hash } from "@node-rs/argon2";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db";
import { examStudents, exams, users } from "../../src/db/schema";
import { validateTestDatabaseUrl } from "../../src/lib/database-url-safety";

test("PATCH autentica, valida el contrato y protege concurrencia y pertenencia", async ({ page, request }) => {
  validateTestDatabaseUrl({ DATABASE_URL_TEST: process.env.DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL_NORMAL });
  const db = getDb();
  const email = `${randomUUID()}@test.invalid`;
  const password = "StudentUpdate!2026";
  const passwordHash = await hash(password);
  const [owner, outsider, admin] = await db.insert(users).values([
    { name: "Owner", email, passwordHash },
    { name: "Outsider", email: `${randomUUID()}@test.invalid`, passwordHash },
    { name: "Admin", email: `${randomUUID()}@test.invalid`, passwordHash, role: "admin" as const },
  ]).returning();
  try {
    const [exam] = await db.insert(exams).values({ ownerId: owner.id, title: "API fixture", numQuestions: 1, numOptions: 4 }).returning();
    const [student, duplicate] = await db.insert(examStudents).values([
      { examId: exam.id, name: "Legacy", dni: "legacy" },
      { examId: exam.id, name: "Duplicate", dni: "12345678Z" },
    ]).returning();
    const [secondExam] = await db.insert(exams).values({ ownerId: owner.id, title: "Other API fixture", numQuestions: 1, numOptions: 4 }).returning();
    const url = `/api/exams/${exam.id}/students/${student.id}`;
    const data = { name: "Updated", dni: "00000000T", originalName: student.name, originalDni: student.dni };
    expect((await request.patch(url, { data })).status()).toBe(401);
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/examenes$/);
    const api = page.request;
    for (const invalid of [{ ...data, extra: true }, { name: "Updated", dni: "00000000T" }, { ...data, dni: "00000000A" }]) {
      expect((await api.patch(url, { data: invalid })).status()).toBe(400);
    }
    expect((await api.patch(url, { data: "{" , headers: { "content-type": "application/json" } })).status()).toBe(400);
    expect((await api.patch(url, { data: { ...data, name: "x".repeat(9_000) } })).status()).toBe(413);
    expect((await api.patch(url, { data: { ...data, dni: duplicate.dni } })).status()).toBe(409);
    expect((await api.patch(`/api/exams/${exam.id}/students/${randomUUID()}`, { data })).status()).toBe(404);
    expect((await api.patch(`/api/exams/${secondExam.id}/students/${student.id}`, { data })).status()).toBe(404);
    expect((await api.patch(`/api/exams/bad/students/${student.id}`, { data })).status()).toBe(404);
    const saved = await api.patch(url, { data });
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toEqual({ student: { id: student.id, name: data.name, dni: data.dni } });
    expect((await api.patch(url, { data })).status()).toBe(409);
    const roster = await api.get(`/api/exams/${exam.id}/students`);
    expect((await roster.json()).students).toEqual(expect.arrayContaining([expect.objectContaining({ id: student.id, name: data.name, dni: data.dni })]));
    const exported = await api.get(`/api/exams/${exam.id}/export?type=results&format=csv`);
    expect(exported.status()).toBe(200);
    const csv = await exported.text();
    expect(csv).toContain(data.name);
    expect(csv).toContain(data.dni);
    expect(csv).not.toContain(student.dni);
    for (const user of [outsider, admin]) {
      const context = await page.context().browser()!.newContext();
      try {
        const userPage = await context.newPage();
        await userPage.goto(new URL("/login", page.url()).href);
        await userPage.getByLabel("Correo electrónico").fill(user.email);
        await userPage.locator("#password").fill(password);
        await userPage.getByRole("button", { name: "Entrar" }).click();
        await userPage.waitForURL(/\/examenes$/);
        const response = await context.request.patch(new URL(url, page.url()).href, {
          data: { name: "Admin edited", dni: "X1234567L", originalName: data.name, originalDni: data.dni },
        });
        expect(response.status()).toBe(user.id === admin.id ? 200 : 404);
      } finally {
        await context.close();
      }
    }
  } finally {
    for (const user of [owner, outsider, admin]) await db.delete(users).where(eq(users.id, user.id));
    await closeDb();
  }
});
