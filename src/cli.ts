#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { KeeperHubClient, type WorkflowDefinition } from "./keeperhub/client.js";
import { fetchMarketByConditionId, fetchMarketBySlug, type Market } from "./polymarket/market.js";
import { polymarketRedeem } from "./payout/polymarket-redeem.js";
import { ctfPayoutPoll } from "./resolution/ctf-payout-poll.js";
import { ctfResolutionEvent } from "./resolution/ctf-resolution-event.js";
import { compose, workflowHash } from "./workflow/compose.js";
import { approvalWorkflow, splitWorkflow } from "./workflow/setup.js";
import { marketPreflight, polygonClient, verifyContracts, type Check } from "./chain/preflight.js";
import { redeemedPayout } from "./chain/payout-value.js";
import { appendRun, formatPusd, loadAudit, summarize } from "./audit/record.js";
import { renderDashboard, type PlanLike } from "./audit/dashboard.js";
import type { ResolutionSource } from "./resolution/types.js";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file is fine; the environment may already carry the key.
}

const PLAN_DIR = "workflows";

type Plan = {
  hash: string;
  market: { conditionId: string; question: string; negRisk: boolean; slug: string };
  wallet: string;
  resolution: { kind: string; describes: string; caveats?: string[] };
  payout: { kind: string; describes: string };
  workflow: WorkflowDefinition;
  deployment?: { workflowId: string; deployedAt: string };
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (command) {
    case "verify":
      return await cmdVerify();
    case "plan":
      return await cmdPlan(flags);
    case "preflight":
      return await cmdPreflight(flags);
    case "deploy":
      return await cmdDeploy(flags);
    case "dry-run":
      return await cmdDryRun(flags);
    case "arm":
      return await cmdArm(flags, true);
    case "disarm":
      return await cmdArm(flags, false);
    case "run":
      return await cmdRun(flags);
    case "status":
      return cmdStatus();
    case "dashboard":
      return await cmdDashboard(flags);
    case "setup-approval":
      return await cmdSetup(approvalWorkflow(flags.negrisk === "true"), flags);
    case "setup-split":
      return await cmdSetupSplit(flags);
    default:
      usage();
      process.exitCode = command ? 1 : 0;
  }
}

function usage() {
  console.log(`vertex

  verify                                  check every contract address against Polygon
  plan --slug <s> | --condition <0x..>    author the workflow and write it to ${PLAN_DIR}/
       [--source poll|event] [--cron "*/10 * * * *"] [--wallet 0x..]
  preflight --plan <file>                 read the chain for everything the plan depends on
  deploy --plan <file>                    create the reviewed workflow on KeeperHub, disabled
  dry-run --plan <file>                   simulate the deployed workflow, nothing is broadcast
  arm --plan <file>                       enable the trigger
  disarm --plan <file>                    disable the trigger
  run --plan <file>                       execute now and wait for the receipt
  status                                  print the audit trail: runs, statuses, hashes, payouts
  dashboard [--out docs/dashboard.html]   write the audit trail as a self-contained page
  setup-approval [--negrisk true]         approve the adapter to move outcome tokens
  setup-split --condition <0x..> --amount <pUSD>
                                          split pUSD into a position, for a demo

Every command that moves value prints what it will do first.`);
}

