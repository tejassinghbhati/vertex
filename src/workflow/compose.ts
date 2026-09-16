import { createHash } from "node:crypto";
import type { WorkflowDefinition } from "../keeperhub/client.js";
import { edge } from "../keeperhub/nodes.js";
import type { Payout } from "../payout/types.js";
import type { ResolutionSource } from "../resolution/types.js";

const PAYOUT_NODE_ID = "payout";

/**
 * Joins the two swappable halves into one workflow: the resolution source
 * supplies the trigger and the gate, the payout supplies the single write.
 * This function is the only place that knows both exist.
 */
export function compose(params: {
  name: string;
  resolution: ResolutionSource;
  payout: Payout;
}): WorkflowDefinition {
  const graph = params.resolution.build();
  const payoutNode = params.payout.node(PAYOUT_NODE_ID);

  return {
    name: params.name,
    description: [
      `When: ${params.resolution.describe()}`,
      `Then: ${params.payout.describe()}`,
      `Authored by ${params.resolution.kind} + ${params.payout.kind}.`,
    ].join(" | "),
    nodes: [...graph.nodes, payoutNode],
    edges: [...graph.edges, edge(graph.exit.nodeId, PAYOUT_NODE_ID, graph.exit.handle)],
  };
}

/**
 * A stable fingerprint of the workflow a human reviewed.
 *
 * Object keys are sorted so that the hash tracks meaning rather than
 * serialization order. The deploy path refuses to create a workflow whose hash
 * differs from the reviewed one, which is what makes "the exact reviewed
 * workflow executes" checkable rather than asserted.
 */
export function workflowHash(def: WorkflowDefinition): string {
  return createHash("sha256").update(canonicalize(def)).digest("hex");
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortDeep(v)]),
    );
  }
  return value;
}
