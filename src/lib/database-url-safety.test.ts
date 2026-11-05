import assert from "node:assert/strict";
import test from "node:test";
import { validateTestDatabaseUrl } from "./database-url-safety";

test("requires a separate PostgreSQL database named with the _test suffix", () => {
  assert.throws(() => validateTestDatabaseUrl({}), /obligatorio/);
  assert.throws(() => validateTestDatabaseUrl({ DATABASE_URL_TEST: "postgres://u:p@localhost/app" }), /terminar en _test/);
  assert.throws(() => validateTestDatabaseUrl({ DATABASE_URL_TEST: "mysql://u:p@localhost/app_test" }), /PostgreSQL/);
  assert.equal(
    validateTestDatabaseUrl({ DATABASE_URL_TEST: "postgres://u:p@localhost:5432/app_test" }),
    "postgres://u:p@localhost:5432/app_test",
  );
});

test("rejects the normal database target even when URL formatting differs", () => {
  assert.throws(() => validateTestDatabaseUrl({
    DATABASE_URL_TEST: "postgresql://u:p@LOCALHOST:5432/app_test?sslmode=require",
    DATABASE_URL: "postgres://u:p@localhost/app_test?sslmode=require",
  }), /no puede apuntar/);
});
