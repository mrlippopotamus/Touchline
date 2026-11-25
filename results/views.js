import { CLUBS, key } from "./matches.js";
import { formationMatchups, formationPicker, matrix, pairKey, summarize } from "./analysis.js";

export const PAGE_SIZE = 25;

const formatter = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function format(value, signed = false) {
  if (value === null || value === undefined) return "—";
  const normal = Math.abs(value) < 0.005 ? 0 : value;
  return (signed && normal > 0 ? "+" : "") + formatter.format(normal);
}

export function displayDate(date) {
  return dateFormatter.format(new Date(date + "T00:00:00Z"));
}

export function select(name, label, options, current) {
  const choices = options.map(option => {
    const [value, text] = Array.isArray(option) ? option : [option, option];
    return `<option value="${escape(value)}"${String(value) === String(current) ? " selected" : ""}>${escape(text)}</option>`;
  }).join("");
  return `<label class="field">${escape(label)}<span class="select-box"><select name="${escape(name)}">${choices}</select><span class="icon" aria-hidden="true">expand_more</span></span></label>`;
}

export function confidence(label) {
  return `<span class="confidence ${label.toLowerCase()}">${label}</span>`;
}

export function clubOptions(any = "All clubs") {
  return [["", any], ...CLUBS.map(club => [club.name, club.name])];
}

function metric(label, value, detail) {
  return `<div class="metric"><span class="metric-label">${escape(label)}</span><strong class="metric-value number">${escape(value)}</strong><p class="metric-detail">${escape(detail)}</p></div>`;
}

function empty(message) {
  return `<p class="notice empty">${escape(message)}</p>`;
}

function tone(value, isCount) {
  if (isCount) return value >= 5 ? "positive strong" : "positive";
  const intensity = Math.abs(value) >= 0.9 ? " strong" : "";
  if (Math.abs(value) < 0.005) return "balanced";
  return (value > 0 ? "positive" : "negative") + intensity;
}

export function matrixView(model, state) {
  const rows = model.rows.filter(row => !state.club || row.club === state.club);
  const stats = summarize(rows);
  const cells = matrix(rows);
  const opponents = state.matrixOpponent ? [state.matrixOpponent] : model.oppFormations;
  const metrics = [["performance", "Performance index"], ["adjusted", "OVR-adjusted xG"], ["count", "Match count"]];
  const metricName = metrics.find(([id]) => id === state.metric)[1];
  const countMode = state.metric === "count";
  const columns = opponents.map(name => `<th scope="col">${escape(name)}</th>`).join("");
  const body = model.ourFormations.map(ours => {
    const row = opponents.map(opp => {
      const pair = cells.get(pairKey(ours, opp));
      if (!pair) return '<td class="blank" aria-label="No matches">—</td>';
      const summary = summarize(pair);
      const value = summary[state.metric];
      const decision = countMode ? String(value) : format(value, true);
      const description = ours + " vs " + opp + ", " + metricName + " " + decision + ", " + pair.length + " matches";
      return `<td><button class="matrix-cell ${tone(value, countMode)}" data-action="cell"
        data-our="${escape(ours)}" data-opp="${escape(opp)}" data-club="${escape(state.club)}" aria-label="${escape(description)}">
        <b>${decision}</b><small>${countMode ? summary.evidence : pair.length + (pair.length === 1 ? " match" : " matches")}</small>
      </button></td>`;
    }).join("");
    return `<tr><th scope="row">${escape(ours)}</th>${row}</tr>`;
  }).join("");
  const winRate = stats.count ? Math.round(100 * stats.wins / stats.count) + "%" : "—";
  const resultLine = stats.wins + " W  ·  " + stats.draws + " D  ·  " + stats.losses + " L";
  return `<section class="metric-grid results-metrics" aria-label="Club summary">
      ${metric("Matches played", stats.count, state.club || "All four clubs")}
      ${metric("Win rate", winRate, resultLine)}
      ${metric("Average xG difference", format(stats.count ? stats.xgDiff : null, true), "Expected goals for minus against")}
      ${metric("Performance index", format(stats.count ? stats.performance : null, true), "Average per match")}
    </section>
    <section class="panel matrix-panel" aria-labelledby="matrix-title">
      <div class="panel-heading">
        <div><h2 id="matrix-title">Counter matrix</h2><p class="heading-meta">Select a formation matchup to see the match evidence.</p></div>
        <div class="field-row">
          ${select("club", "Club", clubOptions(), state.club)}
          ${select("metric", "Metric", metrics, state.metric)}
          ${select("matrixOpponent", "Opponent formation", [["", "All formations"], ...model.oppFormations], state.matrixOpponent)}
        </div>
      </div>
      ${stats.count ? `<div class="matrix-scroll" role="region" tabindex="0" aria-label="Formation counter matrix. Scroll for more columns.">
        <table class="matrix-table"><thead><tr><th scope="col">Our formation</th>${columns}</tr></thead><tbody>${body}</tbody></table>
      </div>
      <div class="table-footer">
        <span class="legend">${countMode ? '<i class="swatch positive"></i> 1–4 matches <i class="swatch positive strong"></i> 5+ matches' : '<i class="swatch negative strong"></i> Below zero <i class="swatch balanced"></i> Zero <i class="swatch positive strong"></i> Above zero'} <i class="swatch unplayed"></i> No matches</span>
        ${opponents.length > 6 ? "<span>Scroll across for more formations</span>" : ""}
      </div>` : empty("Import matches for this club to fill the matrix.")}
    </section>
    <details class="method">
      <summary>How the metrics are calculated</summary>
      <p><b>Performance index</b> is actual points minus expected points, plus 0.45 × xG difference. Expected points are calculated from the OVR difference using the workbook’s logistic formula.</p>
      <p><b>OVR-adjusted xG</b> is observed xG difference minus the xG difference predicted from OVR. The linear fit uses all imported club results.</p>
      <p><b>Evidence</b> is low for 1–4 matches, medium for 5–9 and high for 10 or more.</p>
    </details>`;
}

