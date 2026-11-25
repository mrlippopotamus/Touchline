import { clubName, matchText, normalizeMatch } from "./matches.js";

const cellText = element => matchText(element.textContent);

function teamAndScore(block) {
  const parts = Array.from(block.children, cellText).filter(Boolean);
  if (parts.length !== 2) throw new Error("Each team needs its name and score.");
  return parts;
}

function pair(cell, label) {
  const values = [...cell.querySelectorAll("span")]
    .filter(span => span.children.length === 0)
    .map(cellText);
  if (values.length !== 2 || values.some(value => !value)) {
    throw new Error("Both teams need " + label + ".");
  }
  return values;
}

function readRow(cells) {
  // The expansion arrow is the only optional cell in the MFL row.
  const data = cells.length === 9 ? cells.slice(1) : cells;
  if (data.length !== 8) throw new Error("Copy the entire MFL match row, including formations, xG and OVR.");
  const [date, competition, teams, result, ourFormation, oppFormation, xg, ovr] = data;
  const sides = teams.children.length === 1 ? teams.firstElementChild.children : teams.children;
  if (sides.length !== 2) throw new Error("The match row needs a home and an away team.");
  const [home, homeScore] = teamAndScore(sides[0]);
  const [away, awayScore] = teamAndScore(sides[1]);
  const [homeXg, awayXg] = pair(xg, "xG");
  const [homeOvr, awayOvr] = pair(ovr, "OVR");
  const event = competition.querySelector("[aria-label], [title]") || competition;
  return {
    date: cellText(date),
    competition: matchText(event.getAttribute("aria-label") || event.getAttribute("title")) || cellText(competition),
    home, away, homeScore, awayScore,
    result: cellText(result).toUpperCase(),
    ourFormation: cellText(ourFormation),
    oppFormation: cellText(oppFormation),
    homeXg, awayXg, homeOvr, awayOvr,
  };
}

export function matchHtmlSource(html) {
  if (html.length > 10_000_000) throw new Error("Paste a smaller batch of match rows.");
  // Read the inert template only. Pasted markup is never rendered or loaded.
  const template = document.createElement("template");
  template.innerHTML = html;
  const rows = [];
  for (const tr of template.content.querySelectorAll("tr")) {
    const cells = [...tr.cells];
    if (!cells.some(cell => cell.localName === "td") || (cells.length === 1 && cells[0].hasAttribute("colspan"))) continue;
    const line = rows.length + 1;
    try {
      rows.push({ line, data: readRow(cells) });
    } catch (error) {
      rows.push({ line, error: error.message });
    }
  }
  if (!rows.length) throw new Error("No MFL match rows found. Copy the HTML of a match's <tr> element.");
  return { kind: "html", name: "MFL match HTML", rows, club: "", selected: true };
}

export function normalizeHtmlMatch(data, selectedClub) {
  const { result, ourFormation, oppFormation, ...input } = data;
  const homeClub = clubName(input.home);
  const awayClub = clubName(input.away);
  // A win or loss identifies the source club when the score differs.
  const goalDifference = Number(input.homeScore) - Number(input.awayScore);
  const sourceIsHome = goalDifference && (result === "W" || result === "L")
    ? (result === "W") === (goalDifference > 0)
    : null;
  const singleClub = homeClub && awayClub ? "" : homeClub || awayClub;
  let sourceClub = "";
  if (sourceIsHome !== null) sourceClub = sourceIsHome ? homeClub : awayClub;
  const club = selectedClub || sourceClub || singleClub;
  const formationIsHome = sourceIsHome ?? (club === homeClub);
  return normalizeMatch({
    ...input, club,
    homeFormation: formationIsHome ? ourFormation : oppFormation,
    awayFormation: formationIsHome ? oppFormation : ourFormation,
  });
}
