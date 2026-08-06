#!/usr/bin/env node
/**
 * Deploy-drift watchdog.
 *
 * Both Render services were `autoDeploy: false` (render.yaml) by deliberate choice —
 * publishing was a manual step. The cost of that choice was that "merged to main" and
 * "live for the user" were different facts, and nothing in the repo ever compared them.
 *
 * That produced the single most-repeated entry in the bug ledger: the user reports the
 * hosted prototype is broken, an investigation establishes the deployed commit is weeks
 * behind main, and the fix turns out to have been merged already. 2026-07-25 had to
 * work this out by hand (deployed `163562a` vs main `cbffa3ed`). It recurred through
 * 2026-07-28 across four separate user reports.
 *
 * ADR-195 (2026-08-07) flipped both services to `autoDeploy: true`, so this script's
 * job changes rather than disappears: routine drift should now self-heal within a few
 * minutes of a push, so persistent drift signals something the automatic path failed
 * to do — a failed Render build, a paused/suspended service, or a rolled-back deploy —
 * not "nobody has deployed yet". Still READ-ONLY: it never deploys, and it never
 * mutates a service.
 *
 * Usage:
 *   node scripts/check-deploy-drift.mjs            # exits 1 on drift
 *   node scripts/check-deploy-drift.mjs --warn     # always exits 0, still reports
 *
 * Requires RENDER_API_KEY. Without it the script SKIPS rather than fails, so it can sit
 * in CI for contributors who have no deploy credentials — a missing key must never be
 * confused with "no drift".
 */
import { execFileSync } from "node:child_process";

const SERVICES = ["bridge-pilot-api", "bridge-pilot-web"];
const API = "https://api.render.com/v1";

const warnOnly = process.argv.includes("--warn");
const apiKey = process.env.RENDER_API_KEY;

function mainSha() {
  return execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim();
}

async function renderGet(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Render API ${path} → ${res.status} ${res.statusText}`);
  return res.json();
}

async function liveCommitFor(serviceName) {
  const services = await renderGet(`/services?name=${encodeURIComponent(serviceName)}&limit=20`);
  const match = services
    .map((entry) => entry.service ?? entry)
    .find((service) => service?.name === serviceName);
  if (!match) return { serviceName, error: "service not found under this API key" };

  const deploys = await renderGet(`/services/${match.id}/deploys?limit=20`);
  const live = deploys
    .map((entry) => entry.deploy ?? entry)
    .find((deploy) => deploy?.status === "live");
  if (!live) return { serviceName, error: "no live deploy found" };

  return {
    serviceName,
    sha: live.commit?.id ?? null,
    finishedAt: live.finishedAt ?? null,
  };
}

function report(lines, drifted) {
  for (const line of lines) console.log(line);
  if (!drifted) {
    console.log("\ncheck-deploy-drift: OK — every service is serving origin/main.");
    return 0;
  }
  console.log(
    "\ncheck-deploy-drift: DRIFT — at least one service is not serving origin/main.\n" +
      "Both services auto-deploy on push (render.yaml autoDeploy:true, ADR-195), so this\n" +
      "usually means the automatic path did not complete — check the Render dashboard for\n" +
      "a failed build, a paused service, or a rollback, rather than assuming it just needs\n" +
      "a manual deploy.",
  );
  return warnOnly ? 0 : 1;
}

async function run() {
  if (!apiKey) {
    console.log(
      "check-deploy-drift: SKIPPED — RENDER_API_KEY is not set.\n" +
        "This is a skip, NOT a pass: deployed state was not checked.",
    );
    return 0;
  }

  const expected = mainSha();
  const lines = [`origin/main   ${expected}`, ""];
  let drifted = false;

  for (const name of SERVICES) {
    let result;
    try {
      result = await liveCommitFor(name);
    } catch (err) {
      result = { serviceName: name, error: err instanceof Error ? err.message : String(err) };
    }
    if (result.error) {
      lines.push(`  ${name.padEnd(18)} ERROR       ${result.error}`);
      drifted = true;
      continue;
    }
    const short = result.sha ? result.sha.slice(0, 7) : "(unknown)";
    if (result.sha === expected) {
      lines.push(`  ${name.padEnd(18)} current     ${short}`);
    } else {
      drifted = true;
      lines.push(
        `  ${name.padEnd(18)} STALE       ${short}` +
          (result.finishedAt ? `  (deployed ${result.finishedAt})` : ""),
      );
    }
  }

  return report(lines, drifted);
}

run().then(
  (code) => process.exit(code),
  (err) => {
    console.error("check-deploy-drift: unexpected failure", err);
    process.exit(warnOnly ? 0 : 1);
  },
);
