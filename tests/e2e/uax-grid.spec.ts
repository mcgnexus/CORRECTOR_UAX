import { hash } from "@node-rs/argon2";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "../../src/db";
import { users } from "../../src/db/schema";

const email = `uax-grid-${randomUUID()}@example.test`;
const password = "UaxGridPassword!2026";
let ownerId: string;
test.beforeAll(async () => {
  const [owner] = await getDb().insert(users).values({ name: "Docente UAX", email, passwordHash: await hash(password) }).returning();
  ownerId = owner.id;
});
test.afterAll(async () => {
  if (ownerId) await getDb().delete(users).where(eq(users.id, ownerId));
  await closeDb();
});

test("@mobile selecciona UAX 40x4 y conserva formato al recargar", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/examenes$/);
  await page.getByLabel("Formato de hoja").selectOption("uax-grid-40");
  await expect(page.getByLabel("Número de preguntas")).toHaveValue("40");
  await expect(page.getByLabel("Opciones por pregunta")).toHaveValue("4");
  await page.getByLabel("Título", { exact: true }).fill("Prueba UAX letras");
  await page.getByRole("button", { name: "Crear examen", exact: true }).click();
  await page.getByRole("link", { name: "Prueba UAX letras", exact: true }).click();
  await expect(page.getByLabel("Formato de hoja")).toHaveValue("uax-grid-40");
  await expect(page.getByRole("heading", { name: "Calibración UAX" })).toBeVisible();
  await expect(page.locator("#calibracion").getByText(/Experimental: falta validar/i)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Formato de hoja")).toHaveValue("uax-grid-40");
  await expect(page.getByRole("heading", { name: "Calibración UAX" })).toBeVisible();
});
