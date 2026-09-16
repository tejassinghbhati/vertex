import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// The audit trail is a committed file rather than a database, so a reviewer
// reading the repository sees the same run history the operator does. Every
// field here is copied from a KeeperHub response or read back from the chain;
// nothing is inferred.

export const AUDIT_FILE = "audit/runs.json";

export type RunTx = {
  hash: string;
  nodeId: string;
  nodeName?: string;
  /** KeeperHub re-fetches each hash before settling a run as success. */
  verified?: boolean;
  receiptStatus?: string;
};

export type RunRecord = {
  recordedAt: string;
  label: string;
  workflowId: string;
  executionId: string;
  status: string;
  /** The hash of the workflow a human reviewed, when this run came from a plan. */
  reviewedHash?: string;
  conditionId?: string;
  planFile?: string;
  transactions: RunTx[];
  error?: string | null;
  /** pUSD base units, decoded from the PayoutRedemption log. Absent until read. */
  payoutBaseUnits?: string;
};

export type Audit = { version: 1; runs: RunRecord[] };

export function emptyAudit(): Audit {
  return { version: 1, runs: [] };
}

export function loadAudit(file = AUDIT_FILE): Audit {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Audit;
    if (parsed.version !== 1 || !Array.isArray(parsed.runs)) throw new Error(`${file} is not an audit file`);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyAudit();
    throw error;
  }
}

export function saveAudit(audit: Audit, file = AUDIT_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(audit, null, 2)}\n`);
}

/**
 * Records one run, keyed by execution id.
 *
 * A re-recorded execution replaces the earlier entry instead of appending a
 * second one: a run that was `unconfirmed` when first seen and `success` on a
 * later read is the same run, and an audit trail that shows it twice invites
 * someone to count one redemption as two.
 */
export function appendRun(record: RunRecord, file = AUDIT_FILE): Audit {
  const audit = loadAudit(file);
  const index = audit.runs.findIndex((r) => r.executionId === record.executionId);
  if (index === -1) audit.runs.push(record);
  else audit.runs[index] = { ...audit.runs[index], ...record };
  audit.runs.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  saveAudit(audit, file);
  return audit;
}

export type AuditSummary = {
  runs: number;
  succeeded: number;
  failed: number;
  withTransactions: number;
  redemptions: number;
  payoutBaseUnits: bigint;
};

export function summarize(audit: Audit): AuditSummary {
  let payout = 0n;
  let redemptions = 0;
  for (const run of audit.runs) {
    if (run.payoutBaseUnits) {
      payout += BigInt(run.payoutBaseUnits);
      redemptions += 1;
    }
  }
  return {
    runs: audit.runs.length,
    succeeded: audit.runs.filter((r) => r.status === "success").length,
    // Anything that is not success is a failure, system_error and cancelled included.
    failed: audit.runs.filter((r) => r.status !== "success").length,
    withTransactions: audit.runs.filter((r) => r.transactions.length > 0).length,
    redemptions,
    payoutBaseUnits: payout,
  };
}

/** pUSD and USDC.e both use 6 decimals. */
export function formatPusd(baseUnits: bigint): string {
  const whole = baseUnits / 1_000_000n;
  const fraction = (baseUnits % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}
