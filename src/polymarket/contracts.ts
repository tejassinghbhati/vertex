import { parseAbi } from "viem";

// Polymarket runs on Polygon mainnet only. Every address below is taken from
// https://docs.polymarket.com/resources/contracts and checked against live
// chain state by `npm run cli verify` (see docs/verification.md). Do not add
// an address here without adding it to that check.
export const POLYGON_CHAIN_ID = 137;

export const POLYMARKET = {
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  pUSD: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
  // Redemption must go through the adapter matching the market's `negRisk`
  // flag. The addresses in the ctf-exchange-v2 README are an older
  // deployment; the docs addresses are the ones carrying live redemptions.
  ctfCollateralAdapter: "0xAdA100Db00Ca00073811820692005400218FcE1f",
  negRiskCtfCollateralAdapter: "0xadA2005600Dec949baf300f4C6120000bDB6eAab",
} as const;

// Source: Polymarket/ctf-exchange-v2 src/adapters/CtfCollateralAdapter.sol.
// redeemPositions ignores its first, second and fourth arguments (kept for
// IConditionalTokens compatibility) and redeems the caller's full YES and NO
// balances, paying the winning side out in pUSD.
export const collateralAdapterAbi = parseAbi([
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
  "function splitPosition(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)",
  "function paused(address asset) view returns (bool)",
  "function USDCE() view returns (address)",
  "function COLLATERAL_TOKEN() view returns (address)",
  "function CONDITIONAL_TOKENS() view returns (address)",
]);

// Source: gnosis/conditional-tokens-contracts contracts/ConditionalTokens.sol.
export const conditionalTokensAbi = parseAbi([
  "event ConditionResolution(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint256 outcomeSlotCount, uint256[] payoutNumerators)",
  "event PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)",
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function getOutcomeSlotCount(bytes32 conditionId) view returns (uint256)",
  "function balanceOf(address owner, uint256 id) view returns (uint256)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) view returns (bytes32)",
  "function getPositionId(address collateralToken, bytes32 collectionId) pure returns (uint256)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;
export const BINARY_PARTITION = [1n, 2n] as const;

export function adapterFor(negRisk: boolean) {
  return negRisk ? POLYMARKET.negRiskCtfCollateralAdapter : POLYMARKET.ctfCollateralAdapter;
}
