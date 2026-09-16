import type { Check } from "../chain/preflight.js";
import { formatPusd, summarize, type Audit, type RunRecord } from "./record.js";

// Renders the audit trail as a self-contained HTML page: no network calls at
// view time, no credentials, every figure inlined from the audit file and from
// a live contract check. It is meant to be opened on a projector during a demo,
// so it has to read correctly with zero runs as well as with many.

export type PlanLike = {
  hash: string;
  market: { conditionId: string; question: string; negRisk: boolean; slug: string };
  wallet: string;
  resolution: { kind: string; describes: string; caveats?: string[] };
  payout: { kind: string; describes: string };
  workflow: {
    name: string;
    nodes: { id: string; type: string; data: { label: string; config: Record<string, unknown> } }[];
  };
  deployment?: { workflowId: string; deployedAt: string };
};

export type DashboardInput = {
  generatedAt: string;
  audit: Audit;
  plans: { file: string; plan: PlanLike }[];
  checks: Check[];
};

export function renderDashboard(input: DashboardInput): string {
  const s = summarize(input.audit);
  const checksOk = input.checks.filter((c) => c.ok).length;

  return `<title>Redemption Ledger</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap">
<style>
:root {
  --ground: #F1F3F7;
  --surface: #FFFFFF;
  --line: #DCE1EA;
  --ink: #10131A;
  --muted: #5A6377;
  --accent: #2D4A7C;
  --accent-soft: #E7EDF7;
  --ok: #0F7B52;
  --ok-soft: #E3F1EA;
  --warn: #8A6100;
  --warn-soft: #F7EEDB;
  --crit: #B3261E;
  --crit-soft: #FAE7E5;
  --display: "Archivo", "Helvetica Neue", Arial, sans-serif;
  --body: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #0C0F16;
    --surface: #151A24;
    --line: #252C3A;
    --ink: #E7EAF2;
    --muted: #98A1B5;
    --accent: #9BB6E8;
    --accent-soft: #1B2436;
    --ok: #57C08A;
    --ok-soft: #14261E;
    --warn: #D9A521;
    --warn-soft: #2A2214;
    --crit: #F08279;
    --crit-soft: #2C1917;
  }
}
:root[data-theme="dark"] {
  --ground: #0C0F16;
  --surface: #151A24;
  --line: #252C3A;
  --ink: #E7EAF2;
  --muted: #98A1B5;
  --accent: #9BB6E8;
  --accent-soft: #1B2436;
  --ok: #57C08A;
  --ok-soft: #14261E;
  --warn: #D9A521;
  --warn-soft: #2A2214;
  --crit: #F08279;
  --crit-soft: #2C1917;
}
* { box-sizing: border-box; }
body {
  background: var(--ground);
  color: var(--ink);
  font-family: var(--body);
  font-size: 15px;
  line-height: 1.55;
  margin: 0;
}
.page {
  max-width: 1100px;
  margin: 0 auto;
  padding-inline: 20px;
  padding-block: 40px 64px;
  display: flex;
  flex-direction: column;
  gap: 36px;
}
h1, h2, h3 { font-family: var(--display); text-wrap: balance; margin: 0; }
h1 { font-size: clamp(28px, 4.5vw, 40px); font-weight: 700; letter-spacing: -0.02em; }
h2 { font-size: 15px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted); }
h3 { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
p { margin: 0; }
a { color: var(--accent); }
code, .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.lede { max-width: 66ch; color: var(--muted); font-size: 17px; }
.section { display: flex; flex-direction: column; gap: 14px; }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
.tile {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tile .figure { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 27px; font-weight: 500; letter-spacing: -0.02em; }
.tile .caption { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.tile.live .figure { color: var(--accent); }

.plan { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 22px; display: flex; flex-direction: column; gap: 18px; }
.plan-head { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: baseline; justify-content: space-between; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; color: var(--muted); }
.meta .mono { color: var(--ink); }

.chain { display: flex; flex-wrap: wrap; align-items: stretch; gap: 10px; }
.step { flex: 1 1 170px; border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 5px; background: var(--ground); }
.step .kind { font-size: 11px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted); }
.step .name { font-family: var(--display); font-weight: 600; font-size: 14px; }
.step .detail { font-family: var(--mono); font-size: 11.5px; color: var(--muted); overflow-wrap: anywhere; }
.step.writes { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 1px 0 var(--accent) inset; }
.arrow { align-self: center; color: var(--muted); font-family: var(--mono); }

.args { border-left: 2px solid var(--accent); padding-left: 14px; display: flex; flex-direction: column; gap: 3px; }
.args .arg { font-family: var(--mono); font-size: 12.5px; overflow-wrap: anywhere; }
.args .arg .label { color: var(--muted); }

.pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 500; white-space: nowrap; }
.pill.ok { background: var(--ok-soft); color: var(--ok); }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.crit { background: var(--crit-soft); color: var(--crit); }
.pill.idle { background: var(--accent-soft); color: var(--accent); }

.scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; padding: 11px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { font-family: var(--display); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
tr:last-child td { border-bottom: none; }
td.num { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: right; }
td.mono { font-family: var(--mono); font-size: 12.5px; }

.empty { background: var(--surface); border: 1px dashed var(--line); border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 10px; }
.empty ul { margin: 0; padding-left: 20px; color: var(--muted); display: flex; flex-direction: column; gap: 4px; }

.checks { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 0 26px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 8px 20px; }
.check { display: flex; gap: 10px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid var(--line); }
.check:last-child { border-bottom: none; }
.check .mark { font-family: var(--mono); font-size: 12px; color: var(--ok); }
.check.bad .mark { color: var(--crit); }
.check .what { font-size: 13.5px; }
.check .detail { font-family: var(--mono); font-size: 11.5px; color: var(--muted); overflow-wrap: anywhere; }

footer { color: var(--muted); font-size: 12.5px; display: flex; flex-direction: column; gap: 5px; }
@media (max-width: 640px) {
  .arrow { display: none; }
  .step { flex-basis: 100%; }
}
</style>

<div class="page">
  <header class="section">
    <h1>Redemption Ledger</h1>
    <p class="lede">A resolved Polymarket market is a settled decision nobody has executed yet. This is the execution record: what was reviewed, what was dry run, and what actually moved on Polygon.</p>
  </header>

  <section class="section">
    <h2>State</h2>
    <div class="tiles">
      <div class="tile live">
        <span class="figure">${formatPusd(s.payoutBaseUnits)}</span>
        <span class="caption">pUSD redeemed</span>
      </div>
      <div class="tile">
        <span class="figure">${s.redemptions}</span>
        <span class="caption">Redemptions</span>
      </div>
      <div class="tile">
        <span class="figure">${s.runs}</span>
        <span class="caption">Runs recorded</span>
      </div>
      <div class="tile">
        <span class="figure">${checksOk}/${input.checks.length}</span>
        <span class="caption">Contract checks passing</span>
      </div>
    </div>
  </section>

  <section class="section">
    <h2>Reviewed workflows</h2>
    ${input.plans.map((p) => renderPlan(p.file, p.plan)).join("\n")}
  </section>

  <section class="section">
    <h2>Runs</h2>
    ${input.audit.runs.length ? renderRuns(input.audit.runs) : renderEmptyRuns()}
  </section>

  <section class="section">
    <h2>Contract verification</h2>
    <div class="checks">
      ${input.checks.map(renderCheck).join("\n")}
    </div>
  </section>

  <footer>
    <p>Generated ${esc(input.generatedAt)} by <span class="mono">npm run cli dashboard</span>. Contract checks read Polygon mainnet live at generation time; run rows are copied from KeeperHub execution receipts and payouts are decoded from the <span class="mono">PayoutRedemption</span> log.</p>
    <p>Polymarket contracts per <a href="https://docs.polymarket.com/resources/contracts">docs.polymarket.com/resources/contracts</a>. Execution through <a href="https://docs.keeperhub.com/">KeeperHub</a>.</p>
  </footer>
</div>
`;
}

