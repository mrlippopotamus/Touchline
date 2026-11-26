const API = "https://api.playmfl.com";
const ASSETS = "https://d13e14gtps4iwl.cloudfront.net";
const PLAYER_PAGE_SIZE = 500;
const CLUB_MATCH_LIMIT = 50;
const CLUB_HISTORY_PAGE_SIZE = 100;
export const MATCH_PAGE_SIZE = 25;

// A public example used in the mfl-data repository's dataset documentation.
export const SAMPLE_WALLET = "0x55e8be2966409ed4";

export const ATTRIBUTES = [
  { key: "pace", title: "Pace", short: "PAC" },
  { key: "shooting", title: "Shooting", short: "SHO" },
  { key: "passing", title: "Passing", short: "PAS" },
  { key: "dribbling", title: "Dribbling", short: "DRI" },
  { key: "defense", title: "Defence", short: "DEF" },
  { key: "physical", title: "Physical", short: "PHY" },
  { key: "goalkeeping", title: "Goalkeeping", short: "GK" },
];

const progressionFields = ["overall", ...ATTRIBUTES.map(attribute => attribute.key)];
const dayMs = 24 * 60 * 60 * 1000;

export const POSITIONS = ["GK", "RB", "RWB", "CB", "LB", "LWB", "CDM", "RM", "CM", "LM", "CAM", "RW", "CF", "LW", "ST"];

export function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normaliseAddress(value) {
  const address = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{16}$/.test(address) ? "0x" + address : "";
}

function recordId(value) {
  const id = String(value ?? "");
  return /^[0-9]+$/.test(id) ? id : "";
}

export function readable(value) {
  return String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function list(payload, ...keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  throw new Error("MFL returned an unexpected response.");
}

export function toPlayer(raw) {
  const meta = raw?.metadata || {};
  const id = recordId(raw?.id ?? meta.id);
  if (!id) return null;
  return {
    id,
    name: [meta.firstName, meta.lastName].filter(Boolean).join(" ") || "Player " + id,
    overall: number(meta.overall),
    age: number(meta.age),
    height: number(meta.height),
    foot: readable(meta.preferredFoot),
    nationality: readable(meta.nationalities?.[0] ?? meta.nationality),
    positions: Array.isArray(meta.positions) ? meta.positions.filter(position => typeof position === "string") : [],
    photo: ASSETS + "/players/v2/" + id + "/photo.webp",
    attributes: Object.fromEntries(ATTRIBUTES.map(({ key }) => [key, number(meta[key])])),
    retirement: number(meta.retirementYears),
    club: raw.activeContract?.club ? toClub(raw.activeContract.club) : null,
    contractCreatedAt: dateValue(raw.activeContract?.createdDateTime),
  };
}

function toClub(raw) {
  const club = raw?.club || raw;
  const id = recordId(club?.id);
  if (!id) return null;
  const version = String(club.logoVersion || "");
  const accent = [club.secondaryColor, club.mainColor].find(colour => /^#[\da-f]{6}$/i.test(colour || "") && colour !== "#000000");
  const squads = Array.isArray(club.squads) ? club.squads : [];
  return {
    id,
    name: club.name || "Club " + id,
    division: number(club.division),
    type: club.type === "ARENA" ? "Arena" : "Pro",
    city: club.city || "",
    country: readable(club.country),
    count: number(raw.playersCount),
    rank: raw.leagueRank ? String(raw.leagueRank) : "",
    accent: accent || "#a2c66c",
    logo: version ? ASSETS + "/u/clubs/" + id + "/logo.webp?v=" + encodeURIComponent(version) : "",
    squadIds: [...new Set([club.squad, ...squads].map(squad => recordId(squad?.id)).filter(Boolean))],
  };
}

function toMatch(raw) {
  const id = recordId(raw?.id);
  if (!id || !raw?.match || !raw?.stats) return null;
  const match = raw.match;
  const home = String(raw.side).toLowerCase() === "home";
  return {
    id,
    date: dateValue(match.startDate ?? match.createdDateTime),
    opponent: home ? match.awayTeamName || match.awaySquad?.club?.name : match.homeTeamName || match.homeSquad?.club?.name,
    team: home ? match.homeTeamName : match.awayTeamName,
    goalsFor: number(home ? match.homeScore : match.awayScore),
    goalsAgainst: number(home ? match.awayScore : match.homeScore),
    competition: match.competition?.name || readable(match.type),
    season: number(match.competition?.season),
    position: raw.stats.position || "",
    minutes: number(raw.stats.time) === null ? null : Math.round(number(raw.stats.time) / 60),
    rating: number(raw.stats.rating),
    goals: number(raw.stats.goals),
    assists: number(raw.stats.assists),
  };
}

function dateValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber < 1e12 ? asNumber * 1000 : asNumber;
  const asDate = Date.parse(value);
  return Number.isNaN(asDate) ? null : asDate;
}

let retryAt = 0;

async function get(path, params) {
  if (Date.now() < retryAt) throw new Error("MFL is limiting requests. Try again shortly.");
  const query = params ? "?" + new URLSearchParams(params) : "";
  let response;
  try {
    response = await fetch(API + path + query, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(18000),
      credentials: "omit",
    });
  } catch (error) {
    if (error.name === "TimeoutError") throw new Error("MFL took too long to respond. Try again.");
    throw new Error("Unable to reach MFL. Check your connection and try again.");
  }
  if (response.status === 429) {
    const wait = Number(response.headers.get("Retry-After")) || 30;
    retryAt = Date.now() + 1000 * Math.max(1, wait);
    throw new Error("MFL is limiting requests. Try again shortly.");
  }
  if (!response.ok) {
    const message = response.status === 404 ? "MFL could not find this record." : "MFL returned HTTP " + response.status + ". Try again.";
    throw Object.assign(new Error(message), { status: response.status });
  }
  return response.json();
}

