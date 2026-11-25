import { key } from "./matches.js";

const WORKBOOK_OURS = [
  "4-1-2-1-2", "4-1-2-1-2 (narrow)", "4-1-3-2", "4-2-2-2",
  "4-2-3-1", "4-3-3 (att)", "4-3-3 (defend)", "4-4-2",
];
const WORKBOOK_OPPOSITION = [
  "3-4-2-1", "3-4-3", "3-5-2", "3-5-2 (B)", "4-1-2-1-2", "4-1-2-1-2 (narrow)",
  "4-1-3-2", "4-1-4-1", "4-2-2-2", "4-2-3-1", "4-2-4", "4-3-1-2", "4-3-3",
  "4-3-3 (att)", "4-3-3 (defend)", "4-3-3 (false9)", "4-4-1-1", "4-4-2",
  "4-4-2 (B)", "5-2-3", "5-4-1 (flat)", "5-3-2",
];

export const DEFAULT_PRIOR = 5;
export const DEFAULT_OPPOSITION = "4-3-3 (att)";

function average(rows, property) {
  if (rows.length === 0) return 0;
  return rows.reduce((sum, row) => sum + row[property], 0) / rows.length;
}

function formationList(initial, rows, property) {
  const labels = new Map(initial.map(name => [key(name), name]));
  for (const row of rows) {
    const name = row[property];
    if (!labels.has(key(name))) labels.set(key(name), name);
  }
  return [...labels.values()];
}

export function evidence(count) {
  if (count >= 10) return "High";
  if (count >= 5) return "Medium";
  if (count >= 1) return "Low";
  return "Exploratory";
}

export function analyseMatch(match) {
  const atHome = match.club === match.home;
  const opponent = atHome ? match.away : match.home;
  const ourFormation = atHome ? match.homeFormation : match.awayFormation;
  const oppFormation = atHome ? match.awayFormation : match.homeFormation;
  const gf = atHome ? match.homeScore : match.awayScore;
  const ga = atHome ? match.awayScore : match.homeScore;
  const xgFor = atHome ? match.homeXg : match.awayXg;
  const xgAgainst = atHome ? match.awayXg : match.homeXg;
  const ourOvr = atHome ? match.homeOvr : match.awayOvr;
  const oppOvr = atHome ? match.awayOvr : match.homeOvr;
  const result = gf > ga ? "W" : gf === ga ? "D" : "L";
  const points = gf > ga ? 3 : gf === ga ? 1 : 0;
  const xgDiff = xgFor - xgAgainst;
  const ovrDiff = ourOvr - oppOvr;
  const expectedPoints = 3 / (1 + Math.exp(-ovrDiff / 80));
  const performance = points - expectedPoints + 0.45 * xgDiff;
  return {
    ...match, opponent, ourFormation, oppFormation, gf, ga, xgFor, xgAgainst,
    ourOvr, oppOvr, result, points, xgDiff, ovrDiff, expectedPoints, performance,
    venue: atHome ? "Home" : "Away",
  };
}

function baseline(rows) {
  const xMean = average(rows, "ovrDiff");
  const yMean = average(rows, "xgDiff");
  let variance = 0;
  let covariance = 0;
  for (const row of rows) {
    const deviation = row.ovrDiff - xMean;
    variance += deviation ** 2;
    covariance += deviation * (row.xgDiff - yMean);
  }
  if (variance === 0) return { slope: 0, intercept: 0 };
  const slope = covariance / variance;
  return { slope, intercept: yMean - slope * xMean };
}

export function analyse(matches) {
  const rows = matches.map(analyseMatch);
  const fit = baseline(rows);
  for (const row of rows) {
    row.expectedXg = fit.intercept + fit.slope * row.ovrDiff;
    row.adjusted = row.xgDiff - row.expectedXg;
  }
  return {
    rows, ...fit,
    ourFormations: formationList(WORKBOOK_OURS, rows, "ourFormation"),
    oppFormations: formationList(WORKBOOK_OPPOSITION, rows, "oppFormation"),
  };
}

