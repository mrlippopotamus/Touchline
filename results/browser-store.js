import {
  CLUBS, FINAL_STATUSES, LIVE_REFRESH_MS, hasMatchAnalysis, isAllowedMflCompetition, key, kickedOffAfterReset,
  legacyMatchKey, matchKey, normalizeMatch, normalizeMatchStats, normalizeScore,
} from "./matches.js";

const databaseName = "touchline-results-v1:" + new URL("../", import.meta.url).pathname;
const firstMatchDate = "2026-09-23";
const reportBatchSize = 4;
const leaseDuration = 60_000;
let opening;

function openDatabase() {
  if (!globalThis.indexedDB) throw new Error("Allow site storage in your browser to use Results.");
  opening ??= new Promise((resolve, reject) => {
    // Close older connections before a Results reset can establish a new cutoff.
    const request = indexedDB.open(databaseName, 2);
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) request.result.createObjectStore("dashboard");
    };
    request.onerror = () => reject(new Error("Touchline could not open match storage. Check your browser’s site storage settings."));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        opening = undefined;
      };
      resolve(database);
    };
  }).catch(error => {
    opening = undefined;
    throw error;
  });
  return opening;
}

async function withDashboard(change, write = false) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("dashboard", write ? "readwrite" : "readonly");
    const store = transaction.objectStore("dashboard");
    const request = store.get("results");
    let result;
    let problem;
    request.onsuccess = () => {
      const dashboard = request.result ?? { matches: [], nextId: 1, checkedAt: null, leasedUntil: 0, problem: "" };
      try {
        result = change(dashboard);
        if (write) store.put(dashboard, "results");
      } catch (error) {
        problem = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(problem ?? transaction.error ?? new Error("Touchline could not save the changes."));
  });
}

export function readMatches() {
  return withDashboard(({ matches }) => matches.filter(match => !match.hidden));
}

function syncStatus({ checkedAt, leasedUntil, problem, resetAt = null }, now) {
  const dueAt = Math.max(leasedUntil, (checkedAt ?? resetAt ?? 0) + LIVE_REFRESH_MS);
  return { checkedAt, resetAt, problem, nextCheckIn: Math.max(0, dueAt - now) };
}

export function readSyncStatus() {
  return withDashboard(dashboard => syncStatus(dashboard, Date.now()));
}

export function clearSavedMatches(expectedResetAt) {
  return withDashboard(dashboard => {
    if ((dashboard.resetAt ?? null) !== expectedResetAt) throw new Error("Another reset was completed. Reopen the confirmation to continue.");
    const now = Date.now();
    const resetAt = Math.max(now, (expectedResetAt ?? 0) + 1);
    const removed = dashboard.matches.length;
    Object.assign(dashboard, { matches: [], resetAt, checkedAt: null, leasedUntil: 0, problem: "" });
    return { ...syncStatus(dashboard, now), removed };
  }, true);
}

export function beginMflRefresh(manual = false) {
  return withDashboard(dashboard => {
    const now = Date.now();
    const status = syncStatus(dashboard, now);
    if (dashboard.leasedUntil > now || (!manual && status.nextCheckIn > 0)) return { ...status, lease: null };
    dashboard.leasedUntil = now + leaseDuration;
    const historyStart = status.resetAt === null
      ? dashboard.matches.reduce((earliest, match) => earliest && earliest <= match.date ? earliest : match.date, null) ?? firstMatchDate
      : new Date(status.resetAt).toISOString();
    return { ...status, lease: dashboard.leasedUntil, historyStart };
  }, true);
}

function officialKey(club, id) {
  return JSON.stringify([club, id]);
}

function scoreKey({ club, date, homeScore, awayScore }) {
  return JSON.stringify([club, date, homeScore, awayScore]);
}

