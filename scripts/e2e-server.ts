import { spawn } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { validateTestDatabaseUrl } from "../src/lib/database-url-safety";

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  loadEnvConfig(process.cwd());
  const testUrl = validateTestDatabaseUrl({
    DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
    DATABASE_URL: process.env.DATABASE_URL_NORMAL ?? (process.env.DATABASE_URL !== process.env.DATABASE_URL_TEST ? process.env.DATABASE_URL : undefined),
  });

  const testResult = await run(process.execPath, ["--import", "tsx", "scripts/test-db.ts", "test"], process.env);
  if (testResult !== 0) process.exit(testResult);

  const appEnvironment: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testUrl };
  delete appEnvironment.DATABASE_URL_NORMAL;
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "localhost", "--port", "3100"], {
    stdio: "inherit",
    env: appEnvironment,
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => next.kill(signal));
  }
  next.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
  next.once("exit", (code) => process.exit(code ?? 1));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falló el arranque E2E.");
  process.exit(1);
});
