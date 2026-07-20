import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../src/app/pages/DealPilotPage.tsx", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../src/app/routes.tsx", import.meta.url), "utf8");
const trpcSource = await readFile(new URL("../src/app/lib/trpc.ts", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../src/app/data/api.ts", import.meta.url), "utf8");
const googleSource = await readFile(new URL("../src/app/pages/GoogleIntegrationPanel.tsx", import.meta.url), "utf8");
const formSource = await readFile(new URL("../src/app/dataviews/views/FormView.tsx", import.meta.url), "utf8");

test("DealPilot exposes exactly the Deals, Sources, and Theses default Page routes", () => {
  assert.match(routeSource, /dealpilot\/:page/);
  assert.match(routeSource, /dealpilot\/:page\/:recordId/);
  assert.match(pageSource, /deals: \{ label: "Deals"/);
  assert.match(pageSource, /sources: \{ label: "Sources"/);
  assert.match(pageSource, /theses: \{ label: "Theses"/);
  for (const forbidden of ["Overview", "Summary", "Reports"]) {
    assert.doesNotMatch(pageSource, new RegExp(`label: "${forbidden}"`));
  }
});

test("DealPilot uses real tRPC Records and the shared real-data View shell without runtime fixture storage", () => {
  assert.match(pageSource, /trpc\.dealpilot\.records\.query/);
  assert.match(pageSource, /<DataViews/);
  assert.match(pageSource, /data=\{dataRows\}/);
  assert.match(pageSource, /<ModuleFilesSection moduleName="deal-pilot"/);
  assert.doesNotMatch(pageSource, /localStorage|dummy_|test_fixture_|DEFAULT_THESIS|LISTINGS/);
});

test("Source credentials require re-authentication and are never persisted by the page", () => {
  assert.match(pageSource, /supabase\.auth\.signInWithPassword/);
  assert.match(pageSource, /reauthenticateCredential/);
  assert.match(pageSource, /accessCredential/);
  assert.match(pageSource, /clearCredential/);
  assert.match(pageSource, /Revoke credential/);
  assert.match(pageSource, /credentialCleanupAvailable/);
  assert.match(pageSource, /navigator\.clipboard\.writeText/);
  assert.match(pageSource, /navigator\.clipboard\s*\.readText/);
  assert.match(pageSource, /window\.setTimeout/);
  assert.match(pageSource, /setReauthToken\(null\)/);
  assert.match(pageSource, /setRevealed\(\{\}\)/);
  assert.match(pageSource, /"rightsAttested",\s*"userId",\s*"password"/s);
  assert.match(pageSource, /\.\.\.\(draft\["userId"\]/);
  assert.match(pageSource, /\.\.\.\(draft\["password"\]/);
  assert.match(pageSource, /sensitive: column\.kind === "credential"/);
  assert.match(formSource, /type=\{col\.sensitive \? "password" : "text"\}/);
  assert.match(formSource, /autoComplete=\{col\.sensitive \? "new-password" : undefined\}/);
  assert.doesNotMatch(pageSource, /sessionStorage|localStorage/);
  assert.match(
    trpcSource,
    /x-bridge-sidecar-token.*__BRIDGE_SIDECAR_TOKEN__/s,
  );
});

test("DealPilot surfaces governed Thesis and Source discovery", () => {
  assert.match(pageSource, /trpc\.action\.decide\.mutate/);
  assert.match(pageSource, /effectsStatus === "failed"/);
  assert.match(pageSource, /discoverDeals/);
  assert.match(pageSource, /disabled=\{discovering\}/);
  assert.match(pageSource, /Quarantined Deal candidates/);
  assert.match(pageSource, /trpc\.dealpilot\.commit/);
});

test("route-bound DealPilot reads discard stale responses", () => {
  assert.match(pageSource, /loadGeneration\.current === generation/);
  assert.match(pageSource, /currentRouteKey\.current === expectedRouteKey/);
  assert.match(pageSource, /loadGeneration\.current \+= 1/);
  assert.match(pageSource, /setDetail\(null\)/);
  assert.match(pageSource, /setCaptures\(\[\]\)/);
});

test("DealPilot loads every Record page rather than hiding rows after the first API page", () => {
  assert.match(pageSource, /async function queryAllRecords/);
  assert.match(pageSource, /while \(current\.hasMore && current\.items\.length > 0\)/);
  assert.match(pageSource, /offset: items\.length/);
});

test("desktop Google OAuth opens in the system browser, not the privileged webview", () => {
  assert.match(googleSource, /open_google_oauth/);
  assert.match(googleSource, /window\.__BRIDGE_DESKTOP__/);
  assert.match(googleSource, /addEventListener\('focus'/);
  assert.match(googleSource, /apiIntegrationList\(\)/);
  assert.doesNotMatch(googleSource, /window\.location\.href\s*=/);
  assert.match(apiSource, /API_TRANSPORT_CONFIGURED/);
  assert.match(apiSource, /await trpcAuthorizationHeaders\(\)/);
  assert.match(trpcSource, /__BRIDGE_API_URL__/);
  assert.match(trpcSource, /__BRIDGE_SIDECAR_TOKEN__/);
  assert.match(trpcSource, /import\.meta\.env\.DEV \? "http:\/\/localhost:4000"/);
  assert.doesNotMatch(trpcSource, /CONFIGURED_API_URL \|\| "http:\/\/localhost:4000"/);
  assert.match(trpcSource, /Bridge API transport is not configured/);
});