async function cmdVerify() {
  const checks = await verifyContracts(polygonClient());
  report(checks);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

async function cmdPlan(flags: Flags) {
  const market = await resolveMarket(flags);
  // --wallet lets anyone author and review a plan without KeeperHub
  // credentials; without it the organization wallet is looked up.
  const wallet = flags.wallet
    ? (requireAddress(flags.wallet) as `0x${string}`)
    : await KeeperHubClient.fromEnv().walletAddress();

  const source = flags.source ?? "poll";
  const resolution: ResolutionSource =
    source === "event"
      ? ctfResolutionEvent({ conditionId: market.conditionId })
      : ctfPayoutPoll({ conditionId: market.conditionId, cron: flags.cron ?? "*/10 * * * *" });

  const payout = polymarketRedeem({
    conditionId: market.conditionId,
    negRisk: market.negRisk,
    wallet,
    question: market.question,
  });

  const workflow = compose({ name: `Redeem: ${market.question}`.slice(0, 80), resolution, payout });
  const plan: Plan = {
    hash: workflowHash(workflow),
    market: { conditionId: market.conditionId, question: market.question, negRisk: market.negRisk, slug: market.slug },
    wallet,
    resolution: { kind: resolution.kind, describes: resolution.describe(), caveats: resolution.caveats },
    payout: { kind: payout.kind, describes: payout.describe() },
    workflow,
  };

  const file = join(PLAN_DIR, `${market.slug || market.conditionId.slice(0, 10)}.json`);
  writePlan(file, plan);

  console.log(`Market   ${market.question}`);
  console.log(`         ${market.conditionId} (${market.negRisk ? "neg-risk" : "standard"}, closed=${market.closed})`);
  console.log(`\nWhen     ${plan.resolution.describes}`);
  console.log(`Then     ${plan.payout.describes}`);
  for (const caveat of resolution.caveats ?? []) console.log(`         note: ${caveat}`);
  console.log(`\nNodes    ${workflow.nodes.map((n) => n.id).join(" -> ")}`);
  console.log(`Hash     ${plan.hash}`);
  console.log(`Written  ${file}`);
  console.log(`\nReview the file, then: npm run cli preflight -- --plan ${file}`);
}

async function cmdPreflight(flags: Flags) {
  const plan = readPlan(flags);
  const state = await marketPreflight(polygonClient(), {
    conditionId: plan.market.conditionId as `0x${string}`,
    negRisk: plan.market.negRisk,
    wallet: plan.wallet as `0x${string}`,
  });
  report(state.checks);
  console.log(`\nWallet pUSD balance: ${formatUnits(state.pusdBalance)} pUSD`);
  if (!state.resolved) console.log("Market is not resolved yet. The workflow is meant to wait for exactly this.");
}

async function cmdDeploy(flags: Flags) {
  const { plan, file } = readPlanWithPath(flags);
  const recomputed = workflowHash(plan.workflow);
  if (recomputed !== plan.hash) {
    throw new Error(`Plan ${file} was edited after review: hash is ${recomputed}, plan says ${plan.hash}. Re-run plan or restore the file.`);
  }
  if (plan.deployment) {
    console.log(`Already deployed as ${plan.deployment.workflowId}`);
    return;
  }

  const client = KeeperHubClient.fromEnv();
  // Created disabled: the trigger must not fire before the dry run.
  const created = await client.createWorkflow(plan.workflow, false);
  plan.deployment = { workflowId: created.id, deployedAt: new Date().toISOString() };
  writePlan(file, plan);

  console.log(`Deployed ${created.id} (disabled)`);
  console.log(`Reviewed hash ${plan.hash}`);
  console.log(`\nNext: npm run cli dry-run -- --plan ${file}`);
}

async function cmdDryRun(flags: Flags) {
  const { plan, file } = readPlanWithPath(flags);
  const id = requireDeployment(plan, file);
  const client = KeeperHubClient.fromEnv();

  // The deployed workflow must still be the reviewed one.
  const remote = await client.getWorkflow(id);
  const remoteHash = workflowHash({ name: plan.workflow.name, description: plan.workflow.description, nodes: remote.nodes, edges: stripEdges(remote.edges) });
  console.log(remoteHash === plan.hash ? "Deployed workflow matches the reviewed hash" : `WARNING: deployed workflow differs from the reviewed hash\n  reviewed ${plan.hash}\n  deployed ${remoteHash}`);

  const result = await client.simulateWorkflow(id);
  console.log(`\nSimulated ${result.simulatedNodeCount} node(s), skipped ${result.skippedNodeCount}`);
  for (const w of result.warnings ?? []) console.log(`  [${w.code}] ${w.nodeId}: ${w.message}`);
  if (!result.warnings?.length) console.log("  no warnings: the write does not revert against current state");
  console.log(`\nA clean dry run is not a promise. It means the call does not revert right now.`);
}

async function cmdArm(flags: Flags, enabled: boolean) {
  const { plan, file } = readPlanWithPath(flags);
  const id = requireDeployment(plan, file);
  await KeeperHubClient.fromEnv().setEnabled(id, enabled);
  console.log(`${enabled ? "Armed" : "Disarmed"} ${id}`);
}

async function cmdRun(flags: Flags) {
  const { plan, file } = readPlanWithPath(flags);
  const id = requireDeployment(plan, file);
  await executeAndReport(KeeperHubClient.fromEnv(), id, {
    label: plan.workflow.name,
    planFile: file,
    reviewedHash: plan.hash,
    conditionId: plan.market.conditionId,
  });
}

function cmdStatus() {
  const audit = loadAudit();
  const s = summarize(audit);

  if (!audit.runs.length) {
    console.log("No runs recorded yet. Nothing has executed, so no value has moved.");
    return;
  }

  console.log("recorded (UTC)       run                   status      tx                         pUSD");
  for (const run of audit.runs) {
    const tx = run.transactions[0];
    console.log(
      [
        run.recordedAt.replace("T", " ").slice(0, 19),
        run.executionId.padEnd(21),
        run.status.padEnd(11),
        (tx ? `${tx.hash.slice(0, 14)}...${tx.verified === false ? " unverified" : ""}` : "-").padEnd(26),
        run.payoutBaseUnits ? formatPusd(BigInt(run.payoutBaseUnits)) : "-",
      ].join(" "),
    );
    if (run.error) console.log(`  error: ${run.error}`);
  }
  console.log(
    `\n${s.runs} run(s), ${s.succeeded} succeeded, ${s.failed} not, ${s.redemptions} redemption(s), ${formatPusd(s.payoutBaseUnits)} pUSD moved`,
  );
  for (const run of audit.runs.flatMap((r) => r.transactions)) {
    console.log(`  https://polygonscan.com/tx/${run.hash}`);
  }
}

async function cmdDashboard(flags: Flags) {
  const out = flags.out ?? join("docs", "dashboard.html");
  const plans: { file: string; plan: PlanLike }[] = [];

  for (const dir of [PLAN_DIR, "docs"]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const file = join(dir, name);
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as PlanLike;
        if (parsed.workflow?.nodes && parsed.market?.conditionId) plans.push({ file, plan: parsed });
      } catch {
        // Not a plan file; the docs directory holds other JSON too.
      }
    }
  }

  // Checks are read live so the page cannot claim a verification it did not do.
  const checks = await verifyContracts(polygonClient());
  const html = renderDashboard({ generatedAt: new Date().toISOString(), audit: loadAudit(), plans, checks });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`Wrote ${out} (${plans.length} plan(s), ${loadAudit().runs.length} run(s), ${checks.filter((c) => c.ok).length}/${checks.length} checks passing)`);
}