function numberInput(name, label, value, min, max) {
  return `<label class="field">${label}<input type="number" name="${name}" min="${min}" max="${max}" value="${value}" inputmode="numeric"></label>`;
}

function pickerReason(row) {
  if (!row.exact) return "Uses the club’s broader formation history.";
  if (row.exact < 5) return "The direct sample is small.";
  return row.score > 0 ? "Above expected xG in this matchup." : "Below expected xG in this matchup.";
}

export function pickerView(model, state) {
  const { ranked, directGames, ovrDiff } = formationPicker(model, state.picker);
  const { club, opponent, ownOvr, opponentOvr, venue, prior } = state.picker;
  const cards = ranked.slice(0, 3).map((row, index) => `<article class="rank-card${index === 0 ? " best" : ""}">
    <div class="rank-top"><span class="rank-label">Rank ${index + 1}</span>${confidence(row.evidence)}</div>
    <h3>${escape(row.ourFormation)}</h3>
    <div class="rank-numbers"><div><strong>${format(row.score, true)}</strong><span>Counter score</span></div>
      <div><strong>${format(row.xgEdge, true)}</strong><span>Indicative xG edge</span></div></div>
    <p>${row.exact} direct ${row.exact === 1 ? "match" : "matches"} · ${format(row.xgFor)} xG for · ${format(row.xgAgainst)} xG against</p>
    <small>${pickerReason(row)}</small>
  </article>`).join("");
  const body = ranked.map((row, index) => `<tr>
      <td>${index + 1}</td><th scope="row">${escape(row.ourFormation)}</th><td>${row.exact}</td>
      <td>${format(row.exactMean, true)}</td><td>${format(row.fallback, true)}</td><td>${format(row.base, true)}</td>
      <td>${row.close}</td><td>${format(row.ovrAdjustment, true)}</td><td>${row.venueGames}</td>
      <td>${format(row.venueAdjustment, true)}</td><td><b>${format(row.score, true)}</b></td>
      <td>${format(row.xgEdge, true)}</td><td>${format(row.xgFor)}</td><td>${format(row.xgAgainst)}</td>
      <td>${confidence(row.evidence)}</td><td>${row.clubGames}</td>
  </tr>`).join("");
  return `<section class="panel">
      <div class="panel-heading"><div><h2>Formation picker</h2><p class="heading-meta">${directGames} matches against ${escape(opponent)} · OVR advantage ${ovrDiff > 0 ? "+" : ""}${ovrDiff}</p></div></div>
      <div class="picker-controls">
        ${select("pickerClub", "Our club", clubOptions(), club)}
        ${select("opponent", "Opponent formation", model.oppFormations, opponent)}
        ${select("venue", "Venue", ["Either", "Home", "Away"], venue)}
        ${numberInput("ownOvr", "Our OVR", ownOvr, 0, 999999)}
        ${numberInput("opponentOvr", "Opponent OVR", opponentOvr, 0, 999999)}
        ${numberInput("prior", "Prior matches", prior, 1, 1000)}
      </div>
    </section>
    <section class="recommendations">
      <div class="section-heading"><h2>Top recommendations</h2></div>
      ${cards ? `<div class="rank-grid">${cards}</div>` : empty("Import match history for the selected club to see recommendations.")}
    </section>
    ${body ? `<details class="panel breakdown"><summary>All formations and calculation details</summary>
      <div class="table-scroll" tabindex="0" role="region" aria-label="Formation calculation details">
        <table class="data-table"><thead><tr>
          <th>Rank</th><th>Formation</th><th>Direct</th><th>Exact adj. xG</th><th>Fallback</th><th>Base</th>
          <th>OVR-close</th><th>OVR adj.</th><th>Venue matches</th><th>Venue adj.</th><th>Counter score</th>
          <th>xG edge</th><th>xG for</th><th>xG against</th><th>Evidence</th><th>Club matches</th>
        </tr></thead><tbody>${body}</tbody></table>
      </div>
      <p class="note">Small samples are weighted towards the broader formation history. OVR-close matches fall within 40 rating points of the selected OVR difference. Venue adjustment is capped at ±1.</p>
    </details>` : ""}`;
}

