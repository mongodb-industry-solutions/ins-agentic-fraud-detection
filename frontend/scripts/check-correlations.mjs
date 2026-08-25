/**
 * Checks the Correlations tab's presenter against the live backend.
 *
 * The value of this tab is entirely in whether the numbers and the colour ramp
 * are honest, so the properties asserted here are the ones that would mislead a
 * reader if they broke: worst-first ordering, a stable order under equal rates,
 * an absolute (never rescaled) colour scale, bar widths that equal the rate, and
 * labels taken from the response rather than built locally.
 *
 * Requires the backend on :8000. Read-only.
 *
 * Usage:
 *   node scripts/check-correlations.mjs
 */

import {
  DIMENSIONS,
  toBreakdownRows,
  toConfidenceNote,
  toneForRate,
} from "../lib/fraudCorrelationsPresenter.js";

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

// The ramp must depend only on the rate, never on the dataset around it.
console.log("\n[colour scale is absolute]");
check("0% and 5% share the lowest step", toneForRate(0) === toneForRate(0.05));
check("100% lands on the top step", toneForRate(1) === "rate5");
check("15% does not land on the top step", toneForRate(0.15) !== "rate5");
check(
  "the ramp is monotonic across the whole 0..1 range",
  (() => {
    const order = ["rate0", "rate1", "rate2", "rate3", "rate4", "rate5"];
    let previous = -1;
    for (let rate = 0; rate <= 1.0001; rate += 0.01) {
      const index = order.indexOf(toneForRate(rate));
      if (index < previous) return false;
      previous = index;
    }
    return true;
  })()
);
check("a missing rate is treated as 0, not as the top step", toneForRate(undefined) === "rate0");

for (const dimension of DIMENSIONS) {
  console.log(`\n[${dimension.id}]`);
  const response = await fetch(`${BASE}/api/fraud/rate-breakdown?dimension=${dimension.id}`);
  check(`${dimension.id}: accepted by the API (HTTP ${response.status})`, response.ok);
  if (!response.ok) continue;

  const data = await response.json();
  const rows = toBreakdownRows(data);
  check(`${dimension.id}: produced rows`, Boolean(rows), JSON.stringify(data).slice(0, 200));
  if (!rows) continue;

  console.log(
    `  ${rows.length} groups: ` +
      rows.map((r) => `${r.displayLabel}=${r.rateLabel}`).join(", ")
  );

  // Worst-first is the whole premise of the view.
  const rates = rows.map((r) => r.confirmedFraudRate ?? 0);
  check(
    `${dimension.id}: sorted by confirmed rate descending`,
    rates.every((rate, i) => i === 0 || rates[i - 1] >= rate),
    JSON.stringify(rates)
  );

  // Equal rates are common in this dataset, so the tiebreak has to be stable.
  const reshuffled = toBreakdownRows({
    ...data,
    breakdown: [...data.breakdown].reverse(),
  });
  check(
    `${dimension.id}: order is stable under input reordering`,
    JSON.stringify(rows.map((r) => r.value)) ===
      JSON.stringify(reshuffled.map((r) => r.value)),
    `${rows.map((r) => r.value)} vs ${reshuffled.map((r) => r.value)}`
  );

  for (const row of rows) {
    // Bar length is the rate on a fixed track, not a share of the longest bar.
    const expectedWidth = Math.max(0, Math.min(100, (row.confirmedFraudRate ?? 0) * 100));
    check(
      `${dimension.id}/${row.displayLabel}: bar width equals the rate (${row.widthPct.toFixed(1)}%)`,
      Math.abs(row.widthPct - expectedWidth) < 1e-9,
      `width=${row.widthPct} rate=${row.confirmedFraudRate}`
    );
    check(
      `${dimension.id}/${row.displayLabel}: label came from the response`,
      Boolean(row.label),
      JSON.stringify(row)
    );
    check(
      `${dimension.id}/${row.displayLabel}: counts sum to total`,
      row.flagged + row.cleared + row.pending + row.unprocessed === row.total,
      JSON.stringify(row)
    );
    check(
      `${dimension.id}/${row.displayLabel}: tone matches its own rate`,
      row.tone === toneForRate(row.confirmedFraudRate),
      `tone=${row.tone} rate=${row.confirmedFraudRate}`
    );
  }

  // Bucketed dimensions must arrive pre-formatted; nothing builds "$" locally.
  if (dimension.id.endsWith("Bucket")) {
    const formatted = rows.every((row) => /[$]|year|Other/.test(row.label));
    check(
      `${dimension.id}: bucket labels are formatted server-side`,
      formatted,
      JSON.stringify(rows.map((r) => r.label))
    );
    check(
      `${dimension.id}: label differs from the raw key (so it is a real label)`,
      rows.some((row) => row.label !== row.value),
      JSON.stringify(rows.map((r) => [r.value, r.label]))
    );
  }

  const note = toConfidenceNote(rows);
  const thin = rows.filter((r) => (r.decidedCount ?? 0) > 0 && r.decidedCount < 5).length;
  const none = rows.filter((r) => (r.decidedCount ?? 0) === 0).length;
  check(
    `${dimension.id}: thin-evidence caveat present exactly when warranted`,
    Boolean(note) === (thin > 0 || none > 0),
    `note=${note === null ? "null" : "set"} thin=${thin} undecided=${none}`
  );
  if (note) console.log(`  note: ${note}`);
}

// An unsupported dimension must fail loudly rather than fall back to something.
console.log("\n[rejects unknown dimensions]");
const bad = await fetch(`${BASE}/api/fraud/rate-breakdown?dimension=claimAmount`);
check(
  "the spec's 'claimAmount' is rejected (the enum is 'claimAmountBucket')",
  bad.status === 422,
  `HTTP ${bad.status}`
);

console.log(`\n${"=".repeat(60)}`);
console.log(`${passed} passed, ${failures.length} failed`);
failures.forEach((name) => console.log(`  - ${name}`));
console.log("=".repeat(60));
process.exit(failures.length ? 1 : 0);
