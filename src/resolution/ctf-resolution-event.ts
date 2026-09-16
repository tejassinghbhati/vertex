import { POLYGON_CHAIN_ID, POLYMARKET, conditionalTokensAbi } from "../polymarket/contracts.js";
import { condition, edge, eventTrigger, ref } from "../keeperhub/nodes.js";
import type { ResolutionGraph, ResolutionSource } from "./types.js";

const TRIGGER_ID = "trigger";
const TRIGGER_LABEL = "Condition Resolution";
const GATE_ID = "gate-this-market";
const GATE_LABEL = "Is This Market";

/**
 * Fires on the CTF's `ConditionResolution` event, the moment of settlement
 * itself, and filters to one market in a Condition node.
 *
 * This is the faithful shape of the idea, and it is not the default, because
 * KeeperHub's Event trigger cannot filter on event arguments: the workflow is
 * woken for every market Polymarket resolves (roughly 700 an hour) and pays an
 * execution for each. Argument filtering, or the `stateThreshold` trigger in
 * KeeperHub issue #2240, would make this strictly better than polling.
 */
export function ctfResolutionEvent(params: { conditionId: `0x${string}` }): ResolutionSource {
  return {
    kind: "ctf-resolution-event",
    describe() {
      return `Conditional Tokens ${POLYMARKET.conditionalTokens} ConditionResolution event, filtered to ${params.conditionId}`;
    },
    caveats: [
      "The Event trigger has no argument filter, so this wakes on every market Polymarket resolves and bills an execution for each.",
      "Only use this once KeeperHub supports indexed-argument filtering; until then ctf-payout-poll costs far less for the same outcome.",
    ],
    build(): ResolutionGraph {
      const nodes = [
        eventTrigger(TRIGGER_ID, TRIGGER_LABEL, {
          chainId: POLYGON_CHAIN_ID,
          contractAddress: POLYMARKET.conditionalTokens,
          abi: conditionalTokensAbi,
          eventName: "ConditionResolution",
        }),
        condition(GATE_ID, GATE_LABEL, [
          {
            id: `${GATE_ID}-match`,
            leftOperand: ref(TRIGGER_ID, TRIGGER_LABEL, "args.conditionId"),
            operator: "===",
            rightOperand: params.conditionId,
          },
        ]),
      ];

      return { nodes, edges: [edge(TRIGGER_ID, GATE_ID)], exit: { nodeId: GATE_ID, handle: "true" } };
    },
  };
}
