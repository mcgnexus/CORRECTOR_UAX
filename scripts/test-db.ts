import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { validateTestDatabaseUrl } from "../src/lib/database-url-safety";

loadEnvConfig(process.cwd());

const operation = process.argv[2];
if (operation !== "migrate" && operation !== "test") {
  console.error("Uso: scripts/test-db.ts migrate|test");
  process.exit(2);
}

let testUrl: string;
try {
  testUrl = validateTestDatabaseUrl({
    DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
    DATABASE_URL: process.env.DATABASE_URL_NORMAL ?? (process.env.DATABASE_URL !== process.env.DATABASE_URL_TEST ? process.env.DATABASE_URL : undefined),
  });
}
catch (error) {
  console.error(error instanceof Error ? error.message : "Configuración DB de prueba inválida.");
  process.exit(2);
}

const environment = { ...process.env, DATABASE_URL: testUrl };
const windows = process.platform === "win32";
const npm = windows ? "npm.cmd" : "npm";

function run(command: string, args: string[], useShell = false) {
  const result = spawnSync(command, args, { stdio: "inherit", env: environment, shell: useShell });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  run(npm, ["exec", "--", "drizzle-kit", "migrate"], windows);
  if (operation === "test") {
    const testFiles = readdirSync(resolve("tests/db"))
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => resolve("tests/db", name));
    if (testFiles.length === 0) throw new Error("No se encontraron tests DB.");
    run(process.execPath, ["--conditions=react-server", "--import", "tsx", "--test", ...testFiles]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falló la operación DB de prueba.");
  process.exit(1);
}
