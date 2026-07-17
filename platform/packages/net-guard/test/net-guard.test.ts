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
import * as https from "node:https";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import {
  guardedFetch,
  isBlockedHostname,
  isBlockedIp,
  SsrfBlockedError,
  RedirectCycleError,
  RedirectLimitExceededError,
  RedirectOriginNotAllowedError,
  RedirectDowngradeError,
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

test("blocks loopback, local, and special-purpose IPv6 ranges", () => {
  for (const ip of ["::1", "fc00::1", "fe80::1", "fec0::1", "2001:db8::1", "64:ff9b:1::1"]) {
    assert.equal(isBlockedIp(ip), true, `${ip} should be blocked`);
  }
});

test("blocks IPv4-embedded IPv6 addresses when the embedded IPv4 is private/reserved", () => {
  for (const ip of [
    "::127.0.0.1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:172.16.0.1",
    "::ffff:192.168.1.1",
    "::ffff:169.254.169.254",
  ]) {
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
  assert.equal(isBlockedIp("2606:4700:4700::1111"), false);
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

// ---------------------------------------------------------------------------
// TASK-011 remediation (2026-07-18 coordinator final review, issue 3) —
// redirect-origin allowlist, cross-origin credential-header stripping, and
// https->http downgrade rejection. Two servers on different ports are
// genuinely different origins (same host, different port = different
// origin per the URL spec), so these prove real cross-origin behavior over
// actual sockets, not a mocked notion of "origin".
// ---------------------------------------------------------------------------

test("hopOrigins reports the full in-order origin chain, including the first hop, on a same-origin redirect", async () => {
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
    assert.deepEqual(result.hopOrigins, [`http://127.0.0.1:${port}`, `http://127.0.0.1:${port}`]);
  } finally {
    server.close();
  }
});

test("allowedRedirectOrigins: a redirect to an origin OUTSIDE the allowlist is rejected, even though the target is a lawful public-looking address", async () => {
  const serverA = http.createServer((_req, res) => {
    res.writeHead(302, { location: "" }); // filled in below once serverB's port is known
    res.end();
  });
  const serverB = http.createServer((_req, res) => {
    res.end("should never be reached");
  });
  await new Promise<void>((resolve) => serverA.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => serverB.listen(0, "127.0.0.1", resolve));
  const portA = (serverA.address() as AddressInfo).port;
  const portB = (serverB.address() as AddressInfo).port;
  serverA.removeAllListeners("request");
  serverA.on("request", (_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${portB}/elsewhere` });
    res.end();
  });
  try {
    const overrides: UnsafeTestOverrides = { isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) };
    await assert.rejects(
      () =>
        guardedFetch(`http://127.0.0.1:${portA}/start`, {
          unsafeTestOverrides: overrides,
          allowedRedirectOrigins: [`http://127.0.0.1:${portA}`], // deliberately excludes portB's origin
        }),
      RedirectOriginNotAllowedError,
    );
  } finally {
    serverA.close();
    serverB.close();
  }
});

test("allowedRedirectOrigins: a redirect to an origin INSIDE the allowlist (a second, explicitly permitted origin) succeeds", async () => {
  const serverB = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("from-b");
  });
  await new Promise<void>((resolve) => serverB.listen(0, "127.0.0.1", resolve));
  const portB = (serverB.address() as AddressInfo).port;
  const serverA = http.createServer((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${portB}/final` });
    res.end();
  });
  await new Promise<void>((resolve) => serverA.listen(0, "127.0.0.1", resolve));
  const portA = (serverA.address() as AddressInfo).port;
  try {
    const overrides: UnsafeTestOverrides = { isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) };
    const result = await guardedFetch(`http://127.0.0.1:${portA}/start`, {
      unsafeTestOverrides: overrides,
      allowedRedirectOrigins: [`http://127.0.0.1:${portA}`, `http://127.0.0.1:${portB}`],
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.toString(), "from-b");
  } finally {
    serverA.close();
    serverB.close();
  }
});