async function cmdSetup(workflow: WorkflowDefinition, flags: Flags) {
  const client = KeeperHubClient.fromEnv();
  console.log(`${workflow.name}: ${workflow.description}`);
  if (flags.yes !== "true") {
    console.log("\nRe-run with --yes to create and execute this workflow.");
    return;
  }
  const created = await client.createWorkflow(workflow, false);
  console.log(`Created ${created.id}`);
  const sim = await client.simulateWorkflow(created.id);
  for (const w of sim.warnings ?? []) console.log(`  [${w.code}] ${w.nodeId}: ${w.message}`);
  await executeAndReport(client, created.id, { label: workflow.name });
}

async function cmdSetupSplit(flags: Flags) {
  if (!flags.condition || !flags.amount) throw new Error("setup-split needs --condition <0x..> and --amount <pUSD>");
  const market = await fetchMarketByConditionId(flags.condition);
  const amountBaseUnits = parseUnits(flags.amount);
  if (amountBaseUnits > 5_000_000n) throw new Error("Refusing to split more than 5 pUSD: this project deals in tiny real amounts");
  await cmdSetup(splitWorkflow({ conditionId: market.conditionId, negRisk: market.negRisk, amountBaseUnits }), flags);
}

async function executeAndReport(
  client: KeeperHubClient,
  workflowId: string,
  context: { label: string; planFile?: string; reviewedHash?: string; conditionId?: string },
) {
  const { executionId } = await client.executeWorkflow(workflowId, randomUUID());
  console.log(`Execution ${executionId} started`);
  const receipt = await client.waitForExecution(executionId);
  console.log(`Status ${receipt.status}`);
  for (const tx of receipt.transactionHashes ?? []) {
    console.log(`  ${tx.nodeName ?? tx.nodeId}: https://polygonscan.com/tx/${tx.hash}${tx.verified === false ? " (unverified)" : ""}`);
  }
  if (receipt.error) console.log(`Error: ${receipt.error}`);

  // What the run paid out is read from the chain, not from the run's own
  // report, so the audit trail states an amount it can defend.
  let payoutBaseUnits: string | undefined;
  const firstTx = receipt.transactionHashes?.[0];
  if (firstTx) {
    try {
      const payout = await redeemedPayout(
        polygonClient(),
        firstTx.hash as `0x${string}`,
        context.conditionId as `0x${string}` | undefined,
      );
      if (payout) {
        payoutBaseUnits = payout.payoutBaseUnits.toString();
        console.log(`Redeemed ${formatPusd(payout.payoutBaseUnits)} pUSD`);
      }
    } catch (error) {
      console.log(`Could not read the payout from the receipt: ${error instanceof Error ? error.message : error}`);
    }
  }

  appendRun({
    recordedAt: new Date().toISOString(),
    label: context.label,
    workflowId,
    executionId,
    status: receipt.status,
    reviewedHash: context.reviewedHash,
    conditionId: context.conditionId,
    planFile: context.planFile,
    transactions: (receipt.transactionHashes ?? []).map((tx) => ({
      hash: tx.hash,
      nodeId: tx.nodeId,
      nodeName: tx.nodeName,
      verified: tx.verified,
      receiptStatus: tx.receiptStatus,
    })),
    error: receipt.error,
    payoutBaseUnits,
  });
  console.log("Recorded in audit/runs.json");

  // Anything other than success is a failure, including system_error and cancelled.
  if (receipt.status !== "success") process.exitCode = 1;
}