export function matchupsView(model, state) {
  const adjusted = state.matchupsMetric === "adjusted";
  const rows = formationMatchups(model, state.club, state.picker.prior)
    .filter(row => !state.matchupsFormation || key(row.ourFormation) === key(state.matchupsFormation))
    .sort((left, right) => right.count - left.count);
  const adjustedCols = ["xG for", "xG against", "xG diff.", "OVR-adjusted", "Fallback", "Evidence weight", "Weighted score", "Attack vs club", "Defence vs club"];
  const resultCols = ["W–D–L", "Pts / match", "xG diff.", "OVR diff.", "Performance"];
  const body = rows.map(row => {
    const values = adjusted
      ? [format(row.xgFor), format(row.xgAgainst), format(row.xgDiff, true), format(row.adjusted, true), format(row.fallback, true),
        Math.round(100 * row.weight) + "%", format(row.weighted, true), format(row.attack, true), format(row.defence, true)]
      : [row.wins + "–" + row.draws + "–" + row.losses, format(row.ppg), format(row.xgDiff, true), format(row.ovrDiff, true), format(row.performance, true)];
    return `<tr><th scope="row">${escape(row.club)}</th><td>${escape(row.ourFormation)}</td><td>${escape(row.oppFormation)}</td>
      <td><button class="text-button" data-action="cell" data-our="${escape(row.ourFormation)}" data-opp="${escape(row.oppFormation)}" data-club="${escape(row.club)}"
      aria-label="${escape(row.club + ", " + row.ourFormation + " vs " + row.oppFormation + ", " + row.count + " matches")}">${row.count}</button></td>
      ${values.map(value => "<td>" + value + "</td>").join("")}<td>${confidence(row.evidence)}</td></tr>`;
  }).join("");
  return `<section class="panel">
      <div class="panel-heading">
        <div><h2>Formation matchups</h2><p class="heading-meta">${rows.length} observed formation pairs</p></div>
        <div class="field-row">
          ${select("club", "Club", clubOptions(), state.club)}
          ${select("matchupsFormation", "Our formation", [["", "All formations"], ...model.ourFormations], state.matchupsFormation)}
          ${select("matchupsMetric", "Analysis", [["results", "Results"], ["adjusted", "Adjusted xG"]], state.matchupsMetric)}
        </div>
      </div>
      ${rows.length ? `<div class="table-scroll tall" tabindex="0" role="region" aria-label="Formation matchup records">
        <table class="data-table"><thead><tr><th>Club</th><th>Our formation</th><th>Opponent formation</th><th>Played</th>
          ${(adjusted ? adjustedCols : resultCols).map(label => "<th>" + label + "</th>").join("")}
          <th>Evidence</th></tr></thead><tbody>${body}</tbody></table>
      </div>` : empty("No formation pairs match the selected filters.")}
    </section>
    <details class="method"${adjusted ? " open" : ""}>
      <summary>OVR and evidence model</summary>
      <p>Fit across ${model.rows.length} matches. xG intercept ${model.intercept.toFixed(4)}. OVR slope ${model.slope.toFixed(5)} per rating point. Prior matches ${state.picker.prior}.</p>
      <p>Evidence weight is matches played divided by matches played plus prior matches. The weighted score combines adjusted xG with the broader formation baseline.</p>
    </details>`;
}

