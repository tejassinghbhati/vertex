import { decodeEventLog, type PublicClient } from "viem";
import { POLYMARKET, conditionalTokensAbi } from "../polymarket/contracts.js";

/**
 * Reads back how much a redemption actually paid, from the chain.
 *
 * The workflow's own output says a transaction succeeded; it does not say what
 * it was worth. `PayoutRedemption` carries the payout in collateral base units,
 * so the audit trail can state the amount from the receipt rather than from
 * anything KeeperHub or this tool claims.
 *
 * The adapter is the `redeemer` on that event, because it redeems on the
 * caller's behalf, so the payout is matched by condition id rather than by
 * sender. Returns null when the transaction contains no redemption.
 */
export async function redeemedPayout(
  client: PublicClient,
  txHash: `0x${string}`,
  conditionId?: `0x${string}`,
): Promise<{ payoutBaseUnits: bigint; conditionId: `0x${string}` } | null> {
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") return null;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== POLYMARKET.conditionalTokens.toLowerCase()) continue;
    let decoded;
    try {
      decoded = decodeEventLog({ abi: conditionalTokensAbi, data: log.data, topics: log.topics });
    } catch {
      // Any other CTF event in the same transaction, for example the burn.
      continue;
    }
    if (decoded.eventName !== "PayoutRedemption") continue;

    const args = decoded.args as unknown as { conditionId: `0x${string}`; payout: bigint };
    if (conditionId && args.conditionId.toLowerCase() !== conditionId.toLowerCase()) continue;
    return { payoutBaseUnits: args.payout, conditionId: args.conditionId };
  }

  return null;
}
