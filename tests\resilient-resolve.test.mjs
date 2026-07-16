import test from "node:test";
import assert from "node:assert/strict";
import { resolveWithValidation } from "../lab/resilient-resolve.mjs";

test("resolveWithValidation refreshes once after a rejected URL", async () => {
  let calls = 0;
  const result = await resolveWithValidation({
    resolve: async () => ({ generation: ++calls }),
    validate: async value => ({ ok: value.generation === 2 }),
    summarize: value => ({ generation: value.generation }),
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(result.attempts.map(item => item.validation.ok), [false, true]);
});

test("resolveWithValidation stops at the configured attempt limit", async () => {
  const result = await resolveWithValidation({
    resolve: async ({ attempt }) => ({ attempt }),
    validate: async () => ({ ok: false, reason: "rejected" }),
    maxAttempts: 3,
  });

  assert.equal(result.ok, false);
  assert.equal(result.attempts.length, 3);
});
