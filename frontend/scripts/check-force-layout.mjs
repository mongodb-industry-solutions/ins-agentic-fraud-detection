/**
 * Checks the relationship graph's layout algorithm against the live backend.
 *
 * The layout is hand-written physics rather than d3-force (see useForceLayout.js
 * for why), so the properties a renderer depends on are asserted here instead of
 * being taken on trust: finite coordinates, everything inside the viewBox, no
 * two nodes drawn on top of each other, and — the one that matters most — a
 * fully deterministic result, since a layout that shifted between renders would
 * move claims around under the reader.
 *
 * Requires the backend on :8000. Read-only.
 *
 * Usage:
 *   node scripts/check-force-layout.mjs
 */

import { computeLayout, GRAPH_VIEWBOX } from "../components/fraudIntelligence/useForceLayout.js";

const BASE = process.env.BACKEND_URL || "http://localhost:8000";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`);
  }
}

async function graph(scope) {
  const response = await fetch(`${BASE}/api/fraud/relationship-graph?scope=${scope}&limit=120`);
  if (!response.ok) throw new Error(`${scope}: HTTP ${response.status}`);
  return response.json();
}

function minSeparation(layout) {
  const ids = Object.keys(layout);
  let min = Infinity;
  for (let a = 0; a < ids.length; a += 1) {
    for (let b = a + 1; b < ids.length; b += 1) {
      const dx = layout[ids[a]].x - layout[ids[b]].x;
      const dy = layout[ids[a]].y - layout[ids[b]].y;
      min = Math.min(min, Math.sqrt(dx * dx + dy * dy));
    }
  }
  return min;
}

for (const scope of ["ALL", "FLAGGED", "PENDING"]) {
  console.log(`\n[${scope}]`);
  const data = await graph(scope);
  const layout = computeLayout(data.nodes, data.edges);

  console.log(`  ${data.nodes.length} nodes, ${data.edges.length} edges`);

  if (data.nodes.length === 0) {
    check(`${scope}: empty graph yields an empty layout`, Object.keys(layout).length === 0);
    continue;
  }

  check(
    `${scope}: every node got a position`,
    Object.keys(layout).length === data.nodes.length,
    `${Object.keys(layout).length} of ${data.nodes.length}`
  );

  const coords = Object.values(layout);
  check(
    `${scope}: all coordinates are finite (no NaN from a divide-by-zero)`,
    coords.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    JSON.stringify(coords.filter((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
  );
  check(
    `${scope}: all nodes inside the ${GRAPH_VIEWBOX.width}x${GRAPH_VIEWBOX.height} viewBox`,
    coords.every(
      (p) => p.x >= 0 && p.x <= GRAPH_VIEWBOX.width && p.y >= 0 && p.y <= GRAPH_VIEWBOX.height
    ),
    JSON.stringify(coords.filter((p) => p.x < 0 || p.x > GRAPH_VIEWBOX.width || p.y < 0 || p.y > GRAPH_VIEWBOX.height))
  );

  // Determinism: same input, same output, every time. This is the property that
  // replaces d3-force's seeded randomness.
  const again = computeLayout(data.nodes, data.edges);
  check(
    `${scope}: layout is deterministic across runs`,
    JSON.stringify(layout) === JSON.stringify(again)
  );

  // And independent of the order the API happened to return nodes in.
  const shuffled = computeLayout([...data.nodes].reverse(), [...data.edges].reverse());
  const drift = Object.keys(layout).reduce(
    (max, id) =>
      Math.max(max, Math.abs(layout[id].x - shuffled[id].x), Math.abs(layout[id].y - shuffled[id].y)),
    0
  );
  check(
    `${scope}: layout is stable under input reordering (max drift ${drift.toFixed(3)}px)`,
    drift < 0.5,
    `a claim would jump ${drift.toFixed(1)}px depending on response order`
  );

  if (data.nodes.length > 1) {
    const separation = minSeparation(layout);
    // Node radius is 13, so anything under 26 means two circles overlap.
    check(
      `${scope}: no two nodes overlap (closest pair ${separation.toFixed(1)}px apart, need >26)`,
      separation > 26,
      `closest pair is ${separation.toFixed(1)}px apart`
    );
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((name) => console.log(`  - ${name}`));
}
console.log("=".repeat(60));
process.exit(failures.length ? 1 : 0);
