// Token Radar model (radar-2). One sealed DefiLlama snapshot goes in; one ranked board comes out.
//
// Coverage: every slug on the snapshot's watchlist is always on the board (that list is the floor,
// never a ceiling), and the board also carries the largest pre-token protocols below the watchlist
// floor — the early rows are the reason a radar exists. A protocol counts as pre-token when the
// snapshot records no token for it: no market cap, no CoinGecko id, no symbol. Protocols that
// already trade are never ranked; they are set aside and shown at the market's own values.
//
// Pricing: a pre-token protocol's implied value starts from its TVL times a base multiple, and the
// multiple is not a hand-picked constant. It is the market's own pricing of comparable protocols,
// read from this same snapshot: for the protocol's category, take every protocol that already has
// a token, compute market cap / TVL for each, and use the median — shrunk toward the global median
// by sample size, so a category priced by two peers borrows most of its level from the whole
// market, and a category with no tokenised peer is priced at the global median outright. On top of
// the base, seven-day TVL growth scales the value within fixed clamps, and a maturity factor pays
// more for protocols that have run longer with no token. One function scores every row; no
// protocol's name is ever special-cased.

/** One protocol exactly as the sealed snapshot carries it: ten fields, no more. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document: its date, its source line, the watchlist floor, and the protocols. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The growth and maturity constants of the model, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label, named by the dashboard and quoted by the rules. */
export const MODEL_VERSION = 'radar-2';

/** Shrinkage weight: a category's median counts n peers against this many global medians. */
export const PEER_SHRINKAGE = 4;

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the dashboard's live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One step of a farm plan: the action itself, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json, the ranked board the scorer reads. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact copy of a board row, with the multiples it recomputes from. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A protocol that already trades: the board shows the market's value for it, never a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model that produced them. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Raised when the snapshot is not a document this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Round to four decimals, the precision every published multiplier carries. */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** A value that is a finite number, or the fallback when it is anything else. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from the listing date to the snapshot date; null when either is unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** Parse and validate the sealed snapshot; anything malformed is a SnapshotError. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('the snapshot is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new SnapshotError('the snapshot is not an object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || typeof doc.source !== 'string') {
    throw new SnapshotError('the snapshot lacks its as_of date or source line');
  }
  if (typeof doc.floor_usd !== 'number' || !Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new SnapshotError('the snapshot lacks its floor, protocols or watchlist');
  }
  const protocols: SnapshotProtocol[] = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new SnapshotError(`protocol ${i} lacks a slug, name or TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  const watchlist = doc.watchlist.filter((s): s is string => typeof s === 'string');
  return { as_of: doc.as_of, source: doc.source, floor_usd: doc.floor_usd, protocols, watchlist };
}

/** The median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Peer pricing: the base multiple of every category, and the global median behind them. */
export interface PeerMultiples {
  global: number;
  byCategory: Map<string, number>;
  peers: Map<string, number>;
}

/**
 * Read the market's own pricing out of the snapshot. Every protocol that already has a token
 * contributes its market cap / TVL to its category; each category's multiple is its median ratio
 * shrunk toward the global median with weight PEER_SHRINKAGE. Ratios at or above 100 are not
 * pricing evidence (they are data artefacts) and are left out.
 */
export function peerMultiples(snapshot: Snapshot): PeerMultiples {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!(ratio > 0) || ratio >= 100) continue;
    all.push(ratio);
    const key = p.category ?? '';
    const bucket = ratios.get(key);
    if (bucket === undefined) ratios.set(key, [ratio]);
    else bucket.push(ratio);
  }
  const globalRaw = all.length > 0 ? median(all) : MODEL.base_multiple;
  const byCategory = new Map<string, number>();
  const peers = new Map<string, number>();
  for (const [key, list] of ratios) {
    peers.set(key, list.length);
    byCategory.set(key, round4((list.length * median(list) + PEER_SHRINKAGE * globalRaw) / (list.length + PEER_SHRINKAGE)));
  }
  return { global: round4(globalRaw), byCategory, peers };
}

/** The multiple one protocol is priced with: its category's, or the global median when it has none. */
export function multipleFor(peers: PeerMultiples, category: string | null): number {
  return peers.byCategory.get(category ?? '') ?? peers.global;
}

/** The implied value of one protocol, with every factor that produced it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  baseMultiple: number = model.base_multiple,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * baseMultiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** Pre-token means the snapshot records no token: no market cap, no CoinGecko id, no symbol. */
function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Rankable means pre-token and a launch candidate in its own right: no version-suffixed names
 * (a V2 is a successor product, not a first launch) and no centralised exchanges, whose "token"
 * would be an exchange listing story rather than a protocol launch. Bridges, staking and
 * restaking protocols stay in: they launch tokens of their own all the time.
 */
function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (p.category === 'CEX') return false;
  return true;
}

/** The chain a farm plan names first: the protocol's first listed chain, or Ethereum when none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
}

/** The capital a farm position needs, scaled to the protocol's own size and capped for sanity. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 500_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  if (p.tvl_usd >= 5_000_000) return 50;
  return 25;
}

/** How long a position should be held, longer for younger protocols that need the track record. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 730) return 30;
  return 21;
}

/** The one action at the heart of the plan, in the words of the protocol's own category. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('vault')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  }
  if (c.includes('lending') || c.includes('collateral')) {
    return `Supply $${capital} of collateral to ${name} on ${chain} and borrow a small amount against it.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  }
  if (c.includes('bridge') || c.includes('chain')) {
    return `Bridge $${capital} to ${chain} through ${name} and make one transfer back a week later.`;
  }
  if (c.includes('cdp') || c.includes('stablecoin')) {
    return `Deposit $${capital} of collateral with ${name} on ${chain} and mint a small amount of its stablecoin.`;
  }
  if (c.includes('staking') || c.includes('restaking')) {
    return `Stake $${capital} through ${name} on ${chain} and hold the receipt token in the same wallet.`;
  }
  if (c.includes('rwa')) {
    return `Buy $${capital} of a ${name} tokenised asset on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('payments')) {
    return `Route a $${capital} payment through ${name} on ${chain} so the wallet has real payment history.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold.`;
  }
  return `Deposit $${capital} into ${name} on ${chain} through its own interface and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived only from the
 * protocol's category, chains, TVL and age — the same derivation for every row.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** One farm step as the single board.json string the gate reads: text, then cost, then time. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The ranked board: watchlist first by construction, early rows by TVL, all rows by implied value. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const peers = peerMultiples(snapshot);
  const scored = [...chosen.values()].map((p) => {
    const multiple = multipleFor(peers, p.category);
    const v = impliedValue(p, snapshot.as_of, model, multiple);
    return { p, multiple, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: s.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live set: protocols that already trade, biggest market cap first, shown at market values. */
function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row in the dashboard's compact shape. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** The board plus everything the dashboard renders, in one object. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: { ...model, base_multiple: peerMultiples(snapshot).global },
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The data.js the dashboard loads: the whole radar as one window global. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/**
 * The gate's own questions about a board, asked before anything is written: full watchlist
 * coverage, ranks 1..N with no gaps, implied value never rising down the board, a ranking that
 * actually ranks, and a usable farm plan on every row. Returns the first problem, or null.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}