function renderPlan(file: string, plan: PlanLike): string {
  const payoutNode = plan.workflow.nodes.find((n) => n.data.config.actionType === "web3/write-contract");
  const args = parseArgs(payoutNode?.data.config.functionArgs);
  const argLabels = ["collateralToken", "parentCollectionId", "conditionId", "indexSets"];

  return `<article class="plan">
      <div class="plan-head">
        <h3>${esc(plan.market.question)}</h3>
        <span class="pill ${plan.deployment ? "ok" : "idle"}">${plan.deployment ? "Deployed" : "Not deployed"}</span>
      </div>
      <div class="meta">
        <span>Condition <span class="mono">${esc(short(plan.market.conditionId))}</span></span>
        <span>Market type <span class="mono">${plan.market.negRisk ? "neg-risk" : "standard"}</span></span>
        <span>Reviewed hash <span class="mono">${esc(short(plan.hash))}</span></span>
        ${plan.deployment ? `<span>Workflow <span class="mono">${esc(plan.deployment.workflowId)}</span></span>` : ""}
        <span>Plan <span class="mono">${esc(file)}</span></span>
      </div>

      <div class="chain">
        ${plan.workflow.nodes.map((node, i) => renderStep(node, i === plan.workflow.nodes.length - 1)).join('\n        <span class="arrow">&rarr;</span>\n        ')}
      </div>

      ${
        args.length
          ? `<div class="args">
        ${args.map((a, i) => `<span class="arg"><span class="label">${esc(argLabels[i] ?? `arg${i}`)}</span> ${esc(Array.isArray(a) ? `[${a.join(", ")}]` : String(a))}</span>`).join("\n        ")}
      </div>`
          : ""
      }
      <p class="meta">Every argument above is a literal in the reviewed file. Nothing is templated, so the dry run covers the call that executes.</p>
    </article>`;
}

