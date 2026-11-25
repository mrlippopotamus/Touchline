import { pastClubMatchPage, clubMatchStats } from "../assets/mfl.js";
import { CLUBS, FINAL_STATUSES, hasMatchAnalysis, isAllowedMflCompetition } from "./matches.js";

function finalResult(match, trackedClub) {
  if (!isAllowedMflCompetition(match.competition) || !FINAL_STATUSES.includes(match.status) || !match.date
    || !Number.isInteger(match.home.score) || !Number.isInteger(match.away.score)
    || match.home.score < 0 || match.away.score < 0) return null;
  const homeClub = match.home.club?.id;
  const awayClub = match.away.club?.id;
  if (homeClub !== trackedClub.mflClubId && awayClub !== trackedClub.mflClubId) return null;
  const date = new Date(match.date).toISOString().slice(0, 10);
  return {
    id: match.id, club: trackedClub.name, date, status: match.status,
    competition: match.competition,
    home: homeClub === trackedClub.mflClubId ? trackedClub.name : match.home.name,
    away: awayClub === trackedClub.mflClubId ? trackedClub.name : match.away.name,
    homeAlias: homeClub === trackedClub.mflClubId ? "" : match.home.club?.name,
    awayAlias: awayClub === trackedClub.mflClubId ? "" : match.away.club?.name,
    homeScore: match.home.score, awayScore: match.away.score,
  };
}

async function clubFinals(club, historyStart) {
  const cutoff = historyStart ? Date.parse(historyStart) : 0;
  const finals = new Map();
  const cursors = new Set();
  let beforeMatchId;
  do {
    const page = await pastClubMatchPage(club.mflSquadId, beforeMatchId);
    for (const match of page.matches) {
      if (match.date < cutoff) continue;
      const result = finalResult(match, club);
      if (result) finals.set(result.id, result);
    }
    if (!historyStart || page.matches.some(match => match.date && match.date < cutoff)) break;
    beforeMatchId = page.next;
    if (cursors.has(beforeMatchId)) throw new Error("MFL repeated a match history page.");
    cursors.add(beforeMatchId);
  } while (beforeMatchId);
  return [...finals.values()];
}

export async function latestMflFinals(historyStart) {
  const lists = await Promise.allSettled(CLUBS.map(club => clubFinals(club, historyStart)));
  return {
    finals: lists.flatMap(entry => entry.status === "fulfilled" ? entry.value : []),
    failedClubs: lists.filter(entry => entry.status === "rejected").length,
  };
}

function displayFormation(code) {
  if (typeof code !== "string" || !code) return "";
  const [shape, ...parts] = code.split("_");
  const variant = parts.join("_");
  const labels = { attack: "att", attacking: "att", defense: "defend", defensive: "defend", b: "B" };
  return variant ? shape + " (" + (labels[variant] ?? variant.replaceAll("_", " ")) + ")" : shape;
}

export async function reportedMflStats(id) {
  const stats = await clubMatchStats(id);
  const match = {
    homeFormation: displayFormation(stats.home.formation),
    awayFormation: displayFormation(stats.away.formation),
    homeXg: stats.home.xG, awayXg: stats.away.xG,
    homeOvr: stats.home.overall, awayOvr: stats.away.overall,
  };
  return { id, stats: hasMatchAnalysis(match) ? match : null };
}