export function resultBadge(result) {
  const labels = { W: "Win", D: "Draw", L: "Loss" };
  return `<span class="result ${result.toLowerCase()}" aria-label="${labels[result]}">${result}</span>`;
}

export const MATCH_HEADERS = "<th>Date / Competition</th><th>Club / Venue</th><th>Opponent</th><th>Score</th><th>Formations</th><th>xG for / against</th><th>OVR diff.</th>";

export function matchCells(row, linkOpponent = false) {
  const opponent = escape(row.opponent);
  const opponentCell = linkOpponent
    ? `<button class="text-button" data-action="match" data-id="${row.id}">${opponent}</button>`
    : opponent;
  return `
    <td>${displayDate(row.date)}<small>${escape(row.competition || "—")}</small></td>
    <td>${escape(row.club)}<small>${row.venue}</small></td>
    <th scope="row">${opponentCell}</th>
    <td>${resultBadge(row.result)} <b>${row.gf}–${row.ga}</b></td>
    <td>${escape(row.ourFormation)}<small>vs ${escape(row.oppFormation)}</small></td>
    <td>${format(row.xgFor)} / ${format(row.xgAgainst)}</td>
    <td>${format(row.ovrDiff, true)}</td>`;
}

function filterMatches(rows, state) {
  const { matchesClub, competition, matchesVenue, query, matchPair } = state;
  return rows.filter(row =>
    (!matchesClub || row.club === matchesClub)
    && (!competition || row.competition === competition)
    && (!matchesVenue || row.venue === matchesVenue)
    && (!matchPair || pairKey(row.ourFormation, row.oppFormation) === pairKey(matchPair.our, matchPair.opp))
    && (!query || key([row.club, row.opponent, row.competition, row.date, row.ourFormation, row.oppFormation, row.reference].join(" ")).includes(key(query)))
  ).sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id);
}

export function matchesView(model, state) {
  const filtered = filterMatches(model.rows, state);
  const competitions = [...new Set(model.rows.map(row => row.competition).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en-GB"));
  const page = Math.min(state.page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const start = page * PAGE_SIZE;
  const body = filtered.slice(start, start + PAGE_SIZE).map(row => `<tr>${matchCells(row, true)}
    <td><button class="remove-button" data-action="remove" data-id="${row.id}" aria-label="${escape("Remove " + row.club + " vs " + row.opponent + ", " + displayDate(row.date))}">Remove</button></td>
  </tr>`).join("");
  return `<section class="panel">
      <div class="panel-heading">
        <div><h2>Matches</h2><p class="heading-meta" role="status">${filtered.length} ${filtered.length === 1 ? "match" : "matches"}${filtered.length !== model.rows.length ? " of " + model.rows.length : ""}</p></div>
        <div class="field-row">
          ${select("matchesClub", "Club", clubOptions(), state.matchesClub)}
          ${select("competition", "Competition", [["", "All competitions"], ...competitions], state.competition)}
          ${select("matchesVenue", "Venue", [["", "Either"], "Home", "Away"], state.matchesVenue)}
          <form class="search-form" id="match-search"><label class="field">Search matches<input name="search" type="search" value="${escape(state.query)}" placeholder="Club, opponent or date"></label><button class="button secondary">Search</button></form>
        </div>
      </div>
      ${state.matchPair ? `<div class="filter-tag">${escape(state.matchPair.our)} vs ${escape(state.matchPair.opp)} <button class="text-button" data-action="clear-pair">Clear matchup filter</button></div>` : ""}
      ${body ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Recorded matches">
        <table class="data-table matches-table"><thead><tr>${MATCH_HEADERS}<th>Actions</th></tr></thead><tbody>${body}</tbody></table>
      </div>
      <div class="table-footer pager"><span>${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} matches</span><div class="page-actions">
        <button class="button" data-action="page" data-page="${page - 1}" ${page === 0 ? "disabled" : ""}>Previous</button>
        <button class="button" data-action="page" data-page="${page + 1}" ${start + PAGE_SIZE >= filtered.length ? "disabled" : ""}>Next</button>
      </div></div>` : empty(model.rows.length ? "No matches fit the selected filters." : "Use Import matches to add your first results.")}
    </section>`;
}
