import type { WorkflowDefinition } from "../keeperhub/client.js";
import { edge, writeContract } from "../keeperhub/nodes.js";
import {
  BINARY_PARTITION,
  POLYGON_CHAIN_ID,
  POLYMARKET,
  ZERO_BYTES32,
  adapterFor,
  collateralAdapterAbi,
  conditionalTokensAbi,
  erc20Abi,
} from "../polymarket/contracts.js";

// The redeem workflow needs a wallet that already holds a position and has
// approved the adapter. Both setup steps run through KeeperHub as manual
// workflows rather than a side script, so every transaction this project
// makes appears in the same audit trail.

/** One-time: let the adapter move this wallet's outcome tokens. */
export function approvalWorkflow(negRisk: boolean): WorkflowDefinition {
  const adapter = adapterFor(negRisk);
  return {
    name: `Approve Polymarket ${negRisk ? "neg-risk " : ""}adapter`,
    description: `setApprovalForAll(${adapter}, true) on the Conditional Tokens Framework`,
    nodes: [
      { id: "trigger", type: "trigger", data: { label: "Manual", config: { triggerType: "Manual" } } },
      writeContract("approve-adapter", "Approve Adapter For Outcome Tokens", {
        chainId: POLYGON_CHAIN_ID,
        contractAddress: POLYMARKET.conditionalTokens,
        abi: conditionalTokensAbi,
        abiFunction: "setApprovalForAll",
        args: [adapter, true],
      }),
    ],
    edges: [edge("trigger", "approve-adapter")],
  };
}

/**
 * Buys a position the honest way for a demo: split pUSD into one YES and one
 * NO token for a market. After resolution the winning side redeems for the
 * same pUSD, so the round trip costs only gas.
 */
export function splitWorkflow(params: { conditionId: `0x${string}`; negRisk: boolean; amountBaseUnits: bigint }): WorkflowDefinition {
  const adapter = adapterFor(params.negRisk);
  return {
    name: `Split pUSD into a Polymarket position`,
    description: `approve ${params.amountBaseUnits} pUSD base units to ${adapter}, then splitPosition(${params.conditionId})`,
    nodes: [
      { id: "trigger", type: "trigger", data: { label: "Manual", config: { triggerType: "Manual" } } },
      writeContract("approve-pusd", "Approve pUSD", {
        chainId: POLYGON_CHAIN_ID,
        contractAddress: POLYMARKET.pUSD,
        abi: erc20Abi,
        abiFunction: "approve",
        args: [adapter, params.amountBaseUnits],
      }),
      writeContract("split", "Split Into Outcome Tokens", {
        chainId: POLYGON_CHAIN_ID,
        contractAddress: adapter,
        abi: collateralAdapterAbi,
        abiFunction: "splitPosition",
        args: [POLYMARKET.pUSD, ZERO_BYTES32, params.conditionId, [...BINARY_PARTITION], params.amountBaseUnits],
      }),
    ],
    edges: [edge("trigger", "approve-pusd"), edge("approve-pusd", "split")],
  };
}