function teamKey(name) {
  return key(name).normalize("NFKD").replace(/\p{M}/gu, "").replaceAll("ł", "l").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function sameTeam(saved, ...names) {
  const comparison = teamKey(saved);
  const shortened = /(?:…|\.{3})$/u.test(saved);
  return names.some(name => {
    if (!name) return false;
    const candidate = teamKey(name);
    return key(name) === key(saved) || (comparison && (comparison === candidate || (shortened && candidate.startsWith(comparison + " "))));
  });
}

function createMatch(dashboard, match, importKey, mflId = null, status = "ENDED") {
  const row = { ...match, importKey, mflId, status, id: dashboard.nextId++, hidden: false, retryStatsAt: 0 };
  dashboard.matches.push(row);
  return row;
}

function applyOfficialScores(dashboard, finals) {
  const byMflId = new Map();
  const byScore = new Map();
  const byReference = new Map();
  const saved = [...dashboard.matches].sort((a, b) => Number(a.hidden) - Number(b.hidden));
  for (const match of saved) {
    if (match.mflId) {
      byMflId.set(officialKey(match.club, match.mflId), match);
    } else if (/^\d+$/.test(match.reference)) {
      const identity = officialKey(match.club, match.reference);
      if (!byReference.has(identity)) byReference.set(identity, match);
    } else {
      const score = scoreKey(match);
      if (!byScore.has(score)) byScore.set(score, []);
      byScore.get(score).push(match);
    }
  }
  for (const final of finals) {
    if (!isAllowedMflCompetition(final.competition) || !FINAL_STATUSES.includes(final.status)) continue;
    const match = normalizeScore(final);
    const identity = officialKey(match.club, final.id);
    const savedMatch = byMflId.get(identity) ?? byReference.get(identity)
      ?? byScore.get(scoreKey(match))?.find(previous => !previous.mflId
        && sameTeam(previous.home, match.home, final.homeAlias) && sameTeam(previous.away, match.away, final.awayAlias));
    if (savedMatch) {
      if (savedMatch.hidden) savedMatch.retryStatsAt = 0;
      Object.assign(savedMatch, { mflId: final.id, hidden: false, status: final.status, homeScore: match.homeScore, awayScore: match.awayScore });
      byMflId.set(identity, savedMatch);
    } else {
      const row = createMatch(dashboard, {
        ...match, reference: final.id, homeFormation: null, awayFormation: null, homeXg: null, awayXg: null, homeOvr: null, awayOvr: null,
      }, "mfl:" + identity, final.id, final.status);
      byMflId.set(identity, row);
    }
  }
}

function needsReport(match) {
  return !match.hidden && match.mflId && match.status === "ENDED" && !hasMatchAnalysis(match);
}

function pendingReports(matches, now) {
  const eligible = matches.filter(match => needsReport(match) && match.retryStatsAt <= now);
  eligible.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return [...new Set(eligible.map(match => match.mflId))].slice(0, reportBatchSize);
}

export function saveMflRefresh(lease, { finals, failedClubs }, resetAt = null) {
  return withDashboard(dashboard => {
    const now = Date.now();
    if (dashboard.leasedUntil !== lease || lease <= now || (dashboard.resetAt ?? null) !== resetAt) return syncStatus(dashboard, now);
    applyOfficialScores(dashboard, finals.filter(final => kickedOffAfterReset(final, resetAt)));
    dashboard.checkedAt = now;
    dashboard.leasedUntil = 0;
    dashboard.problem = failedClubs === CLUBS.length ? "MFL could not be reached. Touchline will retry automatically."
      : failedClubs ? "Some clubs could not be checked. Touchline will retry automatically." : "";
    return { ...syncStatus(dashboard, now), pending: pendingReports(dashboard.matches, now) };
  }, true);
}

export function saveMflStats(reports, resetAt = null) {
  return withDashboard(dashboard => {
    const now = Date.now();
    if ((dashboard.resetAt ?? null) !== resetAt) return { pending: [] };
    const byId = new Map(reports.map(report => [report.id, report.stats]));
    for (const match of dashboard.matches) {
      if (!needsReport(match) || !byId.has(match.mflId)) continue;
      const stats = byId.get(match.mflId);
      if (stats) Object.assign(match, normalizeMatchStats(stats), { retryStatsAt: 0 });
      else match.retryStatsAt = now + (now - Date.parse(match.date) <= 2 * 86_400_000 ? 60_000 : 900_000);
    }
    return { pending: pendingReports(dashboard.matches, now) };
  }, true);
}

function sameScore(saved, candidate) {
  return scoreKey(saved) === scoreKey(candidate) && key(saved.home) === key(candidate.home) && key(saved.away) === key(candidate.away);
}

export function importMatches(rows, source, resetAt = null) {
  return withDashboard(dashboard => {
    if ((dashboard.resetAt ?? null) !== resetAt) throw new Error("Results were cleared during the import. Start a new import to add matches.");
    let inserted = 0;
    for (const [index, raw] of rows.entries()) {
      let match;
      try {
        match = normalizeMatch(raw);
      } catch (error) {
        throw new Error(`Row ${index + 1}. ${error.message}`);
      }
      const mflId = source === "backup" && /^\d{1,24}$/.test(String(raw.mflId ?? "")) ? String(raw.mflId) : null;
      const status = source === "backup" && raw.status === "FORFEITED" ? "FORFEITED" : "ENDED";
      const importKey = mflId ? "mfl:" + officialKey(match.club, mflId) : matchKey(match);
      const legacyKey = source === "html" ? legacyMatchKey(match) : null;
      const linked = dashboard.matches.find(saved => saved.club === match.club && saved.mflId && (
        saved.mflId === (mflId ?? match.reference) || (!match.reference && sameScore(saved, match))
      ));
      if (linked) {
        const missingStats = !hasMatchAnalysis(linked);
        const restoring = linked.hidden && source === "backup";
        if (missingStats) Object.assign(linked, normalizeMatchStats(match), { retryStatsAt: 0 });
        if (restoring) linked.hidden = false;
        if (missingStats || restoring) inserted++;
        continue;
      }
      const earlier = mflId && dashboard.matches.find(saved => !saved.mflId && sameScore(saved, match)
        && (!saved.reference || saved.reference === mflId));
      if (earlier) {
        Object.assign(earlier, { mflId, status, hidden: false });
        inserted++;
        continue;
      }
      const duplicate = dashboard.matches.find(saved => saved.importKey === importKey ||
        (legacyKey && saved.importKey === legacyKey && !saved.hidden && sameScore(saved, match)));
      if (duplicate) {
        if (duplicate.hidden && !duplicate.mflId) {
          duplicate.hidden = false;
          inserted++;
        }
        continue;
      }
      createMatch(dashboard, match, importKey, mflId, status);
      inserted++;
    }
    return { inserted, skipped: rows.length - inserted };
  }, true);
}

export function removeSavedMatch(id) {
  return withDashboard(({ matches }) => {
    const match = matches.find(row => row.id === id && !row.hidden);
    if (!match) throw new Error("This match has already been removed.");
    match.hidden = true;
  }, true);
}
