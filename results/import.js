import readSheet, { readSheetNames } from "./vendor/excel.js";
import { clubName, legacyMatchKey, matchKey, matchText, normalizeMatch } from "./matches.js";
import { matchHtmlSource, normalizeHtmlMatch } from "./mfl-html.js";

export const FIELDS = [
  ["date", "Date", ["match date", "played on"]],
  ["home", "Home team", ["home", "host", "home club", "home name"]],
  ["away", "Away team", ["away", "visitor", "away club", "away name"]],
  ["homeScore", "Home score", ["home goals", "fthg", "gf home"]],
  ["awayScore", "Away score", ["away goals", "ftag", "gf away"]],
  ["homeFormation", "Home formation", ["home tactic", "home shape"]],
  ["awayFormation", "Away formation", ["away tactic", "away shape"]],
  ["homeXg", "Home xG", ["xg home", "home expected goals", "host xg"]],
  ["awayXg", "Away xG", ["xg away", "away expected goals", "visitor xg"]],
  ["homeOvr", "Home OVR", ["home rating", "home overall", "home team rating", "home ovr rating"]],
  ["awayOvr", "Away OVR", ["away rating", "away overall", "away team rating", "away ovr rating"]],
  ["competition", "Competition", ["league", "tournament", "event"], false],
  ["club", "Club", ["tracked club", "team sheet", "source club", "source"], false],
  ["reference", "Match ID", ["fixture id", "game id", "match reference"], false],
];

export const TEMPLATE = "Date,Competition,Home Team,Home Score,Away Team,Away Score,Home Formation,Away Formation,Home xG,Away xG,Home Rating,Away Rating,Club,Match ID\n";

const headerKey = text => matchText(text).toLowerCase().replace(/[^a-z0-9]/g, "");
const headersByField = new Map(FIELDS.map(([field, label, aliases]) => [field, [label, ...aliases].map(headerKey)]));

function mapFields(headers) {
  const keys = headers.map(headerKey);
  return Object.fromEntries(FIELDS.map(([field]) => [
    field, keys.findIndex(header => headersByField.get(field).includes(header)),
  ]));
}

function hasValue(row) {
  return row.some(cell => matchText(cell) !== "");
}

function findHeader(rows) {
  let best;
  for (const [index, row] of rows.slice(0, 25).entries()) {
    if (!hasValue(row)) continue;
    const map = mapFields(row);
    const score = Object.values(map).filter(value => value >= 0).length;
    if (!best || score > best.score) best = { index, map, score };
  }
  return best;
}

function parseDelimited(input, delimiter) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"' && value === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(value);
      value = "";
    } else if (char === "\r" || char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      if (char === "\r" && input[index + 1] === "\n") index += 1;
    } else value += char;
  }
  if (quoted) throw new Error("A quoted cell is unfinished.");
  if (row.length || value) rows.push([...row, value]);
  return rows;
}

export function fromText(input, name = "Pasted rows") {
  const inputText = input.replace(/^\uFEFF/u, "");
  if (!inputText.trim()) throw new Error("Paste rows including their column headers.");
  if (inputText.length > 10_000_000) throw new Error("Paste a smaller batch of rows.");
  const options = [];
  let parseError;
  for (const delimiter of ["\t", ",", ";"]) {
    try {
      const rows = parseDelimited(inputText, delimiter);
      const header = findHeader(rows);
      if (header) options.push({ rows, score: header.score, width: rows[header.index].length });
    } catch (error) {
      parseError = error;
    }
  }
  options.sort((left, right) => right.score - left.score || right.width - left.width);
  if (!options.length) throw parseError || new Error("No column headers found.");
  return matchSheets([{ sheet: name, data: options[0].rows }]);
}

export function fromPaste(input) {
  if (!input.trim()) throw new Error("Paste an MFL match row or spreadsheet rows with headers.");
  const html = input.trim().replace(/\\(?=[<>])/g, "").replace(/^\x60{3}(?:html)?\s*/i, "");
  return /^<(?:tr|table|tbody|thead|td)\b/i.test(html) ? [matchHtmlSource(html)] : fromText(input);
}

export function matchSheets(sheets) {
  const candidates = [];
  for (const { sheet, data } of sheets) {
    const header = findHeader(data);
    if (!header || data.length <= header.index + 1) continue;
    const headers = data[header.index].map(cell => matchText(cell));
    candidates.push({
      name: sheet, headers, score: header.score, map: header.map,
      rows: data.slice(header.index + 1).map((values, index) => ({ values, line: header.index + index + 2 }))
        .filter(row => hasValue(row.values)),
      club: clubName(sheet), selected: false,
    });
  }
  const matchTabs = candidates.filter(sheet => sheet.score >= 9);
  const result = matchTabs.length ? matchTabs : candidates.sort((left, right) => right.score - left.score).slice(0, 1);
  if (!result.length) throw new Error("No match rows were found.");
  return result.map(sheet => ({ ...sheet, selected: true }));
}

export async function fromFile(file) {
  if (file.size > 10_000_000) throw new Error("Choose a spreadsheet under 10 MB.");
  if (/\.xlsx$/i.test(file.name)) {
    const bytes = await file.arrayBuffer();
    const names = await readSheetNames(bytes);
    const clubTabs = names.filter(name => clubName(name));
    const sheets = [];
    for (const sheet of clubTabs.length ? clubTabs : names) {
      sheets.push({ sheet, data: await readSheet(bytes, { sheet }) });
    }
    return matchSheets(sheets);
  }
  if (/\.(csv|tsv|txt)$/i.test(file.name)) return fromText(await file.text(), file.name);
  throw new Error("Choose an Excel .xlsx, CSV, or TSV file.");
}

function findLegacyMatch(match, known) {
  const saved = known.get(legacyMatchKey(match));
  if (saved && saved.homeScore === match.homeScore && saved.awayScore === match.awayScore) return saved;
}

export function review(sheets, existing) {
  const rows = [];
  const problems = [];
  const preview = [];
  let duplicates = 0;
  const known = new Map(existing.map(match => [matchKey(match), match]));
  for (const sheet of sheets.filter(sheet => sheet.selected)) {
    const html = sheet.kind === "html";
    if (!html) {
      const missing = FIELDS.filter(([field, , , required = true]) => required && sheet.map[field] < 0);
      if (missing.length) {
        problems.push({ sheet: sheet.name, line: 0, error: "Map " + missing.map(([, label]) => label).join(", ") + "." });
        continue;
      }
    }
    for (const source of sheet.rows) {
      try {
        if (source.error) throw new Error(source.error);
        let match;
        if (html) {
          match = normalizeHtmlMatch(source.data, sheet.club);
        } else {
          const input = Object.fromEntries(FIELDS.map(([field]) => [field, source.values[sheet.map[field]]]));
          input.club = sheet.club || input.club;
          match = normalizeMatch(input);
        }
        const id = matchKey(match);
        const saved = known.get(id) || (html ? findLegacyMatch(match, known) : undefined);
        if (preview.length < 5) preview.push({ match: saved || match, duplicate: Boolean(saved) });
        if (saved) duplicates += 1;
        else {
          known.set(id, match);
          rows.push(match);
        }
      } catch (error) {
        problems.push({ sheet: sheet.name, line: source.line, error: error.message });
      }
    }
  }
  return { rows, problems, duplicates, preview };
}
