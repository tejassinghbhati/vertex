import assert from "node:assert/strict";
import { test } from "node:test";
import { polymarketRedeem } from "../src/payout/polymarket-redeem.js";
import { ctfPayoutPoll } from "../src/resolution/ctf-payout-poll.js";
import { ctfResolutionEvent } from "../src/resolution/ctf-resolution-event.js";
import { compose, workflowHash } from "../src/workflow/compose.js";
import { POLYMARKET } from "../src/polymarket/contracts.js";

const CONDITION = "0x341f1a491ca9b6bd4317def4248ba27c5a6b2cf2cf6c5371d62eed551851b104" as const;
const WALLET = "0x00000000000000000000000000000000000000a1" as const;

function build(negRisk = false, source: "poll" | "event" = "poll") {
  return compose({
    name: "test",
    resolution:
      source === "event" ? ctfResolutionEvent({ conditionId: CONDITION }) : ctfPayoutPoll({ conditionId: CONDITION, cron: "*/10 * * * *" }),
    payout: polymarketRedeem({ conditionId: CONDITION, negRisk, wallet: WALLET }),
  });
}

test("the write node uses the API field names the runtime requires", () => {
  const config = build().nodes.at(-1)!.data.config;
  assert.equal(config.actionType, "web3/write-contract");
  assert.equal(config.abiFunction, "redeemPositions");
  // functionName/args save cleanly and then fail at execution; they must never appear.
  assert.ok(!("functionName" in config) && !("args" in config));
  assert.equal(typeof config.abi, "string");
  assert.equal(typeof config.functionArgs, "string");
  assert.equal(config.network, "137");
  assert.equal(config.failOnError, true);
});

test("redeem arguments are literal, so the dry run covers what executes", () => {
  const config = build().nodes.at(-1)!.data.config as Record<string, string>;
  assert.ok(!config.functionArgs.includes("{{"), "no templates in the redeem arguments");
  assert.deepEqual(JSON.parse(config.functionArgs), [
    POLYMARKET.pUSD,
    `0x${"0".repeat(64)}`,
    CONDITION,
    ["1", "2"],
  ]);
});

test("neg-risk markets redeem through the neg-risk adapter", () => {
  assert.equal(build(false).nodes.at(-1)!.data.config.contractAddress, POLYMARKET.ctfCollateralAdapter);
  assert.equal(build(true).nodes.at(-1)!.data.config.contractAddress, POLYMARKET.negRiskCtfCollateralAdapter);
});

test("the payout is wired to the gate's true branch only", () => {
  const workflow = build();
  const intoPayout = workflow.edges.filter((e) => e.target === "payout");
  assert.equal(intoPayout.length, 1);
  assert.equal(intoPayout[0].sourceHandle, "true");
});

test("the hash tracks meaning, not key order", () => {
  const workflow = build();
  const reordered = { ...workflow, nodes: workflow.nodes.map((n) => ({ data: n.data, type: n.type, id: n.id })) };
  assert.equal(workflowHash(workflow), workflowHash(reordered as typeof workflow));
});

test("changing the market changes the hash", () => {
  const other = compose({
    name: "test",
    resolution: ctfPayoutPoll({ conditionId: `0x${"1".repeat(64)}`, cron: "*/10 * * * *" }),
    payout: polymarketRedeem({ conditionId: `0x${"1".repeat(64)}`, negRisk: false, wallet: WALLET }),
  });
  assert.notEqual(workflowHash(build()), workflowHash(other));
});

test("both resolution sources produce a gate the payout can hang off", () => {
  for (const source of ["poll", "event"] as const) {
    const workflow = build(false, source);
    assert.ok(workflow.nodes.some((n) => n.type === "trigger"));
    assert.equal(workflow.edges.filter((e) => e.target === "payout")[0].sourceHandle, "true");
  }
});

test("the event trigger carries its cost caveat", () => {
  const caveats = ctfResolutionEvent({ conditionId: CONDITION }).caveats ?? [];
  assert.ok(caveats.some((c) => c.includes("execution")));
});
