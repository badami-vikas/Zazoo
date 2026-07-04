import { test } from "node:test";
import assert from "node:assert/strict";
import { corsOriginConfig } from "../src/server.js";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prior[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("CORS: explicit API_ALLOWED_ORIGINS always wins, in any NODE_ENV", () => {
  withEnv({ API_ALLOWED_ORIGINS: "https://dummy_a.example, https://dummy_b.example", NODE_ENV: "production" }, () => {
    assert.deepEqual(corsOriginConfig(), ["https://dummy_a.example", "https://dummy_b.example"]);
  });
  withEnv({ API_ALLOWED_ORIGINS: "https://dummy_a.example", NODE_ENV: undefined }, () => {
    assert.deepEqual(corsOriginConfig(), ["https://dummy_a.example"]);
  });
});

test("CORS: no allowlist + production => fail closed (no origins allowed)", () => {
  withEnv({ API_ALLOWED_ORIGINS: undefined, NODE_ENV: "production" }, () => {
    assert.deepEqual(corsOriginConfig(), []);
  });
});

test("CORS: no allowlist + non-production => permissive dev default", () => {
  withEnv({ API_ALLOWED_ORIGINS: undefined, NODE_ENV: "development" }, () => {
    assert.equal(corsOriginConfig(), true);
  });
  withEnv({ API_ALLOWED_ORIGINS: undefined, NODE_ENV: undefined }, () => {
    assert.equal(corsOriginConfig(), true);
  });
});
