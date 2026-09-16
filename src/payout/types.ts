import type { WorkflowNode } from "../keeperhub/client.js";

/**
 * A payout is the contract call that moves value once a decision is settled.
 * It is one of the two swappable halves of this integration: replacing
 * Polymarket with another live project means writing another module that
 * satisfies this interface, and changing nothing else.
 *
 * The contract: `node()` returns a single KeeperHub write-contract node whose
 * every argument is a literal. Nothing is templated, so the node that a human
 * reviews and the dry run checks is byte-for-byte the node that executes.
 */
export type Payout = {
  /** Stable id used for the node id and in the review output. */
  readonly kind: string;
  /** One line a reviewer can check against the chain, e.g. the market and the adapter. */
  describe(): string;
  /** The literal write node. */
  node(nodeId: string): WorkflowNode;
  /** Where the value lands and in which token, for the review output. */
  readonly settlement: { chainId: number; token: string; recipient: string };
};
