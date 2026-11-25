export const CLUBS = [
  { code: "B1907", name: "Birkenhead 1907", mflClubId: "152757", mflSquadId: "107038" },
  { code: "GDR", name: "Gladiatori Di Roma", mflClubId: "7279", mflSquadId: "104832" },
  { code: "ELDM", name: "El Loco de Minas", mflClubId: "6508", mflSquadId: "105972" },
  { code: "KOK", name: "King of Kings", mflClubId: "1354", mflSquadId: "1959" },
];

export const IMPORT_SIZE = 400;
export const LIVE_REFRESH_MS = 6 * 60 * 60 * 1000;
export const FINAL_STATUSES = ["ENDED", "FORFEITED"];

export function hasMatchAnalysis(match) {
  return Boolean(match.homeFormation && match.awayFormation)
    && [match.homeXg, match.awayXg, match.homeOvr, match.awayOvr].every(Number.isFinite);
}
const MONTHS = ["january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"];

export function matchText(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
}

const leagueCompetition = /^(?:Diamond|Platinum|Gold|Silver|Bronze|Iron|Stone|Ice|Spark|Flint) *- *League \d+$/i;
const cupCompetition = /^(?:Titans|Elite|Contenders|Challengers|Rivals|Aspirants) Cup *- *Tier \d+$/i;

export function isAllowedMflCompetition(value) {
  const name = matchText(value).replace(/[\p{Dash_Punctuation}−]/gu, "-");
  return leagueCompetition.test(name) || cupCompetition.test(name);
}

export function key(value) {
  return matchText(value).toLocaleLowerCase("en-GB");
}

export function clubName(value) {
  const lookup = key(value);
  return CLUBS.find(club => key(club.code) === lookup || key(club.name) === lookup)?.name ?? "";
}

function field(value, label, required = true) {
  const text = matchText(value);
  if (required && !text) throw new Error(label + " is required.");
  if (text.length > 160) throw new Error(label + " must be 160 characters or fewer.");
  return text;
}

export function matchDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const date = matchText(value);
  const iso = date.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/);
  const uk = date.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  const named = date.match(/^(\d{1,2}) ([a-z]+)\.? (\d{2}|\d{4})$/i);
  let parts;
  if (iso) parts = [iso[1], iso[2], iso[3]];
  else if (uk || named) {
    const [, day, month, shortYear] = uk || named;
    const year = shortYear.length === 2 ? (Number(shortYear) < 70 ? "20" : "19") + shortYear : shortYear;
    const label = month.toLowerCase();
    const monthIndex = MONTHS.findIndex(name => name === label || name.slice(0, 3) === label || (name === "september" && label === "sept"));
    parts = [year, uk ? month : String(monthIndex + 1), day];
  } else if (/^\d{5}(?:\.\d+)?$/.test(date)) {
    return new Date(Date.UTC(1899, 11, 30 + Math.floor(Number(date)))).toISOString().slice(0, 10);
  } else throw new Error("Enter a date such as 17 Nov 26, 17/11/2026 or 2026-11-17.");
  const formatted = parts.map((part, index) => part.padStart(index === 0 ? 4 : 2, "0")).join("-");
  const parsed = new Date(formatted + "T00:00:00Z");
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== formatted) {
    throw new Error("The match date is not a valid calendar date.");
  }
  return formatted;
}

function numberField(value, label, whole) {
  const text = matchText(value).replace(",", ".");
  const pattern = whole ? /^\d{1,6}$/ : /^(?:\d{1,6}(?:\.\d+)?|\.\d+)$/;
  if (!pattern.test(text)) throw new Error(label + " must be " + (whole ? "a non-negative whole number." : "a non-negative number."));
  return Number(text);
}

function formation(value, label) {
  return field(value, label)
    .replace(/[−–—]/gu, "-")
    .replace(/\s*-\s*/gu, "-")
    .replace(/\s*\(\s*/gu, " (")
    .replace(/\s*\)/gu, ")");
}

export function normalizeScore(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a match row.");
  let home = field(input.home, "Home team");
  let away = field(input.away, "Away team");
  if (key(home) === key(away)) throw new Error("The home and away teams must differ.");
  home = clubName(home) || home;
  away = clubName(away) || away;
  const inferred = [clubName(home), clubName(away)].filter(Boolean);
  const club = clubName(input.club) || (!matchText(input.club) && inferred.length === 1 ? inferred[0] : "");
  if (!club) throw new Error("Select which club this match is for.");
  if (club !== home && club !== away) throw new Error(club + " is absent from this match.");
  return {
    club, home, away,
    date: matchDate(input.date),
    competition: field(input.competition, "Competition", false),
    reference: field(input.reference, "Match ID", false),
    homeScore: numberField(input.homeScore, "Home score", true),
    awayScore: numberField(input.awayScore, "Away score", true),
  };
}

export function normalizeMatchStats(input) {
  return {
    homeFormation: formation(input.homeFormation, "Home formation"),
    awayFormation: formation(input.awayFormation, "Away formation"),
    homeXg: numberField(input.homeXg, "Home xG", false),
    awayXg: numberField(input.awayXg, "Away xG", false),
    homeOvr: numberField(input.homeOvr, "Home OVR", false),
    awayOvr: numberField(input.awayOvr, "Away OVR", false),
  };
}

export function normalizeMatch(input) {
  return { ...normalizeScore(input), ...normalizeMatchStats(input) };
}

export function matchKey(match) {
  return JSON.stringify(match.reference
    ? [match.club, key(match.competition), "id", match.reference]
    : [match.club, key(match.competition), match.date, key(match.home), key(match.away)]);
}

export function legacyMatchKey(match) {
  const competition = key(match.competition);
  const category = /\bcup\b/.test(competition) ? "cup" : /\bleague\b/.test(competition) ? "league" : "";
  if (!category || competition === category || match.reference) return null;
  return matchKey({ ...match, competition: category });
}
