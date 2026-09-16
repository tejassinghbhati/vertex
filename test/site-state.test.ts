import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSiteState } from "../src/audit/site-state.js";
import type { Audit, RunRecord } from "../src/audit/record.js";
import type { PlanLike } from "../src/audit/dashboard.js";

const plan: PlanLike = {
  hash: "a9c1b99a",
  market: { conditionId: "0xabc", question: "Will it resolve?", negRisk: false, slug: "will-it" },
  wallet: "0x0000000000000000000000000000000000000001",
  resolution: { kind: "ctf-payout-poll", describes: "payoutDenominator > 0" },
  payout: { kind: "polymarket-redeem", describes: "redeemPositions" },
  workflow: { name: "Redeem", nodes: [] },
};

const checks = [
  { name: "a", ok: true, detail: "" },
  { name: "b", ok: true, detail: "" },
];

function state(runs: RunRecord[]) {
  const audit: Audit = { version: 1, runs };
  return buildSiteState({ generatedAt: "2026-09-16T12:00:00.000Z", audit, plans: [{ file: "p.json", plan }], checks });
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    recordedAt: "2026-09-16T12:00:00.000Z",
    label: "Redeem",
    workflowId: "wf_1",
    executionId: "ex_1",
    status: "success",
    transactions: [],
    ...overrides,
  };
}

test("with no runs every node is idle and nothing is claimed about the deployment", () => {
  const s = state([]);
  assert.deepEqual(s.nodes, { trigger: "idle", read: "idle", condition: "idle", payout: "idle", end: "idle" });
  assert.equal(s.branch, "none");
  assert.equal(s.lastRun, null);
  assert.equal(s.hashes.reviewed, "a9c1b99a");
  assert.equal(s.hashes.deployed, null);
  assert.equal(s.hashes.match, null, "a match must not be asserted before a run proves it");
  assert.equal(s.runs.payoutPusd, "0.000000");
});

test("a successful run with no transaction took the false branch", () => {
  const s = state([run()]);
  assert.equal(s.branch, "false");
  assert.equal(s.nodes.payout, "skipped");
  assert.equal(s.nodes.end, "ran");
  assert.equal(s.lastRun?.onchainPayoutPusd, null);
});

test("a redemption lights the whole path and reports the on-chain payout", () => {
  const s = state([
    run({
      transactions: [{ hash: "0xdead", nodeId: "payout", verified: true }],
      payoutBaseUnits: "100000",
      reviewedHash: "a9c1b99a",
    }),
  ]);
  assert.equal(s.branch, "true");
  assert.equal(s.nodes.payout, "fired");
  assert.equal(s.lastRun?.transactionHash, "0xdead");
  assert.equal(s.lastRun?.onchainPayoutPusd, "0.100000");
  assert.equal(s.hashes.match, true);
  assert.equal(s.runs.redemptions, 1);
});

test("a failed run marks the write failed rather than fired", () => {
  const s = state([run({ status: "error", error: "reverted", transactions: [{ hash: "0xbad", nodeId: "payout" }] })]);
  assert.equal(s.nodes.payout, "failed");
  assert.equal(s.branch, "none");
});

test("a mismatched hash is reported as a mismatch, not hidden", () => {
  const s = state([run({ reviewedHash: "different", transactions: [{ hash: "0x1", nodeId: "payout" }] })]);
  assert.equal(s.hashes.match, false);
});
