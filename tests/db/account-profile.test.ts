import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db";
import { users } from "../../src/db/schema";
import { validateTestDatabaseUrl } from "../../src/lib/database-url-safety";
import { getAccountProfile, updateAccountProfile, findSessionAccount } from "../../src/lib/users";
import { refreshAccountToken } from "../../src/lib/account-session";

after(closeDb);

test("perfil privado, correo unico, reautenticacion, CAS concurrente y revocacion real", async () => {
  validateTestDatabaseUrl({ DATABASE_URL_TEST: process.env.DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL_NORMAL });
  const db = getDb();
  const password = "current-password-123";
  const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const [owner, other] = await db.insert(users).values([
    { name: "Ana", email: `${randomUUID()}@test.invalid`, passwordHash },
    { name: "Other", email: `${randomUUID()}@test.invalid`, passwordHash },
  ]).returning();
  try {
    const profile = await getAccountProfile(owner.id, 1);
    assert.ok(profile);
    assert.equal("passwordHash" in profile, false);
    assert.equal("sessionVersion" in profile, false);
    assert.equal(await getAccountProfile(owner.id, 2), undefined);
    assert.equal((await updateAccountProfile(owner.id, 1, { name: "Ana Maria", lastName: "Garcia" }, "test")).status, "updated");
    assert.equal((await findSessionAccount(owner.id))?.sessionVersion, 1);
    assert.equal((await getAccountProfile(other.id, 1))?.name, "Other");
    assert.equal((await updateAccountProfile(owner.id, 1, { role: "admin" }, "test")).status, "invalid");
    const duplicate = await updateAccountProfile(owner.id, 1, { email: other.email.toUpperCase(), currentPassword: password }, "test");
    assert.equal(duplicate.status, "duplicate");
    assert.equal((await updateAccountProfile(owner.id, 1, { email: `${randomUUID()}@test.invalid`, currentPassword: "wrong" }, "test")).status, "forbidden");
    const first = { sub: owner.id, sessionVersion: 1 };
    const second = { ...first };
    assert.ok(await refreshAccountToken(first, findSessionAccount));
    const changes = { newPassword: "new-password-1234", confirmPassword: "new-password-1234", currentPassword: password };
    const results = await Promise.all([
      updateAccountProfile(owner.id, 1, changes, "test"),
      updateAccountProfile(owner.id, 1, changes, "test"),
    ]);
    assert.equal(results.filter((r) => r.status === "updated").length, 1);
    assert.ok(results.some((r) => r.status === "conflict" || r.status === "unauthorized"));
    assert.equal(await refreshAccountToken(first, findSessionAccount), null);
    assert.equal(await refreshAccountToken(second, findSessionAccount), null);
    assert.equal(await refreshAccountToken({ sub: owner.id }, findSessionAccount), null);
    const [stored] = await db.select().from(users).where(eq(users.id, owner.id));
    assert.equal(stored.sessionVersion, 2);
    assert.equal(stored.role, "teacher");
    assert.equal(await verify(stored.passwordHash, password), false);
    assert.equal(await verify(stored.passwordHash, changes.newPassword), true);
  } finally {
    for (const user of [owner, other]) await db.delete(users).where(eq(users.id, user.id));
  }
});