export async function walletPlayers(wallet) {
  const players = new Map();
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const params = { ownerWalletAddress: wallet, limit: PLAYER_PAGE_SIZE };
    if (cursor) params.beforePlayerId = cursor;
    const batch = list(await get("/players", params), "players", "data", "items", "value");
    const ids = [];
    for (const raw of batch) {
      const player = toPlayer(raw);
      if (player) {
        ids.push(Number(player.id));
        players.set(player.id, player);
      }
    }
    if (batch.length < PLAYER_PAGE_SIZE) return [...players.values()];
    const nextCursor = ids.length ? String(Math.min(...ids)) : "";
    if (!nextCursor || (cursor && Number(nextCursor) >= Number(cursor))) {
      throw new Error("The MFL player list stopped advancing. Try again.");
    }
    cursor = nextCursor;
  }
  throw new Error("The wallet exceeded MFL's pagination limit for this request.");
}

export async function walletClubs(wallet) {
  const data = await get("/clubs", { walletAddress: wallet, withLeagueRank: true, withNextMatch: true, withPlayersCount: true, withLastMatches: true });
  const clubs = list(data, "clubs", "items", "data", "value");
  const owned = clubs.filter(raw => !raw?.club || raw.title === "MFL_OWNER");
  return [...new Map(owned.map(toClub).filter(Boolean).map(club => [club.id, club])).values()];
}

export async function player(id) {
  const data = await get("/players/" + id);
  const profile = toPlayer(data?.player ?? data?.data ?? data);
  if (!profile) throw new Error("MFL returned an incomplete player profile.");
  return profile;
}

export async function club(id) {
  const data = await get("/clubs/" + id);
  const profile = toClub(data?.club ?? data?.data ?? data);
  if (!profile) throw new Error("MFL returned an incomplete club profile.");
  return profile;
}

export async function clubPlayers(id) {
  return list(await get("/clubs/" + id + "/players"), "players", "data", "value").map(toPlayer).filter(Boolean);
}

