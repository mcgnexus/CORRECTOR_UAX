import { createHash } from "node:crypto";
import { inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { authAttempts } from "@/db/schema";

const LIMIT = 8;
const WINDOW_MINUTES = 15;
const PURGE_PROBABILITY = 0.05;

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function requestIp(headers: Headers) {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function countAttempt(key: string) {
  const keyHash = hashKey(key);
  const resetWindow = sql`${authAttempts.windowStartedAt} < now() - interval '${sql.raw(String(WINDOW_MINUTES))} minutes'`;
  const [attempt] = await getDb()
    .insert(authAttempts)
    .values({ keyHash, attempts: 1 })
    .onConflictDoUpdate({
      target: authAttempts.keyHash,
      set: {
        attempts: sql`case when ${resetWindow} then 1 else ${authAttempts.attempts} + 1 end`,
        windowStartedAt: sql`case when ${resetWindow} then now() else ${authAttempts.windowStartedAt} end`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ attempts: authAttempts.attempts });
  return attempt.attempts <= LIMIT;
}

export async function checkAuthRateLimit(email: string, ip: string) {
  // Purga oportunista de ventanas expiradas.
  if (Math.random() < PURGE_PROBABILITY) {
    await getDb()
      .delete(authAttempts)
      .where(lt(authAttempts.windowStartedAt, sql`now() - interval '${sql.raw(String(WINDOW_MINUTES))} minutes'`));
  }

  // Dos claves: una global por email (frena fuerza bruta distribuida aunque se
  // falsifique la IP) y otra por email+IP (frena bots desde una sola máquina).
  const porEmail = await countAttempt(`email|${email.toLowerCase()}`);
  const porEmailEIp = await countAttempt(`email-ip|${email.toLowerCase()}|${ip}`);
  return porEmail && porEmailEIp;
}

export async function clearAuthRateLimit(email: string, ip: string) {
  const claves = [hashKey(`email|${email.toLowerCase()}`), hashKey(`email-ip|${email.toLowerCase()}|${ip}`)];
  await getDb().delete(authAttempts).where(inArray(authAttempts.keyHash, claves));
}
