import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiUnavailableError,
  createApiTransport,
} from "../src/app/lib/api-transport.ts";

const API_URL = "https://api.example.test";

function pathOf(input) {
  const value =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
  return new URL(value).pathname;
}

test("hosted requests share one wake probe and cache recent liveness", async () => {
  let releaseHealth;
  let healthCalls = 0;
  let requestCalls = 0;
  const healthResponse = new Promise((resolve) => {
    releaseHealth = () => resolve(new Response("ok"));
  });
  const transport = createApiTransport({
    apiUrl: API_URL,
    fetchImpl: async (input) => {
      if (pathOf(input) === "/health") {
        healthCalls += 1;
        return healthResponse;
      }
      requestCalls += 1;
      return new Response("ok");
    },
  });

  const first = transport.fetch(`${API_URL}/trpc/one`);
  const second = transport.fetch(`${API_URL}/trpc/two`);
  await Promise.resolve();
  assert.equal(healthCalls, 1);
  releaseHealth();
  await Promise.all([first, second]);
  await transport.fetch(`${API_URL}/trpc/three`);

  assert.equal(healthCalls, 1);
  assert.equal(requestCalls, 3);
  assert.equal(transport.getState(), "ready");
});

test("loopback desktop requests bypass hosted wake recovery", async () => {
  const calls = [];
  const transport = createApiTransport({
    apiUrl: "http://127.0.0.1:4123",
    fetchImpl: async (input) => {
      calls.push(pathOf(input));
      return new Response("ok");
    },
  });

  await transport.fetch("http://127.0.0.1:4123/trpc/modules.list");
  assert.deepEqual(calls, ["/trpc/modules.list"]);
  assert.equal(transport.getState(), "idle");
});

test("wake recovery stops after its bounded attempts", async () => {
  let healthCalls = 0;
  let requestCalls = 0;
  const transport = createApiTransport({
    apiUrl: API_URL,
    wakeDelaysMs: [0, 0, 0],
    sleep: async () => undefined,
    fetchImpl: async (input) => {
      if (pathOf(input) === "/health") {
        healthCalls += 1;
        return new Response("sleeping", { status: 503 });
      }
      requestCalls += 1;
      return new Response("unexpected");
    },
  });

  await assert.rejects(
    transport.fetch(`${API_URL}/trpc/modules.list`),
    ApiUnavailableError,
  );
  assert.equal(healthCalls, 3);
  assert.equal(requestCalls, 0);
  assert.equal(transport.getState(), "unavailable");
});

test("wake recovery also stops at its total time budget", async () => {
  let clock = 0;
  let healthCalls = 0;
  const transport = createApiTransport({
    apiUrl: API_URL,
    now: () => clock,
    wakeDelaysMs: [0, 40, 40, 40],
    wakeBudgetMs: 70,
    sleep: async (delayMs) => {
      clock += delayMs;
    },
    fetchImpl: async () => {
      healthCalls += 1;
      return new Response("sleeping", { status: 503 });
    },
  });

  await assert.rejects(
    transport.fetch(`${API_URL}/trpc/modules.list`),
    ApiUnavailableError,
  );
  assert.equal(healthCalls, 2);
});

test("a sent mutation is never replayed after a retryable response", async () => {
  let mutationCalls = 0;
  const transport = createApiTransport({
    apiUrl: API_URL,
    fetchImpl: async (input, init) => {
      if (pathOf(input) === "/health") return new Response("ok");
      assert.equal(init?.method, "POST");
      mutationCalls += 1;
      return new Response("unavailable", { status: 503 });
    },
  });

  const response = await transport.fetch(`${API_URL}/trpc/mutate`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(response.status, 503);
  assert.equal(mutationCalls, 1);
});

test("an explicitly replay-safe tRPC POST query gets one fresh wake check before retry", async () => {
  let healthCalls = 0;
  let queryCalls = 0;
  const transport = createApiTransport({
    apiUrl: API_URL,
    fetchImpl: async (input, init) => {
      if (pathOf(input) === "/health") {
        healthCalls += 1;
        return new Response("ok");
      }
      assert.equal(init?.method, "POST");
      queryCalls += 1;
      return queryCalls === 1
        ? new Response("unavailable", { status: 503 })
        : new Response("ok");
    },
  });

  const response = await transport.fetchReplaySafe(`${API_URL}/trpc/modules.list`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.equal(healthCalls, 2);
  assert.equal(queryCalls, 2);
});

test("a replay-safe read gets one fresh wake check before retry", async () => {
  let healthCalls = 0;
  let queryCalls = 0;
  const transport = createApiTransport({
    apiUrl: API_URL,
    fetchImpl: async (input) => {
      if (pathOf(input) === "/health") {
        healthCalls += 1;
        return new Response("ok");
      }
      queryCalls += 1;
      return queryCalls === 1
        ? new Response("unavailable", { status: 503 })
        : new Response("ok");
    },
  });

  const response = await transport.fetch(`${API_URL}/records`);
  assert.equal(response.status, 200);
  assert.equal(healthCalls, 2);
  assert.equal(queryCalls, 2);
});
