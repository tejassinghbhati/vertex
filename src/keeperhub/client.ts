// Thin REST client for the KeeperHub endpoints this project uses.
// Reference: https://docs.keeperhub.com/api (workflows, executions, user).
// The API key is read once and only ever placed in the Authorization header;
// nothing in this file logs requests or headers.

export type WorkflowNode = {
  id: string;
  type: "trigger" | "action";
  data: { label: string; description?: string; config: Record<string, unknown> };
};

export type WorkflowEdge = { id: string; source: string; target: string; sourceHandle?: "true" | "false" };

export type WorkflowDefinition = {
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type SimulationResult = {
  simulatedNodeCount: number;
  skippedNodeCount: number;
  warnings?: { code: string; message: string; nodeId: string; parameterPath: string }[];
};

export type TransactionReceipt = {
  hash: string;
  nodeId: string;
  nodeName?: string;
  chainId?: number;
  verified?: boolean;
  receiptStatus?: string;
};

export type ExecutionReceipt = {
  executionId: string;
  status: string;
  completed: boolean;
  transactionHashes: TransactionReceipt[];
  error: string | null;
};

export class KeeperHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "KeeperHubError";
  }
}

const MAX_ATTEMPTS = 5;

export class KeeperHubClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://app.keeperhub.com",
  ) {
    if (!apiKey.startsWith("kh_")) {
      // Webhook (wfb_) keys cannot call these endpoints.
      throw new Error("KEEPERHUB_API_KEY must be an organization key (kh_ prefix)");
    }
  }

  static fromEnv(): KeeperHubClient {
    const key = process.env.KEEPERHUB_API_KEY;
    if (!key) throw new Error("KEEPERHUB_API_KEY is not set (see .env.example)");
    return new KeeperHubClient(key, process.env.KEEPERHUB_BASE_URL);
  }

  /** 200 means the key is valid and scoped to an organization. */
  async probe(): Promise<void> {
    await this.request("GET", "/api/keys");
  }

  /** The organization's Turnkey wallet: the address that signs and holds positions. */
  async walletAddress(): Promise<`0x${string}`> {
    const user = await this.request<{ walletAddress?: string }>("GET", "/api/user");
    if (!user.walletAddress) throw new Error("Organization has no wallet yet; open app.keeperhub.com once to create it");
    return user.walletAddress as `0x${string}`;
  }

  createWorkflow(def: WorkflowDefinition, enabled = false) {
    return this.request<{ id: string }>("POST", "/api/workflows/create", { ...def, enabled });
  }

  getWorkflow(id: string) {
    return this.request<WorkflowDefinition & { id: string; enabled?: boolean }>("GET", `/api/workflows/${id}`);
  }

  setEnabled(id: string, enabled: boolean) {
    return this.request("PATCH", `/api/workflows/${id}`, { enabled });
  }

  /** Advisory preflight: simulates every web3 write node against current state. Nothing is broadcast. */
  simulateWorkflow(id: string) {
    return this.request<SimulationResult>("POST", `/api/workflows/${id}/simulate`);
  }

  executeWorkflow(id: string, idempotencyKey: string) {
    return this.request<{ executionId: string; status: string }>(
      "POST",
      `/api/workflows/${id}/execute`,
      { input: {} },
      { "Idempotency-Key": idempotencyKey },
    );
  }

  /** Blocks server-side until the run is terminal, re-calling while the wait window elapses. */
  async waitForExecution(executionId: string, deadlineMs = 10 * 60_000): Promise<ExecutionReceipt> {
    const stopAt = Date.now() + deadlineMs;
    for (;;) {
      const receipt = await this.request<ExecutionReceipt>(
        "GET",
        `/api/workflows/executions/${executionId}/wait?timeoutMs=60000`,
      );
      if (receipt.completed) return receipt;
      if (Date.now() > stopAt) throw new Error(`Execution ${executionId} still ${receipt.status} after ${deadlineMs}ms`);
    }
  }

  executionLogs(executionId: string) {
    return this.request<{ execution: unknown; logs: unknown[] }>("GET", `/api/workflows/executions/${executionId}/logs`);
  }

  listExecutions(workflowId: string) {
    return this.request<unknown[]>("GET", `/api/workflows/${workflowId}/executions`);
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "KeeperHub-Version": "1",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const deprecation = res.headers.get("Deprecation");
      if (deprecation) console.warn(`[keeperhub] ${method} ${path} is deprecated (${res.headers.get("Link") ?? "no link"})`);

      // Rate limits and cold starts are the two transient failures the docs name.
      const transient = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
      if (transient && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        const waitS = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : Math.min(2 ** attempt, 30);
        await new Promise((r) => setTimeout(r, waitS * 1000));
        continue;
      }

      const text = await res.text();
      const parsed = text ? safeJson(text) : undefined;
      if (!res.ok) throw new KeeperHubError(`${method} ${path} failed with ${res.status}`, res.status, parsed);
      return parsed as T;
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
