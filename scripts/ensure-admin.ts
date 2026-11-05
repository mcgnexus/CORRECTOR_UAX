import { hash } from "@node-rs/argon2";
import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "../src/db";
import { users } from "../src/db/schema";

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

async function main() {
  loadEnvConfig(process.cwd());
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("Define ADMIN_EMAIL y ADMIN_PASSWORD para crear o actualizar el administrador.");
    process.exit(2);
  }
  if (password.length < 12) {
    console.error("La contraseña del administrador debe tener al menos 12 caracteres.");
    process.exit(2);
  }

  const db = getDb();
  const passwordHash = await hash(password, ARGON2_OPTIONS);
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing) {
    await db.update(users).set({ passwordHash, role: "admin" }).where(sql`id = ${existing.id}`);
    console.log("Administrador actualizado.");
  } else {
    await db.insert(users).values({ name: "Administrador", email, passwordHash, role: "admin" });
    console.log("Administrador creado.");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "No se pudo configurar el administrador.");
    process.exitCode = 1;
  })
  .finally(async () => { await closeDb(); });
