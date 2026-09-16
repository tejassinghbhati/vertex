import { createPublicClient, http, type PublicClient } from "viem";
import { polygon } from "viem/chains";
import {
  POLYMARKET,
  ZERO_BYTES32,
  adapterFor,
  collateralAdapterAbi,
  conditionalTokensAbi,
  erc20Abi,
} from "../polymarket/contracts.js";

export type Check = { name: string; ok: boolean; detail: string };

export const USDCE_ON_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

export function polygonClient(): PublicClient {
  return createPublicClient({
    chain: polygon,
    transport: http(process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com"),
  }) as PublicClient;
}

/**
 * Checks every hardcoded address against the chain before anything is signed.
 * An address that is only as good as a docs page is not good enough: the
 * adapters must name the same CTF and collateral token this build targets.
 */
export async function verifyContracts(client: PublicClient): Promise<Check[]> {
  const checks: Check[] = [];

  for (const [name, address] of Object.entries({
    conditionalTokens: POLYMARKET.conditionalTokens,
    pUSD: POLYMARKET.pUSD,
    ctfCollateralAdapter: POLYMARKET.ctfCollateralAdapter,
    negRiskCtfCollateralAdapter: POLYMARKET.negRiskCtfCollateralAdapter,
  })) {
    const code = await client.getCode({ address: address as `0x${string}` });
    const size = code ? (code.length - 2) / 2 : 0;
    checks.push({ name: `${name} is a contract`, ok: size > 0, detail: `${address} has ${size} bytes of code` });
  }

  for (const [name, adapter] of [
    ["standard adapter", POLYMARKET.ctfCollateralAdapter],
    ["neg-risk adapter", POLYMARKET.negRiskCtfCollateralAdapter],
  ] as const) {
    const [ctf, collateral, usdce] = await Promise.all([
      client.readContract({ address: adapter, abi: collateralAdapterAbi, functionName: "CONDITIONAL_TOKENS" }),
      client.readContract({ address: adapter, abi: collateralAdapterAbi, functionName: "COLLATERAL_TOKEN" }),
      client.readContract({ address: adapter, abi: collateralAdapterAbi, functionName: "USDCE" }),
    ]);
    const paused = await client.readContract({ address: adapter, abi: collateralAdapterAbi, functionName: "paused", args: [usdce] });

    checks.push({
      name: `${name} points at the expected CTF`,
      ok: ctf.toLowerCase() === POLYMARKET.conditionalTokens.toLowerCase(),
      detail: `CONDITIONAL_TOKENS() = ${ctf}`,
    });
    checks.push({
      name: `${name} points at pUSD`,
      ok: collateral.toLowerCase() === POLYMARKET.pUSD.toLowerCase(),
      detail: `COLLATERAL_TOKEN() = ${collateral}`,
    });
    checks.push({
      name: `${name} uses the expected USDC.e`,
      ok: usdce.toLowerCase() === USDCE_ON_POLYGON.toLowerCase(),
      detail: `USDCE() = ${usdce}`,
    });
    checks.push({ name: `${name} is not paused`, ok: paused === false, detail: `paused(USDC.e) = ${paused}` });
  }

  return checks;
}

/** The ERC-1155 token ids for a binary market's two outcomes, derived on-chain. */
export async function positionIds(client: PublicClient, conditionId: `0x${string}`): Promise<[bigint, bigint]> {
  const ids = await Promise.all(
    [1n, 2n].map(async (indexSet) => {
      const collectionId = await client.readContract({
        address: POLYMARKET.conditionalTokens,
        abi: conditionalTokensAbi,
        functionName: "getCollectionId",
        args: [ZERO_BYTES32, conditionId, indexSet],
      });
      return client.readContract({
        address: POLYMARKET.conditionalTokens,
        abi: conditionalTokensAbi,
        functionName: "getPositionId",
        // Positions are collateralized in USDC.e through the legacy CTF; the
        // adapter wraps the released USDC.e into pUSD on the way out.
        args: [USDCE_ON_POLYGON, collectionId],
      });
    }),
  );
  return [ids[0], ids[1]];
}

export type MarketState = {
  resolved: boolean;
  payoutDenominator: bigint;
  outcomeSlotCount: bigint;
  balances: [bigint, bigint];
  approved: boolean;
  pusdBalance: bigint;
  checks: Check[];
};

/** Everything the redeem workflow depends on, read from the chain. */
export async function marketPreflight(
  client: PublicClient,
  params: { conditionId: `0x${string}`; negRisk: boolean; wallet: `0x${string}` },
): Promise<MarketState> {
  const adapter = adapterFor(params.negRisk);

  const [outcomeSlotCount, payoutDenominator, approved, pusdBalance] = await Promise.all([
    client.readContract({ address: POLYMARKET.conditionalTokens, abi: conditionalTokensAbi, functionName: "getOutcomeSlotCount", args: [params.conditionId] }),
    client.readContract({ address: POLYMARKET.conditionalTokens, abi: conditionalTokensAbi, functionName: "payoutDenominator", args: [params.conditionId] }),
    client.readContract({ address: POLYMARKET.conditionalTokens, abi: conditionalTokensAbi, functionName: "isApprovedForAll", args: [params.wallet, adapter] }),
    client.readContract({ address: POLYMARKET.pUSD, abi: erc20Abi, functionName: "balanceOf", args: [params.wallet] }),
  ]);

  const ids = await positionIds(client, params.conditionId);
  const balances = (await Promise.all(
    ids.map((id) =>
      client.readContract({ address: POLYMARKET.conditionalTokens, abi: conditionalTokensAbi, functionName: "balanceOf", args: [params.wallet, id] }),
    ),
  )) as [bigint, bigint];

  const resolved = payoutDenominator > 0n;
  const checks: Check[] = [
    { name: "condition is prepared", ok: outcomeSlotCount === 2n, detail: `getOutcomeSlotCount = ${outcomeSlotCount}` },
    { name: "market is resolved", ok: resolved, detail: `payoutDenominator = ${payoutDenominator}` },
    {
      name: "adapter is approved to move the outcome tokens",
      ok: approved,
      detail: approved ? `isApprovedForAll(${params.wallet}, ${adapter}) = true` : `run: cli setup-approval --negrisk ${params.negRisk}`,
    },
    {
      name: "wallet holds a position to redeem",
      ok: balances[0] > 0n || balances[1] > 0n,
      detail: `outcome balances = [${balances[0]}, ${balances[1]}] (token ids ${ids[0]}, ${ids[1]})`,
    },
  ];

  return { resolved, payoutDenominator, outcomeSlotCount, balances, approved, pusdBalance, checks };
}
