import { POLYGON_CHAIN_ID, POLYMARKET, conditionalTokensAbi } from "../polymarket/contracts.js";
import { condition, edge, readContract, ref, scheduleTrigger } from "../keeperhub/nodes.js";
import type { ResolutionGraph, ResolutionSource } from "./types.js";

const TRIGGER_ID = "trigger";
const TRIGGER_LABEL = "Schedule";
const READ_ID = "read-payout-denominator";
const READ_LABEL = "Read Payout Denominator";
const GATE_ID = "gate-resolved";
const GATE_LABEL = "Market Resolved";

/**
 * Reads the Conditional Tokens Framework's own settlement flag for one market.
 *
 * `payoutDenominator(conditionId)` is zero until the oracle reports payouts and
 * non-zero forever after, so it is the narrowest on-chain fact that means
 * "this market is settled". Polling one market costs one execution per tick
 * whether or not it has resolved; see the event-trigger variant for why this
 * is still the cheaper of the two options today.
 */
export function ctfPayoutPoll(params: { conditionId: `0x${string}`; cron: string }): ResolutionSource {
  return {
    kind: "ctf-payout-poll",
    describe() {
      return `Conditional Tokens ${POLYMARKET.conditionalTokens} payoutDenominator(${params.conditionId}) > 0, checked on cron "${params.cron}"`;
    },
    caveats: [
      "Polling resolves no faster than the cron interval; a redemption has no deadline, so lag costs nothing but time.",
      "Every tick is a billed execution, including ticks where the market has not resolved.",
    ],
    build(): ResolutionGraph {
      const nodes = [
        scheduleTrigger(TRIGGER_ID, TRIGGER_LABEL, params.cron),
        readContract(READ_ID, READ_LABEL, {
          chainId: POLYGON_CHAIN_ID,
          contractAddress: POLYMARKET.conditionalTokens,
          abi: conditionalTokensAbi,
          abiFunction: "payoutDenominator",
          args: [params.conditionId],
          description: "Zero until the oracle reports payouts for this condition",
        }),
        // The ABI output is unnamed, so the step returns the scalar directly
        // rather than wrapping it in a named field.
        condition(GATE_ID, GATE_LABEL, [
          { id: `${GATE_ID}-resolved`, leftOperand: ref(READ_ID, READ_LABEL, "result"), operator: ">", rightOperand: "0" },
        ]),
      ];

      const edges = [edge(TRIGGER_ID, READ_ID), edge(READ_ID, GATE_ID)];

      return { nodes, edges, exit: { nodeId: GATE_ID, handle: "true" } };
    },
  };
}
