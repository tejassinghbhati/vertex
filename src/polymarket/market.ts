// Market metadata comes from Polymarket's Gamma API. Only two fields decide
// how the workflow is built: the condition id, and whether the market is
// neg-risk (which picks the collateral adapter). Everything else is for the
// human reading the review output.

const GAMMA = "https://gamma-api.polymarket.com";

export type Market = {
  conditionId: `0x${string}`;
  question: string;
  slug: string;
  negRisk: boolean;
  closed: boolean;
  endDate?: string;
  umaResolutionStatus?: string;
  outcomes?: string[];
  outcomePrices?: string[];
  clobTokenIds?: string[];
};

type GammaMarket = {
  conditionId?: string;
  question?: string;
  slug?: string;
  negRisk?: boolean;
  closed?: boolean;
  endDate?: string;
  umaResolutionStatus?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  clobTokenIds?: string | string[];
};

export async function fetchMarketByConditionId(conditionId: string): Promise<Market> {
  const markets = await gamma<GammaMarket[]>(`/markets?condition_ids=${conditionId}&closed=true`);
  const open = markets.length ? markets : await gamma<GammaMarket[]>(`/markets?condition_ids=${conditionId}`);
  const found = open.find((m) => m.conditionId?.toLowerCase() === conditionId.toLowerCase());
  if (!found) throw new Error(`No Polymarket market with condition id ${conditionId}`);
  return normalize(found);
}

export async function fetchMarketBySlug(slug: string): Promise<Market> {
  return normalize(await gamma<GammaMarket>(`/markets/slug/${encodeURIComponent(slug)}`));
}

async function gamma<T>(path: string): Promise<T> {
  const res = await fetch(`${GAMMA}${path}`);
  if (!res.ok) throw new Error(`Gamma ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

function normalize(m: GammaMarket): Market {
  if (!m.conditionId) throw new Error("Gamma market has no conditionId");
  return {
    conditionId: m.conditionId as `0x${string}`,
    question: m.question ?? "(untitled market)",
    slug: m.slug ?? "",
    negRisk: m.negRisk === true,
    closed: m.closed === true,
    endDate: m.endDate,
    umaResolutionStatus: m.umaResolutionStatus,
    outcomes: jsonArray(m.outcomes),
    outcomePrices: jsonArray(m.outcomePrices),
    clobTokenIds: jsonArray(m.clobTokenIds),
  };
}

/** Gamma returns these as JSON-encoded strings on some routes and arrays on others. */
function jsonArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : undefined;
  } catch {
    return undefined;
  }
}
