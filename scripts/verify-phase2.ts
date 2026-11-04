import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { users } from "../src/db/schema";
import { createOwnedExam, deleteOwnedExam } from "../src/lib/exams";
import {
  deleteOwnedMatrixProfile,
  getOwnedMatrixProfile,
  saveOwnedMatrixProfile,
} from "../src/lib/exam-matrix";
import { calibrateMatrix, type GrayImage } from "../src/lib/matrix/detect";
import { registerUser } from "../src/lib/users";

function syntheticSheet(): GrayImage {
  const width = 900;
  const height = 1200;
  const data = new Uint8Array(width * height).fill(255);
  const square = (cx: number, cy: number, size: number) => {
    for (let y = cy - size / 2; y < cy + size / 2; y += 1) {
      for (let x = cx - size / 2; x < cx + size / 2; x += 1) {
        data[Math.round(y) * width + Math.round(x)] = 0;
      }
    }
  };
  const ring = (cx: number, cy: number, radius: number) => {
    for (let y = cy - radius - 2; y <= cy + radius + 2; y += 1) {
      for (let x = cx - radius - 2; x <= cx + radius + 2; x += 1) {
        const distance = Math.hypot(x - cx, y - cy);
        if (distance <= radius && distance >= radius - 2) data[y * width + x] = 0;
      }
    }
  };
  square(60, 60, 12);
  square(840, 60, 12);
  square(60, 1140, 12);
  square(840, 1140, 12);
  for (let row = 0; row < 5; row += 1) {
    for (let option = 0; option < 4; option += 1) {
      ring(170 + option * 34, 140 + row * 40, 7);
      ring(530 + option * 34, 140 + row * 40, 7);
    }
  }
  return { width, height, data };
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const emailA = `fase2-a-${suffix}@example.com`;
  const emailB = `fase2-b-${suffix}@example.com`;
  let examId = "";
  let ownerA = "";
  let ownerB = "";

  try {
    await registerUser({ name: "Fase 2 A", email: emailA, password: "prueba-fase-dos-1234" });
    await registerUser({ name: "Fase 2 B", email: emailB, password: "prueba-fase-dos-1234" });
    const db = getDb();
    const [userA] = await db.select({ id: users.id }).from(users).where(eq(users.email, emailA));
    const [userB] = await db.select({ id: users.id }).from(users).where(eq(users.email, emailB));
    assert.ok(userA && userB);
    ownerA = userA.id;
    ownerB = userB.id;

    const exam = await createOwnedExam(ownerA, { title: "Fase 2", subject: null, numQuestions: 10, numOptions: 4 });
    examId = exam.id;

    const detection = calibrateMatrix(syntheticSheet(), { numQuestions: 10, numOptions: 4 });
    if (!detection.success) throw new Error(detection.error);

    const saved = await saveOwnedMatrixProfile(ownerA, examId, {
      bubbles: detection.calibration.bubbles,
      bubbleRadius: detection.calibration.bubbleRadius,
      rowsPerBlock: detection.calibration.rowsPerBlock,
      blocks: detection.calibration.blocks,
      optionsPerBlock: detection.calibration.optionsPerBlock,
    });
    assert.equal(saved.status, "saved");

    const profile = await getOwnedMatrixProfile(ownerA, examId);
    assert.ok(profile);
    assert.equal(profile.bubbles.length, 40);
    assert.equal(await getOwnedMatrixProfile(ownerB, examId), null, "otro profesor ve la matriz");
    assert.equal((await saveOwnedMatrixProfile(ownerB, examId, {})).status, "invalid");
    assert.equal((await deleteOwnedMatrixProfile(ownerB, examId)).status, "not_found");

    const wrong = await saveOwnedMatrixProfile(ownerA, examId, {
      bubbles: detection.calibration.bubbles.slice(0, 20),
      bubbleRadius: detection.calibration.bubbleRadius,
      rowsPerBlock: 5,
      blocks: 2,
      optionsPerBlock: 4,
    });
    assert.equal(wrong.status, "invalid");

    assert.equal((await deleteOwnedMatrixProfile(ownerA, examId)).status, "deleted");
    assert.equal(await getOwnedMatrixProfile(ownerA, examId), null);

    console.log("OK: calibración guardada, validada y aislada por examen y profesor.");
  } finally {
    if (examId && ownerA) await deleteOwnedExam(ownerA, examId);
    const db = getDb();
    if (ownerA) await db.delete(users).where(eq(users.id, ownerA));
    if (ownerB) await db.delete(users).where(eq(users.id, ownerB));
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
