"use client";

export type QueuedResult = {
  id: string;
  ownerId: string;
  examId: string;
  studentId: string;
  answers: Array<{ questionNo: number; optionIndex: number | null }>;
  replace: boolean;
  expectedVersion: number | null;
  expectedStructureVersion?: number;
  idempotencyKey: string;
  createdAt: string;
  status: "pending" | "blocked";
  retries: number;
  lastError: string | null;
};

const DB_NAME = "corrector-uax-offline";
const DB_VERSION = 1;
const STORE = "results";
const ERROR_CODES = new Set(["network", "server", "unauthorized", "key_pending", "exists", "version_conflict", "structure_conflict", "idempotency_conflict", "rejected"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let wasBlocked = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: "id" });
      if (!store.indexNames.contains("ownerId")) store.createIndex("ownerId", "ownerId");
      if (!store.indexNames.contains("ownerExam")) store.createIndex("ownerExam", ["ownerId", "examId"]);
    };
    request.onsuccess = () => {
      if (wasBlocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir la cola local."));
    request.onblocked = () => {
      wasBlocked = true;
      reject(new Error("Cierra otras pestañas de Correctora para actualizar la cola local."));
    };
  });
}

function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openQueue().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    let result: T;
    let settled = false;
    const fail = (error: DOMException | null, fallback: string) => {
      if (settled) return;
      settled = true;
      db.close();
      reject(error ?? new Error(fallback));
    };
    try {
      const request = action(transaction.objectStore(STORE));
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => fail(request.error, "No se pudo acceder a la cola local.");
    } catch (error) {
      transaction.abort();
      fail(error instanceof DOMException ? error : null, "No se pudo iniciar la operación local.");
    }
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      db.close();
      resolve(result);
    };
    transaction.onerror = () => fail(transaction.error, "Falló la cola local.");
    transaction.onabort = () => fail(transaction.error, "Se canceló la cola local.");
  }));
}

function validateEntry(entry: QueuedResult) {
  const expectedKeys = ["id", "ownerId", "examId", "studentId", "answers", "replace", "expectedVersion", "idempotencyKey", "createdAt", "status", "retries", "lastError"];
  if (!entry || typeof entry !== "object" || expectedKeys.some((key) => !(key in entry)) || Object.keys(entry).some((key) => !expectedKeys.includes(key) && key !== "expectedStructureVersion")) {
    throw new Error("La entrega local contiene campos no permitidos.");
  }
  if (entry.expectedStructureVersion !== undefined && (!Number.isSafeInteger(entry.expectedStructureVersion) || entry.expectedStructureVersion < 1)) throw new Error("Versión estructural inválida.");
  if (![entry.id, entry.ownerId, entry.examId, entry.studentId, entry.idempotencyKey].every((value) => typeof value === "string" && UUID_PATTERN.test(value)) || entry.id !== entry.idempotencyKey) {
    throw new Error("Identificadores de entrega local inválidos.");
  }
  if (!Array.isArray(entry.answers) || entry.answers.length < 1 || entry.answers.length > 100 || entry.answers.some((answer, index) =>
    !answer || typeof answer !== "object" || Object.keys(answer).length !== 2 ||
    !Number.isInteger(answer.questionNo) || answer.questionNo !== index + 1 || answer.questionNo > 100 ||
    (answer.optionIndex !== null && (!Number.isInteger(answer.optionIndex) || answer.optionIndex < 0 || answer.optionIndex > 25)),
  ) || new Set(entry.answers.map((answer) => answer.questionNo)).size !== entry.answers.length) {
    throw new Error("Respuestas offline inválidas.");
  }
  if (typeof entry.replace !== "boolean" || (entry.expectedVersion !== null && (!Number.isInteger(entry.expectedVersion) || entry.expectedVersion < 1)) || (entry.replace && entry.expectedVersion === null)) {
    throw new Error("Versión o tipo de reemplazo inválidos.");
  }
  if (!Number.isFinite(Date.parse(entry.createdAt)) || !Number.isInteger(entry.retries) || entry.retries < 0 || !["pending", "blocked"].includes(entry.status)) {
    throw new Error("Metadatos de cola inválidos.");
  }
  if (entry.lastError !== null && (typeof entry.lastError !== "string" || !ERROR_CODES.has(entry.lastError))) {
    throw new Error("Estado de reintento inválido.");
  }
}

export function saveQueuedResult(entry: QueuedResult): Promise<IDBValidKey> {
  try { validateEntry(entry); }
  catch (error) { return Promise.reject(error); }
  return transact("readwrite", (store) => store.put(entry));
}

export function listQueuedResults(ownerId: string): Promise<QueuedResult[]> {
  if (!ownerId) return Promise.resolve([]);
  return transact<QueuedResult[]>("readonly", (store) => store.index("ownerId").getAll(IDBKeyRange.only(ownerId))).then((entries) => entries.map((entry) =>
    Number.isSafeInteger(entry.expectedStructureVersion) && entry.expectedStructureVersion! > 0 ? entry : { ...entry, status: "blocked", lastError: "structure_conflict" },
  ));
}

export function deleteQueuedResult(ownerId: string, id: string): Promise<void> {
  return transact("readwrite", (store) => {
    const request = store.get(id);
    request.addEventListener("success", () => {
      if ((request.result as QueuedResult | undefined)?.ownerId === ownerId) store.delete(id);
    });
    return request;
  }).then(() => undefined);
}

export async function purgeQueuedResults(ownerId: string, filter?: { examId?: string; studentId?: string }) {
  const entries = await listQueuedResults(ownerId);
  await Promise.all(entries.filter((entry) =>
    (!filter?.examId || entry.examId === filter.examId) &&
    (!filter?.studentId || entry.studentId === filter.studentId),
  ).map((entry) => deleteQueuedResult(ownerId, entry.id)));
}

export async function purgeOwnerQueue(ownerId: string) {
  await purgeQueuedResults(ownerId);
}