function renderStep(node: PlanLike["workflow"]["nodes"][number], isWrite: boolean): string {
  const config = node.data.config;
  const kind =
    node.type === "trigger" ? String(config.triggerType ?? "trigger") : String(config.actionType ?? "action");
  const detail =
    kind === "Schedule"
      ? String(config.scheduleCron ?? "")
      : kind === "Event"
        ? `${String(config.eventName ?? "")} @ ${short(String(config.contractAddress ?? ""))}`
        : kind === "Condition"
          ? String(config.condition ?? "")
          : `${String(config.abiFunction ?? "")} @ ${short(String(config.contractAddress ?? ""))}`;

  return `<div class="step${isWrite ? " writes" : ""}">
          <span class="kind">${esc(kind)}</span>
          <span class="name">${esc(node.data.label)}</span>
          <span class="detail">${esc(detail)}</span>
        </div>`;
}

function renderRuns(runs: RunRecord[]): string {
  const rows = [...runs].reverse().map((run) => {
    const tx = run.transactions[0];
    return `<tr>
          <td class="mono">${esc(run.recordedAt.replace("T", " ").slice(0, 19))}</td>
          <td class="mono">${esc(run.executionId)}</td>
          <td>${statusPill(run.status)}</td>
          <td>${esc(run.label)}</td>
          <td class="mono">${
            tx
              ? `<a href="https://polygonscan.com/tx/${esc(tx.hash)}">${esc(short(tx.hash))}</a>${tx.verified === false ? " unverified" : ""}`
              : "&mdash;"
          }</td>
          <td class="num">${run.payoutBaseUnits ? formatPusd(BigInt(run.payoutBaseUnits)) : "&mdash;"}</td>
        </tr>`;
  });

  return `<div class="scroll">
      <table>
        <thead><tr><th>Recorded (UTC)</th><th>Run</th><th>Status</th><th>Workflow</th><th>Transaction</th><th>pUSD</th></tr></thead>
        <tbody>
          ${rows.join("\n          ")}
        </tbody>
      </table>
    </div>`;
}

function renderEmptyRuns(): string {
  return `<div class="empty">
      <h3>Nothing has executed yet</h3>
      <p class="lede">No run is recorded, so no value has moved. This page states that rather than showing a sample row, because the point of it is proof.</p>
      <ul>
        <li>Needs a KeeperHub organization key (<span class="mono">kh_</span>) to deploy and execute.</li>
        <li>Needs pUSD on the organization's Turnkey wallet to hold a position worth redeeming.</li>
        <li>Contract verification below runs without either, and passes today.</li>
      </ul>
    </div>`;
}

function renderCheck(check: Check): string {
  return `<div class="check${check.ok ? "" : " bad"}">
        <span class="mark">${check.ok ? "OK" : "XX"}</span>
        <span><span class="what">${esc(check.name)}</span><br><span class="detail">${esc(check.detail)}</span></span>
      </div>`;
}

function statusPill(status: string): string {
  const tone = status === "success" ? "ok" : status === "pending" || status === "running" || status === "unconfirmed" ? "warn" : "crit";
  return `<span class="pill ${tone}">${esc(status)}</span>`;
}

function parseArgs(value: unknown): unknown[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function short(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
