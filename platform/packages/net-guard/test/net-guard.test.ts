/**
 * guardedFetch (TASK-011 remediation, 2026-07-17 security review) — proves
 * the TOCTOU/rebinding fix, manual redirect validation (including a redirect
 * to a private target and cycle detection), max-hop bound, byte-cap
 * streaming, credentialed-URL rejection, metadata/IPv4/IPv6 blocking, and
 * real cancellation via AbortSignal.
 *
 * Redirect/byte-cap/abort tests run against a REAL local HTTP server (not a
 * mock of `guardedFetch` itself) so the actual redirect-following, streaming,
 * and socket-abort code paths are exercised — not merely asserted. Since
 * loopback is (correctly) blocked by default, these tests use the
 * `unsafeTestOverrides` seam to allow ONLY the specific test server's
 * loopback address through, while leaving every OTHER private range blocked
 * — so the "redirect to a private target" test still proves a real rejection
 * against a genuinely different (non-allowlisted) private IP.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import {
  guardedFetch,
  isBlockedHostname,
  isBlockedIp,
  SsrfBlockedError,
  RedirectCycleError,
  RedirectLimitExceededError,
  ResponseTooLargeError,
  type UnsafeTestOverrides,
} from "../src/index.js";

test("blocks metadata IPv4 literal end-to-end (no network attempted)", async () => {
  await assert.rejects(() => guardedFetch("http://169.254.169.254/latest/meta-data/"), SsrfBlockedError);
  await assert.rejects(() => guardedFetch("http://[::ffff:169.254.169.254]/latest/meta-data/"), SsrfBlockedError);
});

test("blocks private, loopback, and link-local IPv4 ranges", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "169.254.169.254"]) {
    assert.equal(isBlockedIp(ip), true, `${ip} should be blocked`);
  }
});

test("blocks loopback, local, and IPv4-mapped IPv6 addresses", () => {
  for (const ip of ["::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254"]) {
    assert.equal(isBlockedIp(ip), true, `${ip} should be blocked`);
  }
});

test("blocks local and cloud metadata hostnames", () => {
  for (const hostname of ["localhost", "service.local", "app.internal", "metadata.google.internal"]) {
    assert.equal(isBlockedHostname(hostname), true, `${hostname} should be blocked`);
  }
});

test("allows public IPs and hostnames", () => {
  assert.equal(isBlockedIp("8.8.8.8"), false);
  assert.equal(isBlockedIp("2001:4860:4860::8888"), false);
  assert.equal(isBlockedIp("::ffff:8.8.8.8"), false);
  assert.equal(isBlockedHostname("careers.bcg.com"), false);
});

test("rejects non-http(s) schemes before any network attempt", async () => {
  await assert.rejects(() => guardedFetch("file:///etc/passwd"), SsrfBlockedError);
  await assert.rejects(() => guardedFetch("ftp://example.com/x"), SsrfBlockedError);
});

test("rejects an invalid URL string", async () => {
  await assert.rejects(() => guardedFetch("not a url"), SsrfBlockedError);
});

test("rejects URLs carrying embedded credentials (userinfo) before any network attempt", async () => {
  await assert.rejects(() => guardedFetch("http://attacker:pw@8.8.8.8/"), SsrfBlockedError);
  await assert.rejects(() => guardedFetch("http://user@8.8.8.8/"), SsrfBlockedError);
});

test("real DNS resolution is validated exactly once and pinned — a hostname unresolvable by real DNS still connects using the ONE vetted lookup result (proves no unguarded re-resolution)", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("pinned-ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    let lookupCalls = 0;
    const overrides: UnsafeTestOverrides = {
      isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip),
      dnsLookup: async () => {
        lookupCalls += 1;
        return [{ address: "127.0.0.1", family: 4 }];
      },
    };
    // "rebinding-test.invalid" is not a real, independently resolvable hostname —
    // the ONLY way this request can possibly succeed is if guardedFetch used the
    // single pinned address our dnsLookup override returned, proving there is no
    // second, unguarded resolution anywhere in the request path.
    const result = await guardedFetch(`http://rebinding-test.invalid:${port}/`, { unsafeTestOverrides: overrides });
    assert.equal(result.status, 200);
    assert.equal(result.body.toString(), "pinned-ok");
    assert.equal(lookupCalls, 1, "DNS should be resolved exactly once per hop — no re-resolution window");
  } finally {
    server.close();
  }
});

test("follows a same-host redirect and returns the final body", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/start") {
      res.writeHead(302, { location: "/final" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("final-content");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const overrides: UnsafeTestOverrides = { isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) };
    const result = await guardedFetch(`http://127.0.0.1:${port}/start`, { unsafeTestOverrides: overrides });
    assert.equal(result.status, 200);
    assert.equal(result.body.toString(), "final-content");
    assert.equal(result.redirectCount, 1);
  } finally {
    server.close();
  }
});

test("rejects a redirect to a private target that is NOT the allowlisted test address", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(302, { location: "http://10.1.2.3/secret" });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const overrides: UnsafeTestOverrides = { isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) };
    await assert.rejects(
      () => guardedFetch(`http://127.0.0.1:${port}/start`, { unsafeTestOverrides: overrides }),
      SsrfBlockedError,
    );
  } finally {
    server.close();
  }
});

test("rejects a redirect cycle", async () => {
  const server = http.createServer((req, res) => {
    const next = req.url === "/a" ? "/b" : "/a";
    res.writeHead(302, { location: next });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const overrides: UnsafeTestOverrides = { isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) };
    await assert.rejects(
      () => guardedFetch(`http://127.0.0.1:${port}/a`, { unsafeTestOverrides: overrides, maxRedirects: 5 }),
      RedirectCycleError,
    );
  } finally {
    server.close();
  }
});

test("rejects after exceeding the max redirect hop count", async () => {
  const server = http.createServer((req, res) => {
    const n = Number(req.url?.replace("/r", "") ?? 0);
    res.writeHead(302, { location: `/r${n + 1}` });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const overrides: UnsafeTestOverrides = { isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) };
    await assert.rejects(
      () => guardedFetch(`http://127.0.0.1:${port}/r0`, { unsafeTestOverrides: overrides, maxRedirects: 3 }),
      RedirectLimitExceededError,
    );
  } finally {
    server.close();
  }
});

test("enforces the byte cap while streaming a chunked (no Content-Length) response, before full buffering", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain", "transfer-encoding": "chunked" });
    // Write well past the cap in multiple chunks so this exercises the
    // streaming accumulate-and-abort path, not a pre-check against a
    // declared Content-Length (there is none here).
    const chunk = "x".repeat(1024);
    let sent = 0;
    const interval = setInterval(() => {
      if (sent >= 20_000 || res.destroyed) {
        clearInterval(interval);
        if (!res.destroyed) res.end();
        return;
      }
      res.write(chunk);
      sent += chunk.length;
    }, 1);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const overrides: UnsafeTestOverrides = { isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) };
    await assert.rejects(
      () => guardedFetch(`http://127.0.0.1:${port}/`, { unsafeTestOverrides: overrides, maxBytes: 4_000 }),
      ResponseTooLargeError,
    );
  } finally {
    server.close();
  }
});

test("rejects immediately on a declared Content-Length exceeding the cap, without reading the body", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain", "content-length": "1000000" });
    res.flushHeaders();
    // Never actually sends the body — proves the cap is enforced against the
    // HEADER before any body bytes are streamed.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const overrides: UnsafeTestOverrides = { isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) };
    await assert.rejects(
      () => guardedFetch(`http://127.0.0.1:${port}/`, { unsafeTestOverrides: overrides, maxBytes: 4_000 }),
      ResponseTooLargeError,
    );
  } finally {
    server.close();
  }
});

test("an external AbortSignal aborts an in-flight fetch (real cancellation, not just a rejected promise)", async () => {
  let serverSawClose = false;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("start");
    _req.on("close", () => {
      serverSawClose = true;
    });
    // Never ends the response — simulates a long-running fetch to abort mid-stream.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const overrides: UnsafeTestOverrides = { isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) };
    const controller = new AbortController();
    const fetchPromise = guardedFetch(`http://127.0.0.1:${port}/`, {
      unsafeTestOverrides: overrides,
      signal: controller.signal,
      timeoutMs: 30_000,
    });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(() => fetchPromise);
    // Give the server a moment to observe the aborted connection close.
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(serverSawClose, true, "the server should observe the connection actually close on abort");
  } finally {
    server.close();
  }
});

test("cancel-before-fetch: an already-aborted signal rejects without ever connecting", async () => {
  const controller = new AbortController();
  controller.abort();
  let connected = false;
  const server = http.createServer((_req, res) => {
    connected = true;
    res.end("should never be reached");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const overrides: UnsafeTestOverrides = { isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) };
    await assert.rejects(() =>
      guardedFetch(`http://127.0.0.1:${port}/`, { unsafeTestOverrides: overrides, signal: controller.signal }),
    );
    assert.equal(connected, false);
  } finally {
    server.close();
  }
});
