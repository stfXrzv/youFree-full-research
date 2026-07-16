export async function resolveWithValidation({
  resolve,
  validate,
  summarize = () => ({}),
  maxAttempts = 2,
}) {
  if (typeof resolve !== "function" || typeof validate !== "function") {
    throw new TypeError("resolve and validate must be functions");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }

  const attempts = [];
  let lastValue = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const value = await resolve({ attempt });
    lastValue = value;
    const validation = await validate(value, { attempt });
    attempts.push({ attempt, summary: summarize(value), validation });
    if (validation?.ok) {
      return { ok: true, value, attempts };
    }
  }

  return { ok: false, value: lastValue, attempts };
}
