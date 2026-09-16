import { writeContract } from "../keeperhub/nodes.js";
import {
  BINARY_PARTITION,
  POLYGON_CHAIN_ID,
  POLYMARKET,
  ZERO_BYTES32,
  adapterFor,
  collateralAdapterAbi,
} from "../polymarket/contracts.js";
import type { Payout } from "./types.js";

/**
 * Redeems a resolved Polymarket position through the collateral adapter for
 * the market's type, paying out in pUSD.
 *
 * The adapter burns the caller's ERC-1155 outcome tokens through the CTF,
 * takes the released USDC.e and wraps it into pUSD for the caller. It ignores
 * its `collateralToken`, `parentCollectionId` and `indexSets` arguments, which
 * exist for IConditionalTokens compatibility, and always redeems the caller's
 * whole balance for both outcomes. That makes the call idempotent: a second
 * run after a successful redemption moves nothing rather than failing.
 *
 * Requires a one-time `setApprovalForAll(adapter, true)` on the CTF from the
 * wallet holding the positions. `npm run cli preflight` checks it.
 */
export function polymarketRedeem(params: {
  conditionId: `0x${string}`;
  negRisk: boolean;
  wallet: `0x${string}`;
  question?: string;
}): Payout {
  const adapter = adapterFor(params.negRisk);

  return {
    kind: "polymarket-redeem",
    settlement: { chainId: POLYGON_CHAIN_ID, token: `pUSD ${POLYMARKET.pUSD}`, recipient: params.wallet },
    describe() {
      const market = params.question ? `"${params.question}" ` : "";
      const kind = params.negRisk ? "neg-risk" : "standard";
      return `redeemPositions(${params.conditionId}) on the ${kind} adapter ${adapter} for market ${market}paying pUSD to ${params.wallet}`;
    },
    node(nodeId: string) {
      return writeContract(nodeId, "Redeem Polymarket Payout", {
        chainId: POLYGON_CHAIN_ID,
        contractAddress: adapter,
        abi: collateralAdapterAbi,
        abiFunction: "redeemPositions",
        // Literal arguments only: what is reviewed and dry-run is what runs.
        args: [POLYMARKET.pUSD, ZERO_BYTES32, params.conditionId, [...BINARY_PARTITION]],
        description: `Redeem resolved position and receive pUSD${params.question ? `: ${params.question}` : ""}`,
      });
    },
  };
}