export function summarize(rows) {
  const count = rows.length;
  let wins = 0;
  let draws = 0;
  for (const row of rows) {
    if (row.result === "W") wins += 1;
    if (row.result === "D") draws += 1;
  }
  return {
    count, wins, draws, losses: count - wins - draws,
    ppg: average(rows, "points"),
    xgFor: average(rows, "xgFor"),
    xgAgainst: average(rows, "xgAgainst"),
    xgDiff: average(rows, "xgDiff"),
    ovrDiff: average(rows, "ovrDiff"),
    performance: average(rows, "performance"),
    adjusted: average(rows, "adjusted"),
    evidence: evidence(count),
  };
}

export function pairKey(ourFormation, oppFormation) {
  return JSON.stringify([key(ourFormation), key(oppFormation)]);
}

export function matrix(rows) {
  const groups = new Map();
  for (const row of rows) {
    const pair = pairKey(row.ourFormation, row.oppFormation);
    if (!groups.has(pair)) groups.set(pair, []);
    groups.get(pair).push(row);
  }
  return groups;
}

function adjustedBaseline(formationRows, pairRows, clubRows) {
  if (formationRows.length <= pairRows.length) return average(clubRows, "adjusted");
  const opponent = key(pairRows[0]?.oppFormation);
  return average(formationRows.filter(row => key(row.oppFormation) !== opponent), "adjusted");
}

export function formationMatchups(model, club, prior) {
  const clubs = club ? [club] : [...new Set(model.rows.map(row => row.club))];
  return clubs.flatMap(name => {
    const clubRows = model.rows.filter(row => row.club === name);
    const clubStats = summarize(clubRows);
    return [...matrix(clubRows).values()].map(rows => {
      const { ourFormation, oppFormation } = rows[0];
      const formationRows = clubRows.filter(row => key(row.ourFormation) === key(ourFormation));
      const stats = summarize(rows);
      const fallback = adjustedBaseline(formationRows, rows, clubRows);
      const weight = stats.count / (stats.count + prior);
      return {
        club: name, ourFormation, oppFormation, rows, ...stats,
        fallback, weight,
        weighted: weight * stats.adjusted + (1 - weight) * fallback,
        attack: stats.xgFor - clubStats.xgFor,
        defence: clubStats.xgAgainst - stats.xgAgainst,
      };
    });
  });
}

export function formationPicker(model, { club, opponent, ownOvr, opponentOvr, venue, prior }) {
  const clubRows = model.rows.filter(row => !club || row.club === club);
  const ovrDiff = ownOvr - opponentOvr;
  const expectedXg = model.intercept + model.slope * ovrDiff;
  const opponentKey = key(opponent);
  const directGames = clubRows.filter(row => key(row.oppFormation) === opponentKey).length;
  const ranked = [];
  for (const ourFormation of model.ourFormations) {
    const formationRows = clubRows.filter(row => key(row.ourFormation) === key(ourFormation));
    if (!formationRows.length) continue;
    const exact = formationRows.filter(row => key(row.oppFormation) === opponentKey);
    const exactMean = average(exact, "adjusted");
    const fallback = adjustedBaseline(formationRows, exact, clubRows);
    const base = (exact.length * exactMean + prior * fallback) / (exact.length + prior);
    const close = exact.filter(row => Math.abs(row.ovrDiff - ovrDiff) <= 40);
    const ovrAdjustment = close.length / (close.length + prior) * (average(close, "adjusted") - exactMean);
    const venueRows = venue === "Either" ? [] : formationRows.filter(row => row.venue === venue);
    const venueAdjustment = Math.max(-1, Math.min(1, venueRows.length / (venueRows.length + prior)
      * (average(venueRows, "adjusted") - average(formationRows, "adjusted"))));
    const score = base + ovrAdjustment + venueAdjustment;
    const reported = exact.length ? exact : formationRows;
    ranked.push({
      ourFormation, score, xgEdge: expectedXg + score, exact: exact.length, exactMean,
      fallback, base, close: close.length, ovrAdjustment, venueGames: venueRows.length,
      venueAdjustment, evidence: evidence(exact.length), clubGames: formationRows.length,
      xgFor: average(reported, "xgFor"), xgAgainst: average(reported, "xgAgainst"),
    });
  }
  ranked.sort((left, right) => right.score - left.score);
  return { ovrDiff, directGames, ranked };
}