export async function clubTrainingCoaches(id) {
  const data = await get("/clubs/" + id + "/training/facilities");
  if (!Array.isArray(data?.coachContracts) || !["SET_UP", "NOT_SET_UP", "NOT_APPLICABLE"].includes(data.setupStatus)) {
    throw new Error("MFL returned an incomplete training setup.");
  }
  const coaches = new Map();
  for (const contract of data.coachContracts) {
    if (contract?.status !== "ACTIVE") continue;
    const coach = contract.coach;
    const coachId = recordId(coach?.id);
    if (!coachId || typeof coach.name !== "string" || !coach.name || !["BASIC", "STANDARD", "ELITE"].includes(coach.tier)) {
      throw new Error("MFL returned an incomplete coach profile.");
    }
    coaches.set(coachId, {
      name: coach.name,
      tier: coach.tier,
      specialties: [coach.primaryAttribute, coach.secondaryAttribute].filter(Boolean).map(attribute => String(attribute).toLowerCase()),
      primaryBonus: coach.xpBonusByStatPrimary ?? {},
      dualBonus: coach.xpBonusByStatDual ?? {},
      globalBonus: number(coach.xpBonusGlobal),
    });
  }
  return { status: data.setupStatus, coaches: [...coaches.values()] };
}

export async function clubProgressionHistories(id) {
  const players = await clubPlayers(id);
  const histories = [];
  const concurrency = 4;
  for (let index = 0; index < players.length; index += concurrency) {
    const batch = players.slice(index, index + concurrency);
    const results = await Promise.allSettled(batch.map(person => experienceHistory(person.id)));
    for (const [offset, result] of results.entries()) {
      histories.push({ person: batch[offset], events: result.value ?? [] });
    }
  }
  return histories;
}

function clubMatchSide(raw, side) {
  const club = toClub(raw[side + "Squad"]?.club);
  return {
    club,
    name: raw[side + "TeamName"] || club?.name || (side === "home" ? "Home team" : "Away team"),
    score: number(raw[side + "Score"]),
  };
}

function toClubMatch(raw) {
  const id = recordId(raw?.id);
  if (!id) return null;
  return {
    id,
    date: dateValue(raw.startDate),
    status: String(raw.status || ""),
    competition: raw.competition?.name || readable(raw.type),
    home: clubMatchSide(raw, "home"),
    away: clubMatchSide(raw, "away"),
  };
}

export async function clubMatches(squadIds, upcoming) {
  const filters = upcoming ? { upcoming: true, live: true } : { past: true };
  const batches = await Promise.all(squadIds.map(async squadId =>
    list(await get("/matches", { squadId, ...filters, limit: CLUB_MATCH_LIMIT }), "matches", "data", "value")
  ));
  const matches = new Map();
  for (const raw of batches.flat()) {
    const match = toClubMatch(raw);
    if (match && !matches.has(match.id)) matches.set(match.id, match);
  }
  return [...matches.values()].sort((a, b) => upcoming
    ? (a.date ?? Infinity) - (b.date ?? Infinity)
    : (b.date ?? 0) - (a.date ?? 0));
}

export async function pastClubMatchPage(squadId, beforeMatchId) {
  const params = { squadId, past: true, onlyCompetitions: true, limit: CLUB_HISTORY_PAGE_SIZE };
  if (beforeMatchId) params.beforeMatchId = beforeMatchId;
  const rows = list(await get("/matches", params), "matches", "data", "value");
  const next = rows.length === CLUB_HISTORY_PAGE_SIZE ? recordId(rows.at(-1)?.id) : "";
  return { matches: rows.map(toClubMatch).filter(Boolean), next };
}

function startingOverall(formation, players) {
  const positions = Array.isArray(formation?.positions) ? formation.positions : [];
  const starters = new Map();
  for (const slot of positions) {
    if (!Number.isInteger(slot?.index) || slot.index < 0 || slot.index >= 11) continue;
    // The second entry of each match snapshot is OVR at kickoff. Formation metadata can reflect later upgrades.
    const snapshot = players?.[recordId(slot.player?.id)];
    const ovr = Array.isArray(snapshot) ? number(snapshot[1]) : null;
    if (ovr !== null && ovr > 0 && ovr <= 99) starters.set(slot.index, ovr);
  }
  return starters.size === 11 ? [...starters.values()].reduce((total, ovr) => total + ovr, 0) : null;
}

function reportTotal(rows, field) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const values = rows.map(row => number(row?.[field]));
  return values.includes(null) ? null : values.reduce((total, value) => total + value, 0);
}

