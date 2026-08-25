/**
 * Checks the Patterns sub-tab's presenter against the live backend.
 *
 * The properties asserted here are the ones that would quietly mislead a reader:
 * that the rank shown is the server's own ranking, that the heatmap is symmetric
 * with a dead diagonal, that a missing cell reads as a real 0% rather than as
 * missing data, and — the one the spec explicitly asks to verify rather than
 * assume — that the cell text-colour flip lines up with where the colour ramp
 * actually goes dark.
 *
 * Requires the backend on :8000. Read-only.
 *
 * Usage:
 *   node scripts/with-aliases.mjs scripts/check-patterns.mjs
 */

import {
  needsLightText,
  toCooccurrenceNote,
  toHeatmap,
  toLeaderboardRows,
  toShowingNote,
  toTopPairs,
  toneForRate,
} from "../lib/patternInsightsPresenter.js";

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

async function get(path) {
  const response = await fetch(`${BASE}/api${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

// The spec asks for this to be checked rather than assumed: the light-text
// threshold must coincide exactly with the step that introduces a dark fill.
console.log("\n[text flip lines up with the ramp]");
const darkSteps = new Set();
for (let rate = 0; rate <= 1.0001; rate += 0.005) {
  if (needsLightText(rate)) darkSteps.add(toneForRate(rate));
}
check(
  `light text is used on exactly one ramp step (${[...darkSteps].join(", ")})`,
  darkSteps.size === 1 && darkSteps.has("rate5"),
  `steps needing light text: ${[...darkSteps].join(", ")}`
);
check(
  "the step just below the flip still uses dark text",
  !needsLightText(0.6) && toneForRate(0.6) === "rate4",
  `toneForRate(0.6)=${toneForRate(0.6)} needsLight=${needsLightText(0.6)}`
);
check("a 0% cell uses dark text", !needsLightText(0));
check("a 100% cell uses light text", needsLightText(1));

console.log("\n[leaderboard]");
const lb = await get("/fraud-patterns/leaderboard?limit=5");
const rows = toLeaderboardRows(lb);
check("produced rows", Boolean(rows));

if (rows) {
  console.log(`  ${rows.map((r) => `${r.rank}.${r.patternId}(${r.timesTriggered})`).join(" ")}`);
  check(
    "rank follows the response order, not a local re-sort",
    rows.every((row, index) => row.rank === index + 1) &&
      rows.map((r) => r.patternId).join() === lb.patterns.map((p) => p.patternId).join()
  );
  check("capped at 5 rows", rows.length === 5, String(rows.length));
  rows.forEach((row) => {
    check(
      `${row.patternId}: weight chip label is signed (${row.weightLabel})`,
      /^\+/.test(row.weightLabel),
      row.weightLabel
    );
    check(
      `${row.patternId}: confirmed label states numerator and denominator (${row.confirmedLabel})`,
      row.confirmedLabel === `${row.confirmedCount} of ${row.timesTriggered}`,
      row.confirmedLabel
    );
    check(
      `${row.patternId}: whyEffective present`,
      typeof row.whyEffective === "string" && row.whyEffective.length > 20
    );
  });

  const note = toShowingNote(lb, rows);
  check(
    `showing-note names the real catalogue size (${lb.totalActivePatternCount})`,
    note?.includes(String(lb.totalActivePatternCount)),
    String(note)
  );
}

console.log("\n[co-occurrence]");
const co = await get("/fraud/pattern-cooccurrence?minCooccurrence=2");
const heatmap = toHeatmap(co);
check("produced a heatmap", Boolean(heatmap));

if (heatmap) {
  console.log(`  ${heatmap.axis.length}x${heatmap.axis.length} grid: ` +
    heatmap.axis.map((a) => a.patternId).join(", "));
  check("grid is capped at 8 per axis", heatmap.axis.length <= 8, String(heatmap.axis.length));
  check("grid is square", heatmap.rows.every((row) => row.cells.length === heatmap.axis.length));

  let diagonals = 0;
  let valued = 0;
  heatmap.rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell, colIndex) => {
      if (rowIndex === colIndex) {
        diagonals += 1;
        check(
          `[${row.patternId}][${cell.key}] on the diagonal is dead`,
          cell.isDiagonal === true,
          JSON.stringify(cell)
        );
        return;
      }
      check(
        `[${row.patternId}][${cell.key}] is not marked diagonal`,
        cell.isDiagonal === false
      );
      check(
        `[${row.patternId}][${cell.key}] tone matches its own rate`,
        cell.tone === toneForRate(cell.rate),
        `tone=${cell.tone} rate=${cell.rate}`
      );
      check(
        `[${row.patternId}][${cell.key}] light-text flag matches the threshold`,
        cell.light === needsLightText(cell.rate)
      );
      check(
        `[${row.patternId}][${cell.key}] always renders a label (${cell.label})`,
        typeof cell.label === "string" && cell.label.length > 0
      );
      check(
        `[${row.patternId}][${cell.key}] has an explanatory tooltip`,
        typeof cell.title === "string" && cell.title.includes(row.patternId)
      );
      if (cell.hasValue) valued += 1;
    });
  });

  check(
    `diagonal count equals the axis length (${diagonals})`,
    diagonals === heatmap.axis.length,
    String(diagonals)
  );
  // The whole reason the axis is picked by observed volume rather than
  // catalogue volume: a grid nobody can read anything off is not worth drawing.
  const offDiagonal = heatmap.axis.length * (heatmap.axis.length - 1);
  check(
    `grid is substantially populated (${valued} of ${offDiagonal} off-diagonal cells)`,
    valued > offDiagonal / 2,
    `only ${valued} of ${offDiagonal} cells carry a value`
  );

  // A pair below the threshold is a real zero, not a gap.
  const blanks = heatmap.rows.flatMap((row) =>
    row.cells.filter((cell) => !cell.isDiagonal && !cell.hasValue)
  );
  check(
    "cells with no pair still read as 0%",
    blanks.every((cell) => cell.label === "0%"),
    JSON.stringify(blanks.map((c) => c.label))
  );
}

const pairs = toTopPairs(co);
if (pairs) {
  console.log(`  top pairs: ${pairs.map((p) => `${p.id}=${p.rateLabel}`).join(", ")}`);
  check("top pairs capped at 6", pairs.length <= 6, String(pairs.length));
  check(
    "every top pair names both patterns",
    pairs.every((p) => p.patternNameA && p.patternNameB),
    JSON.stringify(pairs.map((p) => [p.patternNameA, p.patternNameB]))
  );
  check(
    "every top pair carries both the observed and catalogue figures",
    pairs.every((p) => p.rateLabel && p.catalogueRateLabel),
    JSON.stringify(pairs.map((p) => [p.rateLabel, p.catalogueRateLabel]))
  );
}

const note = toCooccurrenceNote(co);
check(
  `sample-size caveat present on a ${co.claimsAnalyzed}-claim sample`,
  co.claimsAnalyzed < 30 ? Boolean(note) : note === null,
  String(note)
);
if (note) console.log(`  note: ${note}`);

// Two-pattern minimum, per the spec's empty condition.
check(
  "a single-pattern axis yields no heatmap",
  toHeatmap({ topPatterns: [{ patternId: "FP-001" }], matrix: {} }) === null
);
check("an empty response yields no heatmap", toHeatmap({}) === null);
check("an empty response yields no leaderboard rows", toLeaderboardRows({ patterns: [] }) === null);

console.log(`\n${"=".repeat(60)}`);
console.log(`${passed} passed, ${failures.length} failed`);
failures.forEach((name) => console.log(`  - ${name}`));
console.log("=".repeat(60));
process.exit(failures.length ? 1 : 0);
