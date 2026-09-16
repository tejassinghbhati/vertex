import type { Check } from "../chain/preflight.js";
import type { PlanLike } from "./dashboard.js";
import { formatPusd, summarize, type Audit, type RunRecord } from "./record.js";

// The site is static, so the diagram cannot read the audit file directly.
// This emits the small JSON the page fetches at view time. Everything in it
// is derived from a recorded run or a live contract check; where there is no
// evidence the value is null and the page says so rather than guessing.

export type NodeState = "idle" | "ran" | "fired" | "skipped" | "failed";

export type SiteState = {
  generatedAt: string;
  market: { question: string; conditionId: string; negRisk: boolean } | null;
  hashes: { reviewed: string | null; deployed: string | null; match: boolean | null };
  runs: { total: number; succeeded: number; failed: number; redemptions: number; payoutPusd: string };
  lastRun: {
    executionId: string;
    status: string;
    recordedAt: string;
    transactionHash: string | null;
    verified: boolean | null;
    reportedPayoutPusd: string | null;
    onchainPayoutPusd: string | null;
  } | null;
  nodes: Record<"trigger" | "read" | "condition" | "payout" | "end", NodeState>;
  branch: "none" | "true" | "false";
  checks: { passing: number; total: number };
};

export function buildSiteState(input: {
  generatedAt: string;
  audit: Audit;
  plans: { file: string; plan: PlanLike }[];
  checks: Check[];
}): SiteState {
  const summary = summarize(input.audit);
  const plan = input.plans[0]?.plan ?? null;
  const last = lastRunWith(input.audit.runs);

  return {
    generatedAt: input.generatedAt,
    market: plan
      ? { question: plan.market.question, conditionId: plan.market.conditionId, negRisk: plan.market.negRisk }
      : null,
    hashes: {
      reviewed: plan?.hash ?? null,
      // The deployed hash is only known once a run has been recorded against
      // a deployed workflow; asserting a match before then would be a lie.
      deployed: last?.reviewedHash ?? null,
      match: plan && last?.reviewedHash ? plan.hash === last.reviewedHash : null,
    },
    runs: {
      total: summary.runs,
      succeeded: summary.succeeded,
      failed: summary.failed,
      redemptions: summary.redemptions,
      payoutPusd: formatPusd(summary.payoutBaseUnits),
    },
    lastRun: last
      ? {
          executionId: last.executionId,
          status: last.status,
          recordedAt: last.recordedAt,
          transactionHash: last.transactions[0]?.hash ?? null,
          verified: last.transactions[0]?.verified ?? null,
          // What the run said it did, against what the chain says it paid.
          reportedPayoutPusd: last.transactions.length ? "recorded" : null,
          onchainPayoutPusd: last.payoutBaseUnits ? formatPusd(BigInt(last.payoutBaseUnits)) : null,
        }
      : null,
    nodes: nodeStates(last),
    branch: branchTaken(last),
    checks: { passing: input.checks.filter((c) => c.ok).length, total: input.checks.length },
  };
}

function lastRunWith(runs: RunRecord[]): RunRecord | null {
  return runs.length ? runs[runs.length - 1] : null;
}

/**
 * Derives which nodes ran from what a run recorded.
 *
 * The audit keeps execution-level facts, not per-node logs, so this stays
 * deliberately coarse: a run that produced a redemption proves the whole path
 * fired, and a run that succeeded without a transaction proves the condition
 * sent it down the false branch.
 */
function nodeStates(last: RunRecord | null): SiteState["nodes"] {
  if (!last) {
    return { trigger: "idle", read: "idle", condition: "idle", payout: "idle", end: "idle" };
  }

  const moved = last.transactions.length > 0;

  if (last.status !== "success") {
    return {
      trigger: "ran",
      read: "ran",
      condition: "ran",
      payout: moved ? "failed" : "idle",
      end: "idle",
    };
  }

  return {
    trigger: "ran",
    read: "ran",
    condition: "ran",
    payout: moved ? "fired" : "skipped",
    end: moved ? "idle" : "ran",
  };
}

function branchTaken(last: RunRecord | null): SiteState["branch"] {
  if (!last || last.status !== "success") return "none";
  return last.transactions.length > 0 ? "true" : "false";
}
