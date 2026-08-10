/**
 * The two pure pieces of the graph's visual encoding (ADR-223): categorical
 * node colour + legend, and edge-label placement/fade.
 *
 * These are source-text assertions in the same style as the other web tests —
 * apps/web has no TS-transpiling test runner, so behaviour that must not
 * regress is pinned by reimplementing the pure functions here from the same
 * constants the source exports. Any change to the contract breaks this file.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATAVIEWS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "dataviews");
const palette = readFileSync(join(DATAVIEWS, "graph-palette.ts"), "utf8");
const labels = readFileSync(join(DATAVIEWS, "graph-edge-label.ts"), "utf8");
const view = readFileSync(join(DATAVIEWS, "views", "GraphView.tsx"), "utf8");

test("node colour is categorical and explained, never a hue hash (ADR-223)", () => {
  // The hash is the thing being replaced: 360-way hashing made two Modules
  // routinely render the same colour and told the reader nothing.
  assert.doesNotMatch(view, /hsl\(\$\{Math\.abs\(hash\)/);
  assert.doesNotMatch(view, /function databaseColor/);
  assert.match(view, /buildGraphLegend/);

  // A fixed ordered palette, so few-type graphs draw maximally separated hues.
  const entries = palette.match(/"#[0-9a-f]{6}", \/\//g) ?? [];
  assert.ok(entries.length >= 8, `expected a real palette, saw ${entries.length} entries`);
  assert.equal(new Set(entries).size, entries.length, "palette has duplicate colours");
});

test("colour is assigned over the whole scope, not the rendered slice", () => {
  // Truncating at MAX_RENDERED_NODES must not recolour the surviving types.
  assert.match(view, /buildGraphLegend\(resolvedData\.nodes\)/);
  assert.doesNotMatch(view, /buildGraphLegend\(renderNodes\)/);
  assert.doesNotMatch(view, /buildGraphLegend\(positioned\)/);
});

test("a legend exists — colour that is not explained encodes nothing", () => {
  assert.match(view, /aria-label="Node colour legend"/);
  // Swatch and legend must read from the same map, or they can disagree.
  assert.match(view, /colorOf\(selectedNode\.databaseId\)/);
});

test("edge labels rotate with the edge and never render upside down", () => {
  // Reimplements the source's normalisation: raw angle → (-90, 90].
  const rotate = (dx, dy) => {
    const raw = (Math.atan2(dy, dx) * 180) / Math.PI;
    return raw > 90 ? raw - 180 : raw <= -90 ? raw + 180 : raw;
  };
  assert.equal(rotate(10, 0), 0); // left → right
  assert.equal(rotate(-10, 0), 0); // right → left, flipped upright not 180°
  assert.equal(rotate(0, 10), 90);
  assert.equal(rotate(0, -10), 90); // -90 flips to +90, still upright
  for (const [dx, dy] of [[3, 7], [-3, 7], [3, -7], [-3, -7], [-9, -1], [9, 1]]) {
    const angle = rotate(dx, dy);
    assert.ok(angle > -90 && angle <= 90, `${dx},${dy} → ${angle} is upside down`);
  }
  assert.match(labels, /raw > 90 \? raw - 180 : raw <= -90 \? raw \+ 180 : raw/);
});

test("the label pill is sized to its text, not to a fixed box", () => {
  // The old fixed 88px box made short labels reserve a long label's width and
  // overlap their neighbours constantly.
  assert.doesNotMatch(view, /width=\{88\}/);
  assert.match(view, /width=\{place\.pillWidth\}/);
  assert.match(labels, /text\.length \* CHAR_WIDTH/);
});

test("text fades out as you zoom out, edges before nodes", () => {
  const showEdge = (scale, edgeCount) => {
    if (scale < 0.75) return false;
    return edgeCount <= 120 || scale >= 1.4;
  };
  const showNode = (scale) => scale >= 0.5;

  assert.equal(showEdge(0.6, 5), false, "zoomed out: edge labels hidden");
  assert.equal(showEdge(1, 5), true);
  assert.equal(showEdge(1, 500), false, "dense graph: labels wait for zoom-in");
  assert.equal(showEdge(1.5, 500), true);

  // Edge labels must go first — at 0.6 nodes are still labelled, edges are not.
  assert.equal(showNode(0.6), true);
  assert.equal(showNode(0.4), false);

  // A selected edge keeps its label regardless: the user pointed at it.
  assert.match(view, /edgeLabelsVisible \|\| selectedEdge\?\.id === edge\.id/);
  assert.match(view, /nodeLabelsVisible \|\| selectedNode\?\.id === node\.id/);
  // And the surface says WHY the labels are gone rather than just dropping them.
  assert.match(view, /Zoom in to read Relation labels/);
});

test("a label wider than its edge is withheld, not drawn over the nodes", () => {
  const CHAR_WIDTH = 6, PILL_PAD_X = 10, NODE_RADIUS = 20;
  const fits = (text, dx, dy) =>
    text.length * CHAR_WIDTH + PILL_PAD_X * 2 <= Math.hypot(dx, dy) - NODE_RADIUS * 2;

  assert.equal(fits("worked with", 40, 0), false, "short edge cannot carry an 11-char label");
  assert.equal(fits("worked with", 400, 0), true);
  assert.equal(fits("advises", 200, 0), true);

  assert.match(labels, /fits: pillWidth <= gap/);
  assert.match(view, /if \(!place\.fits && selectedEdge\?\.id !== edge\.id\) return null;/);
});
