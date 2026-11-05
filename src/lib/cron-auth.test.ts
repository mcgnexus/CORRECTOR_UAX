import assert from "node:assert/strict";
import test from "node:test";
import { isCronAuthorized } from "./cron-auth";

test("cron authorization requires an exact bearer secret and fails closed when absent", () => {
  const secret = "secure-random-cron-secret-with-at-least-32-characters";
  assert.equal(isCronAuthorized(`Bearer ${secret}`, secret), true);
  assert.equal(isCronAuthorized(`Bearer ${secret} `, secret), false);
  assert.equal(isCronAuthorized(null, secret), false);
  assert.equal(isCronAuthorized("Bearer short", "short"), false);
  assert.equal(isCronAuthorized(`Bearer ${secret}`, undefined), false);
});