test("a cross-origin redirect strips Authorization/Cookie/Proxy-Authorization headers before the next hop, but a same-origin redirect keeps them", async () => {
  let bReceivedHeaders: http.IncomingHttpHeaders = {};
  const serverB = http.createServer((req, res) => {
    bReceivedHeaders = req.headers;
    res.end("from-b");
  });
  await new Promise<void>((resolve) => serverB.listen(0, "127.0.0.1", resolve));
  const portB = (serverB.address() as AddressInfo).port;

  let aFinalReceivedHeaders: http.IncomingHttpHeaders = {};
  const serverA = http.createServer((req, res) => {
    if (req.url === "/cross-origin") {
      res.writeHead(302, { location: `http://127.0.0.1:${portB}/elsewhere` });
      res.end();
      return;
    }
    if (req.url === "/same-origin-start") {
      res.writeHead(302, { location: "/same-origin-final" });
      res.end();
      return;
    }
    aFinalReceivedHeaders = req.headers;
    res.end("same-origin-final");
  });
  await new Promise<void>((resolve) => serverA.listen(0, "127.0.0.1", resolve));
  const portA = (serverA.address() as AddressInfo).port;

  try {
    const overrides: UnsafeTestOverrides = { isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) };
    const sensitiveHeaders = { authorization: "Bearer secret-token", cookie: "session=abc123", "x-api-key": "topsecret" };

    await guardedFetch(`http://127.0.0.1:${portA}/cross-origin`, {
      unsafeTestOverrides: overrides,
      headers: sensitiveHeaders,
      allowedRedirectOrigins: [`http://127.0.0.1:${portA}`, `http://127.0.0.1:${portB}`],
    });
    assert.equal(bReceivedHeaders.authorization, undefined, "Authorization must be stripped on a cross-origin hop");
    assert.equal(bReceivedHeaders.cookie, undefined, "Cookie must be stripped on a cross-origin hop");
    assert.equal(bReceivedHeaders["x-api-key"], undefined, "API-key-shaped headers must be stripped on a cross-origin hop");

    await guardedFetch(`http://127.0.0.1:${portA}/same-origin-start`, {
      unsafeTestOverrides: overrides,
      headers: sensitiveHeaders,
    });
    assert.equal(aFinalReceivedHeaders.authorization, "Bearer secret-token", "Authorization must be PRESERVED on a same-origin hop");
    assert.equal(aFinalReceivedHeaders.cookie, "session=abc123", "Cookie must be PRESERVED on a same-origin hop");
  } finally {
    serverA.close();
    serverB.close();
  }
});

test("cross-origin header forwarding is an EXPLICIT ALLOWLIST (TASK-011 remediation, 2026-07-19 distributed-defects review, issue 12) — an unrecognized custom header (e.g. vendor-specific API-key-shaped headers a denylist could never enumerate in advance) is stripped, while Accept/User-Agent are correctly forwarded", async () => {
  let bReceivedHeaders: http.IncomingHttpHeaders = {};
  const serverB = http.createServer((req, res) => {
    bReceivedHeaders = req.headers;
    res.end("from-b");
  });
  await new Promise<void>((resolve) => serverB.listen(0, "127.0.0.1", resolve));
  const portB = (serverB.address() as AddressInfo).port;

  const serverA = http.createServer((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${portB}/elsewhere` });
    res.end();
  });
  await new Promise<void>((resolve) => serverA.listen(0, "127.0.0.1", resolve));
  const portA = (serverA.address() as AddressInfo).port;

  try {
    const overrides: UnsafeTestOverrides = { isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) };
    await guardedFetch(`http://127.0.0.1:${portA}/start`, {
      unsafeTestOverrides: overrides,
      headers: {
        accept: "text/plain",
        "user-agent": "test_fixture-agent/1.0",
        "x-goog-api-key": "should-never-cross-an-origin",
        "x-vendor-custom-secret": "an-unrecognized-header-a-denylist-would-have-missed",
      },
      allowedRedirectOrigins: [`http://127.0.0.1:${portA}`, `http://127.0.0.1:${portB}`],
    });
    assert.equal(bReceivedHeaders["x-goog-api-key"], undefined, "an unrecognized vendor API-key header must be stripped on a cross-origin hop");
    assert.equal(bReceivedHeaders["x-vendor-custom-secret"], undefined, "ANY header not on the explicit allowlist must be stripped, not just known-credential-shaped names");
    assert.equal(bReceivedHeaders.accept, "text/plain", "Accept is on the safe allowlist and must still cross origins");
    assert.equal(bReceivedHeaders["user-agent"], "test_fixture-agent/1.0", "User-Agent is on the safe allowlist and must still cross origins");
  } finally {
    serverA.close();
    serverB.close();
  }
});

test("an https:->http: downgrade redirect is always rejected, even to an allowlisted origin", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "net-guard-tls-"));
  const keyPath = path.join(tmpDir, "key.pem");
  const certPath = path.join(tmpDir, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath,
    "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1",
  ]);
  const key = fs.readFileSync(keyPath);
  const cert = fs.readFileSync(certPath);

  const httpServer = http.createServer((_req, res) => {
    res.end("should never be reached — downgrade must be rejected before this");
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const httpPort = (httpServer.address() as AddressInfo).port;

  const httpsServer = https.createServer({ key, cert }, (_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${httpPort}/` });
    res.end();
  });
  await new Promise<void>((resolve) => httpsServer.listen(0, "127.0.0.1", resolve));
  const httpsPort = (httpsServer.address() as AddressInfo).port;

  try {
    const overrides: UnsafeTestOverrides = {
      isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip),
    };
    // The self-signed test cert's issuer is untrusted — relax Node's global
    // TLS verification for the DURATION of this one test only (restored in
    // `finally`) so the first hop's handshake succeeds and we reach the
    // downgrade check on its 302 Location header. This does not touch
    // `guardedFetch`'s own SSRF/redirect logic at all.
    const priorTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      await assert.rejects(
        () =>
          guardedFetch(`https://127.0.0.1:${httpsPort}/start`, {
            unsafeTestOverrides: overrides,
            allowedRedirectOrigins: [`https://127.0.0.1:${httpsPort}`, `http://127.0.0.1:${httpPort}`],
          }),
        RedirectDowngradeError,
      );
    } finally {
      if (priorTlsReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = priorTlsReject;
    }
  } finally {
    httpServer.close();
    httpsServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
