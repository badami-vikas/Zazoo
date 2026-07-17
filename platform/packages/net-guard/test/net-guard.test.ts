/**
 * net-guard (TASK-011) — same coverage shape as Tools/recon/test/ssrf.test.ts,
 * proving this package's ported copy behaves identically.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertOutboundAllowed, isBlockedHostname, isBlockedIp } from "../src/index.js";

test("blocks metadata IPv4 literal end-to-end", async () => {
  await assert.rejects(
    () => assertOutboundAllowed("http://169.254.169.254/latest/meta-data/"),
    /SSRF blocked: 169\.254\.169\.254 is a private\/reserved address/,
  );
  await assert.rejects(
    () => assertOutboundAllowed("http://[::ffff:169.254.169.254]/latest/meta-data/"),
    /SSRF blocked: ::ffff:a9fe:a9fe is a private\/reserved address/,
  );
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

test("rejects non-http(s) schemes", async () => {
  await assert.rejects(() => assertOutboundAllowed("file:///etc/passwd"), /unsupported URL scheme/);
  await assert.rejects(() => assertOutboundAllowed("ftp://example.com/x"), /unsupported URL scheme/);
});

test("rejects an invalid URL string", async () => {
  await assert.rejects(() => assertOutboundAllowed("not a url"), /invalid URL/);
});

// NOTE: a live DNS-resolving pass-through check for a real public host (e.g.
// careers.bcg.com — the actual host JobPilot's culture research fetches) is
// deliberately NOT part of this deterministic/offline-safe suite; it was
// verified manually against the live host while building this guard (see
// outputs/2026-07-17-jobpilot-culture-research-task011.md) and is exercised
// for real by JobPilot's own default (non-test) fetcher wiring.