async function resolveMarket(flags: Flags): Promise<Market> {
  if (flags.slug) return fetchMarketBySlug(flags.slug);
  if (flags.condition) return fetchMarketByConditionId(flags.condition);
  throw new Error("plan needs --slug <market-slug> or --condition <0x...>");
}

function requireAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`Not an address: ${value}`);
  return value;
}

function requireDeployment(plan: Plan, file: string): string {
  if (!plan.deployment) throw new Error(`${file} has no deployment yet: npm run cli deploy -- --plan ${file}`);
  return plan.deployment.workflowId;
}

function stripEdges(edges: { id: string; source: string; target: string; sourceHandle?: "true" | "false" }[]) {
  // The API adds presentational fields to edges; compare only what we authored.
  return edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}) }));
}

function report(checks: Check[]) {
  for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
}

function readPlan(flags: Flags): Plan {
  return readPlanWithPath(flags).plan;
}

function readPlanWithPath(flags: Flags): { plan: Plan; file: string } {
  if (!flags.plan) throw new Error("this command needs --plan <file>");
  return { plan: JSON.parse(readFileSync(flags.plan, "utf8")) as Plan, file: flags.plan };
}

function writePlan(file: string, plan: Plan) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
}

/** pUSD and USDC.e both use 6 decimals. */
function parseUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
}

function formatUnits(value: bigint): string {
  return `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, "0")}`;
}

type Flags = Record<string, string | undefined>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = "true";
    else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
