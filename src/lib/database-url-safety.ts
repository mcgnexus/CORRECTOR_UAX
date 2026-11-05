export type DatabaseEnvironment = {
  DATABASE_URL_TEST?: string;
  DATABASE_URL?: string;
};

function normalizedTarget(value: string) {
  const url = new URL(value);
  const params = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) =>
    aKey.localeCompare(bKey) || aValue.localeCompare(bValue),
  );
  return JSON.stringify({
    protocol: "postgresql:",
    hostname: url.hostname.toLowerCase(),
    port: url.port || "5432",
    username: url.username,
    password: url.password,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    params,
  });
}

export function validateTestDatabaseUrl(environment: DatabaseEnvironment) {
  const testUrl = environment.DATABASE_URL_TEST?.trim();
  if (!testUrl) throw new Error("DATABASE_URL_TEST es obligatorio para operaciones DB de prueba.");

  let parsed: URL;
  try { parsed = new URL(testUrl); }
  catch { throw new Error("DATABASE_URL_TEST debe ser una URL PostgreSQL válida."); }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL_TEST debe usar PostgreSQL.");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName.endsWith("_test")) throw new Error("El nombre de la base DATABASE_URL_TEST debe terminar en _test.");

  const normalUrl = environment.DATABASE_URL?.trim();
  if (normalUrl) {
    try {
      if (normalizedTarget(testUrl) === normalizedTarget(normalUrl)) {
        throw new Error("DATABASE_URL_TEST no puede apuntar a DATABASE_URL.");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "DATABASE_URL_TEST no puede apuntar a DATABASE_URL.") throw error;
      throw new Error("DATABASE_URL_TEST y DATABASE_URL deben ser URLs PostgreSQL válidas.");
    }
  }
  return testUrl;
}
