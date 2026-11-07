import assert from "node:assert/strict";
import test from "node:test";
import { activeQueueAccount, matchesQueueAccount } from "./account";

test("cola no envia datos de una pestaña anterior con cookie de otra cuenta", async () => {
  assert.equal(matchesQueueAccount(new Headers({ "X-Queue-Owner": "A" }), "B"), false);
  assert.equal(matchesQueueAccount(new Headers({ "X-Queue-Owner": "A" }), "A"), true);
  assert.equal(matchesQueueAccount(new Headers(), "A"), true);
  assert.equal(await activeQueueAccount("A", async () => Response.json({ id: "B" })), false);
  assert.equal(await activeQueueAccount("A", async () => Response.json({ id: "A" })), true);
  assert.equal(await activeQueueAccount("A", async () => new Response(null, { status: 401 })), false);
  assert.equal(await activeQueueAccount("A", async () => { throw new Error("offline"); }), false);
});