export async function clubMatchStats(id) {
  const path = "/matches/" + id;
  const [detail, report] = await Promise.allSettled([get(path, { withFormations: true }), get(path + "/report")]);
  const match = detail.value?.match ?? detail.value;
  const homeRows = report.value?.home?.playersStats;
  const awayRows = report.value?.away?.playersStats;
  const homePasses = reportTotal(homeRows, "passes");
  const awayPasses = reportTotal(awayRows, "passes");
  const totalPasses = (homePasses ?? 0) + (awayPasses ?? 0);
  const homePossession = homePasses !== null && awayPasses !== null && totalPasses > 0
    ? Math.round(homePasses * 100 / totalPasses) : null;
  const teamStats = (side, rows, possession) => ({
    overall: startingOverall(match?.[side + "Formation"], match?.players),
    formation: match?.[side + "Formation"]?.type ?? "",
    xG: reportTotal(rows, "xG"),
    shots: reportTotal(rows, "shots"),
    shotsOnTarget: reportTotal(rows, "shotsOnTarget"),
    possession,
  });
  return {
    home: teamStats("home", homeRows, homePossession),
    away: teamStats("away", awayRows, homePossession === null ? null : 100 - homePossession),
    retryable: [detail, report].some(entry => entry.status === "rejected" && entry.reason?.status !== 404),
  };
}

export async function walletProgression(address, interval = "ALL") {
  const data = await get("/players/progressions", { ownerWalletAddress: address, interval });
  if (data === null && interval === "24H") return {};
  if (!data || Array.isArray(data) || typeof data !== "object") throw new Error("MFL returned an incomplete progression summary.");
  return data;
}

export async function experienceHistory(id) {
  const data = await get("/players/" + id + "/experiences/history");
  return list(data, "history", "experiences", "data", "value")
    .map(event => ({
      date: dateValue(event?.date ?? event?.createdDateTime),
      reason: String(event?.reasonType || "").toUpperCase(),
      values: event?.values && typeof event.values === "object" ? event.values : {},
    }))
    .filter(event => event.date !== null)
    .sort((a, b) => a.date - b.date);
}

function* positiveRatingChanges(events, start, end) {
  const ratings = {};
  for (const event of events) {
    if (event.date > end) break;
    const inWindow = event.date >= start && event.reason !== "INITIAL";
    for (const field of progressionFields) {
      const value = number(event.values[field]);
      if (value === null) continue;
      const previous = ratings[field];
      ratings[field] = value;
      if (inWindow && previous !== undefined && value > previous) {
        yield { reason: event.reason, field, gain: value - previous };
      }
    }
  }
}

export function recentProgressionSources(events, changes, checkedAt) {
  const sources = new Map();
  for (const { reason, field } of positiveRatingChanges(events, checkedAt - dayMs, checkedAt)) {
    if (!(number(changes[field]) > 0)) continue;
    if (!sources.has(reason)) sources.set(reason, new Set());
    sources.get(reason).add(field);
  }
  return [...sources].map(([reason, fields]) => ({ reason, fields: [...fields] }));
}

export function clubPlayerGains(events, contractCreatedAt, days, checkedAt, source) {
  const initial = events.find(event => event.reason === "INITIAL" && event.date <= checkedAt);
  if (!initial) return null;
  const start = Math.max(checkedAt - days * dayMs, contractCreatedAt ?? 0);
  const gains = Object.fromEntries(progressionFields.filter(key => number(initial.values[key]) !== null).map(key => [key, 0]));
  for (const { reason, field, gain } of positiveRatingChanges(events, start, checkedAt)) {
    if (!source || reason === source) gains[field] = (gains[field] ?? 0) + gain;
  }
  return gains;
}

export async function matchPage(id, cursor) {
  const data = await get("/players/" + id + "/matches/stats", { limit: MATCH_PAGE_SIZE, ...(cursor ? { beforeId: cursor } : {}) });
  const raw = list(data, "matches", "stats", "data", "value");
  const nextCursor = raw.length === MATCH_PAGE_SIZE ? recordId(raw.at(-1)?.id) : "";
  return { rows: raw.map(toMatch).filter(Boolean), cursor: nextCursor === cursor ? "" : nextCursor };
}
