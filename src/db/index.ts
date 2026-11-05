import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

let client: ReturnType<typeof postgres> | undefined;

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta configurar DATABASE_URL.");

  const sslModo = process.env.DATABASE_SSL;
  const esLocal = /^postgres(ql)?:\/\/[^/]*@(localhost|127\.0\.0\.1|::1|\[::1\])/.test(url);
  const ssl = sslModo === "require" ? "require" : sslModo === "disable" ? false : !esLocal && "require";

  client ??= postgres(url, { max: 5, prepare: false, ssl });

  return drizzle(client, { schema });
}

export async function closeDb() {
  if (!client) return;
  const current = client;
  client = undefined;
  await current.end({ timeout: 5 });
}
