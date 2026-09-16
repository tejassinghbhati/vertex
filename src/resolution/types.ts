import type { WorkflowEdge, WorkflowNode } from "../keeperhub/client.js";

/**
 * A resolution source answers one question: has the decision been settled?
 * It is the other swappable half of this integration. Pointing the build at a
 * different live project means writing another module that satisfies this
 * interface; the payout module and the composer are untouched.
 *
 * `build()` returns the trigger plus whatever gate nodes decide that the
 * settled decision is the one this workflow is about. `exit` names the node
 * and output handle that the payout is wired to.
 */
export type ResolutionGraph = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  exit: { nodeId: string; handle?: "true" | "false" };
};

export type ResolutionSource = {
  readonly kind: string;
  /** One line a reviewer can check against the chain. */
  describe(): string;
  /** Anything a reviewer should know that the graph does not show. */
  readonly caveats?: string[];
  build(): ResolutionGraph;
};
