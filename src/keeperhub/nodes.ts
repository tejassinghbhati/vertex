import type { Abi } from "viem";
import type { WorkflowEdge, WorkflowNode } from "./client.js";

// KeeperHub's strict validator rejects the natural-language field names, and
// the runtime never translates the deprecated ones. The helpers here are the
// only place that spells these keys, so a rename is a one-line change:
//   Function          -> abiFunction   (not `function` / `functionName`)
//   Function Arguments-> functionArgs  (JSON-encoded array STRING)
//   Contract ABI      -> abi           (JSON-encoded STRING)
// Reference: https://docs.keeperhub.com/plugins/web3#direct-api-field-names

/** KeeperHub takes an ABI as a JSON string, never as an array. */
export function encodeAbi(abi: Abi): string {
  return JSON.stringify(abi);
}

/** functionArgs is a JSON-encoded positional array; bigints must be decimal strings. */
export function encodeArgs(args: readonly unknown[]): string {
  return JSON.stringify(args, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
}

export function scheduleTrigger(id: string, label: string, cron: string): WorkflowNode {
  return { id, type: "trigger", data: { label, config: { triggerType: "Schedule", scheduleCron: cron } } };
}

export function eventTrigger(
  id: string,
  label: string,
  params: { chainId: number; contractAddress: string; abi: Abi; eventName: string },
): WorkflowNode {
  return {
    id,
    type: "trigger",
    data: {
      label,
      config: {
        triggerType: "Event",
        network: String(params.chainId),
        contractAddress: params.contractAddress,
        contractABI: encodeAbi(params.abi),
        eventName: params.eventName,
      },
    },
  };
}

export function readContract(
  id: string,
  label: string,
  params: { chainId: number; contractAddress: string; abi: Abi; abiFunction: string; args: readonly unknown[]; description?: string },
): WorkflowNode {
  return {
    id,
    type: "action",
    data: {
      label,
      description: params.description,
      config: {
        actionType: "web3/read-contract",
        network: String(params.chainId),
        contractAddress: params.contractAddress,
        abi: encodeAbi(params.abi),
        abiFunction: params.abiFunction,
        functionArgs: encodeArgs(params.args),
      },
    },
  };
}

export function writeContract(
  id: string,
  label: string,
  params: {
    chainId: number;
    contractAddress: string;
    abi: Abi;
    abiFunction: string;
    args: readonly unknown[];
    description?: string;
    gasLimitMultiplier?: string;
  },
): WorkflowNode {
  return {
    id,
    type: "action",
    data: {
      label,
      description: params.description,
      config: {
        actionType: "web3/write-contract",
        network: String(params.chainId),
        // "default" lets org policy route the sender; the signing wallet is
        // the organization's Turnkey wallet either way.
        web3Connection: "default",
        contractAddress: params.contractAddress,
        abi: encodeAbi(params.abi),
        abiFunction: params.abiFunction,
        functionArgs: encodeArgs(params.args),
        // A failed write must fail the run: a softened failure reports
        // success with no transaction hash, which would make the audit
        // trail claim a redemption that never happened.
        failOnError: true,
        ...(params.gasLimitMultiplier ? { gasLimitMultiplier: params.gasLimitMultiplier } : {}),
      },
    },
  };
}

export type ConditionRule = {
  id: string;
  leftOperand: string;
  operator: ">" | ">=" | "<" | "<=" | "==" | "===" | "!=" | "!==";
  rightOperand: string;
};

export function condition(id: string, label: string, rules: ConditionRule[], logic: "AND" | "OR" = "AND"): WorkflowNode {
  const expression = rules.map((r) => `${r.leftOperand} ${r.operator} ${r.rightOperand}`).join(logic === "AND" ? " && " : " || ");
  return {
    id,
    type: "action",
    data: {
      label,
      config: {
        actionType: "Condition",
        condition: expression,
        conditionConfig: { group: { id: `${id}-group`, logic, rules } },
      },
    },
  };
}

/** Reference an upstream node's output in the stored template format. */
export function ref(nodeId: string, label: string, path?: string): string {
  return `{{@${nodeId}:${label}${path ? `.${path}` : ""}}}`;
}

export function edge(source: string, target: string, sourceHandle?: "true" | "false"): WorkflowEdge {
  return {
    id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ""}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  };
}
