import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { appendRun, formatPusd, loadAudit, summarize, type RunRecord } from "../src/audit/record.js";

const dir = mkdtempSync(join(tmpdir(), "audit-"));
const file = join(dir, "runs.json");
after(() => rmSync(dir, { recursive: true, force: true }));

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    recordedAt: "2026-09-16T12:00:00.000Z",
    label: "Redeem: test market",
    workflowId: "wf_1",
    executionId: "ex_1",
    status: "success",
    transactions: [],
    ...overrides,
  };
}

test("a missing audit file reads as empty rather than throwing", () => {
  assert.deepEqual(loadAudit(join(dir, "absent.json")), { version: 1, runs: [] });
});

test("re-recording an execution replaces it instead of double counting", () => {
  appendRun(run({ status: "unconfirmed" }), file);
  const audit = appendRun(
    run({ status: "success", transactions: [{ hash: "0xabc", nodeId: "payout", verified: true }] }),
    file,
  );
  assert.equal(audit.runs.length, 1);
  assert.equal(audit.runs[0].status, "success");
  assert.equal(audit.runs[0].transactions.length, 1);
});

test("distinct executions accumulate in time order", () => {
  const audit = appendRun(run({ executionId: "ex_0", recordedAt: "2026-09-16T11:00:00.000Z" }), file);
  assert.deepEqual(
    audit.runs.map((r) => r.executionId),
    ["ex_0", "ex_1"],
  );
});

test("the summary counts redemptions and totals the payout", () => {
  appendRun(run({ executionId: "ex_2", payoutBaseUnits: "100000" }), file);
  appendRun(run({ executionId: "ex_3", payoutBaseUnits: "250000" }), file);
  appendRun(run({ executionId: "ex_4", status: "error", error: "boom" }), file);

  const summary = summarize(loadAudit(file));
  assert.equal(summary.redemptions, 2);
  assert.equal(summary.payoutBaseUnits, 350_000n);
  assert.equal(summary.failed, 1); // only ex_4; every other run above settled as success
  assert.equal(formatPusd(summary.payoutBaseUnits), "0.350000");
});

test("pUSD formatting keeps six decimals", () => {
  assert.equal(formatPusd(0n), "0.000000");
  assert.equal(formatPusd(1_000_000n), "1.000000");
  assert.equal(formatPusd(1_234_567n), "1.234567");
});
