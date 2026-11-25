import {
  ATTRIBUTES, MATCH_PAGE_SIZE, POSITIONS, SAMPLE_WALLET, club, clubPlayers,
  clubMatches, clubMatchStats, experienceHistory, matchPage, normaliseAddress, number, player, readable,
  recentProgressionSources, walletClubs, walletPlayers, walletProgression,
} from "./mfl.js";
import { connectWallet, disconnectWallet, watchWallet } from "./wallet.js";

const main = document.querySelector("#main");
const walletDialog = document.querySelector("#wallet-dialog");
const walletInput = document.querySelector("#wallet-address");
const walletError = document.querySelector("#wallet-error");
const announcement = document.querySelector("#announcement");
const storageKey = "touchline-active-wallet-v1";
const pageSize = 18;
const clubMatchPageSize = 5;
const clubMatchRefreshMs = 5 * 60 * 1000;
const recentProgressionRefreshMs = 5 * 60 * 1000;
const clubSections = { results: "Results", schedule: "Upcoming matches", roster: "Roster" };
const numberFormat = new Intl.NumberFormat();
const xgFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat(undefined, { style: "percent" });
const dateFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const kickoffDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const kickoffTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const chartDate = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
const escapeChars = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const resources = new Map();
const filters = new Map();
const gainFields = [{ key: "overall", title: "Overall", short: "OVR" }, ...ATTRIBUTES];
let wallet = restoreChoice();
let connectedAddress = "";
let connecting = false;
let watchingWallet = false;
let chartObserver;

function restoreChoice() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    const address = normaliseAddress(stored?.address);
    if (address && stored.mode !== "sample") return { address, mode: stored.mode === "connected" ? "connected" : "manual" };
  } catch {}
  return { address: SAMPLE_WALLET, mode: "sample" };
}

function chooseWallet(address, mode) {
  wallet = { address, mode };
  try { localStorage.setItem(storageKey, JSON.stringify(wallet)); } catch {}
  filters.clear();
  if (walletDialog.open) walletDialog.close();
  if (getRoute().id) window.location.hash = "#/players";
  else render();
  announcement.textContent = mode === "sample" ? "Viewing sample wallet" : "Viewing wallet " + address;
}

function getRoute() {
  const [section, id, view, ...extra] = window.location.hash.replace(/^#\/?/, "").split("/");
  if (id && /^\d+$/.test(id) && !extra.length) {
    if (section === "players" && !view) return { section, id };
    if (section === "clubs" && (!view || Object.hasOwn(clubSections, view))) return { section, id, view: view || "roster" };
  }
  if (section === "clubs" || section === "progression") return { section };
  return { section: "players" };
}

function resource(key, load, maxAge = Infinity, cache = resources) {
  const cached = cache.get(key);
  if (cached?.status === "ready" && Date.now() - cached.loadedAt >= maxAge) cache.delete(key);
  if (!cache.has(key)) {
    const entry = { key, status: "loading" };
    cache.set(key, entry);
    Promise.resolve().then(load).then(value => {
      entry.status = "ready";
      entry.value = value;
      entry.loadedAt = Date.now();
    }).catch(error => {
      entry.status = "error";
      entry.error = error.message || "We couldn't load this data.";
    }).finally(() => {
      if (cache.get(key) === entry) render(true);
    });
  }
  return cache.get(key);
}

function filterFor(scope) {
  if (!filters.has(scope)) filters.set(scope, { query: "", position: "", sort: "rating", field: "overall", page: 0 });
  return filters.get(scope);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => escapeChars[char]);
}

function icon(name) {
  return `<span class="icon" aria-hidden="true">${name}</span>`;
}

function shortAddress(address) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

function showNumber(value) {
  return value === null || value === undefined ? "—" : numberFormat.format(value);
}

function formatDate(value) {
  return value ? dateFormat.format(value) : "—";
}

function showGain(value) {
  if (value === null) return "—";
  return `<span class="${value > 0 ? "delta" : value < 0 ? "negative" : ""}">${value > 0 ? "+" : ""}${showNumber(value)}</span>`;
}

function walletStrip() {
  const label = wallet.mode === "sample" ? "Sample wallet" : wallet.address === connectedAddress ? "Connected wallet" : "Wallet address";
  return `<div class="wallet-strip">
    <span class="wallet-pill">${icon("account_balance_wallet")}${label}<span class="wallet-id" title="${esc(wallet.address)}">${shortAddress(wallet.address)}</span></span>
    <button class="text-button hero-link" type="button" data-action="wallet">Change wallet</button>
  </div>`;
}

function pageHero(title, description) {
  return `<section class="hero"><div class="hero-content"><h1>${title}</h1><p>${description}</p>${walletStrip()}</div></section>`;
}

function metric(label, value, symbol, detail = "") {
  return `<div class="metric">
    <span class="metric-icon">${icon(symbol)}</span><span class="metric-label">${esc(label)}</span>
    <strong class="metric-value number">${value}</strong>
    ${detail ? `<p class="metric-detail">${esc(detail)}</p>` : ""}
  </div>`;
}

function notice(title, message, options = {}) {
  const retry = options.retry
    ? `<button class="button" type="button" data-action="retry" data-key="${esc(options.retry)}">Try again</button>`
    : "";
  return `<div class="notice">${icon(options.symbol || "info")}<h3>${esc(title)}</h3><p>${esc(message)}</p>${retry}</div>`;
}

function loadError(entry, title) {
  return notice(title, entry.error, { retry: entry.key, symbol: "cloud_off" });
}

function loading(label, rows = 4) {
  return `<div role="status" aria-label="${esc(label)}">${"<div class='loading-row' aria-hidden='true'><span></span></div>".repeat(rows)}</div>`;
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map(word => word[0] || "").join("");
}

function portrait(person) {
  return `<span class="portrait"><span aria-hidden="true">${esc(initials(person.name))}</span>
    <img src="${esc(person.photo)}" alt="" loading="lazy" decoding="async"></span>`;
}

function positions(person) {
  if (!person.positions.length) return "—";
  return `<span class="position-tags">${person.positions.map((position, index) =>
    `<span class="position-tag ${index ? "secondary-position" : "primary-position"}">${esc(position)}</span>`
  ).join("")}</span>`;
}

function rating(value, label = "") {
  if (value === null) return "—";
  const tier = value >= 85 ? "elite" : value >= 75 ? "high" : "";
  return `<span class="rating ${tier}">${showNumber(value)}${label}</span>`;
}

function playerName(person) {
  return `<a class="player-name" href="#/players/${person.id}">
    ${portrait(person)}<span><span class="name-text">${esc(person.name)}</span>
    <span class="name-meta">#${person.id}${person.retirement === 0 ? " · Retired" : ""}</span></span>
  </a>`;
}

function selectBox(id, label, options, value, scope, setting) {
  return `<label class="select-box"><span class="visually-hidden">${esc(label)}</span>
    <select id="${id}" data-scope="${scope}" data-filter="${setting}">
      ${options.map(([key, text]) => `<option value="${esc(key)}"${key === value ? " selected" : ""}>${esc(text)}</option>`).join("")}
    </select>${icon("expand_more")}</label>`;
}

function searchBox(id, scope, label, value) {
  return `<label class="search-box">${icon("search")}<span class="visually-hidden">${esc(label)}</span>
    <input id="${id}" type="search" data-scope="${scope}" data-filter="query" placeholder="${esc(label)}" value="${esc(value)}" autocomplete="off">
  </label>`;
}

function pagination(total, page, scope, size = pageSize) {
  if (total <= size) return "";
  const start = page * size + 1;
  const end = Math.min(total, (page + 1) * size);
  return `<div class="table-footer">
    <span>${showNumber(start)}–${showNumber(end)} of ${showNumber(total)}</span>
    <div class="page-actions">
      <button class="button" type="button" data-action="page" data-scope="${scope}" data-step="-1"${page === 0 ? " disabled" : ""}>Previous</button>
      <button class="button" type="button" data-action="page" data-scope="${scope}" data-step="1"${end === total ? " disabled" : ""}>Next</button>
    </div>
  </div>`;
}

function sortByRating(a, b) {
  return (b.overall ?? -1) - (a.overall ?? -1) || a.name.localeCompare(b.name);
}

function matchesSearch(person, query) {
  const term = query.trim().toLowerCase().replace(/^#/, "");
  return person.name.toLowerCase().includes(term) || person.id.includes(term);
}

function playerList(players, scope, title, emptyMessage) {
  const state = filterFor(scope);
  const sorted = players.filter(person => matchesSearch(person, state.query) && (!state.position || person.positions.includes(state.position)));
  if (state.sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (state.sort === "youngest") sorted.sort((a, b) => (a.age ?? Infinity) - (b.age ?? Infinity) || sortByRating(a, b));
  else sorted.sort(sortByRating);
  const visible = sorted.slice(state.page * pageSize, (state.page + 1) * pageSize);
  const attrs = ATTRIBUTES.filter(attribute => attribute.key !== "goalkeeping");
  return `<section class="panel" aria-label="${esc(title)}">
    <div class="panel-heading">
      <div><h2>${esc(title)}</h2><p class="heading-meta" role="status">${showNumber(sorted.length)} ${sorted.length === 1 ? "player" : "players"}</p></div>
      ${players.length ? `<div class="filters">
        ${searchBox("players-search", scope, "Search player or ID", state.query)}
        ${selectBox("players-position", "Filter by position", [["", "All positions"], ...POSITIONS.map(pos => [pos, pos])], state.position, scope, "position")}
        ${selectBox("players-sort", "Sort players", [["rating", "Highest OVR"], ["name", "Name A–Z"], ["youngest", "Youngest"]], state.sort, scope, "sort")}
      </div>` : ""}
    </div>
    ${visible.length ? `<div class="table-scroll" tabindex="0" aria-label="Player list">
      <table class="data-table">
        <caption class="visually-hidden">${esc(title)}</caption>
        <thead><tr><th scope="col">Player</th><th scope="col">Position</th><th class="stat-col" scope="col">Age</th><th class="stat-col" scope="col">OVR</th>
          ${attrs.map(({ short, title }) => `<th class="stat-col desktop-col" scope="col" title="${title}">${short}</th>`).join("")}
        </tr></thead>
        <tbody>${visible.map(person => `<tr>
          <td>${playerName(person)}</td><td>${positions(person)}</td><td class="stat-col">${showNumber(person.age)}</td><td class="stat-col">${rating(person.overall)}</td>
          ${attrs.map(({ key }) => `<td class="stat-col desktop-col attribute-number">${showNumber(person.attributes[key])}</td>`).join("")}
        </tr>`).join("")}</tbody>
      </table></div>
      ${pagination(sorted.length, state.page, scope)}`
    : notice(players.length ? "No matching players" : "No players found", players.length ? "Try another name, ID or position." : emptyMessage, { symbol: "groups" })}
  </section>`;
}

function renderPlayers() {
  const entry = resource("wallet-players:" + wallet.address, () => walletPlayers(wallet.address));
  const hero = pageHero("Players", "Explore the players owned by a Flow wallet.");
  if (entry.status !== "ready") return hero + `<section class="panel section-gap">${entry.status === "loading" ? loading("Loading MFL players") : loadError(entry, "Players couldn't be loaded")}</section>`;
  const roster = entry.value;
  const rated = roster.filter(person => person.overall !== null).sort(sortByRating);
  const best = rated[0];
  const average = rated.length ? (rated.reduce((sum, person) => sum + person.overall, 0) / rated.length).toFixed(1) : "—";
  return hero + `<div class="metric-grid" aria-label="Player pool summary">
    ${metric("Players owned", showNumber(roster.length), "groups")}
    ${metric("Average OVR", average, "bar_chart")}
    ${metric("Highest OVR", showNumber(best?.overall), "military_tech", best?.name)}
  </div>` + playerList(roster, "players", "Player pool", "This wallet has no players listed by MFL.");
}

function clubMark(team) {
  return `<span class="club-mark" style="--club-accent:${team.accent}">
    ${icon("shield")}${team.logo ? `<img src="${esc(team.logo)}" alt="" loading="lazy" decoding="async">` : ""}
  </span>`;
}

function locationName(team) {
  return [team.city, team.country].filter(Boolean).join(", ");
}

function divisionName(team) {
  return team.type === "Arena" ? "Arena" : team.division ? "Division " + team.division : "Pro";
}

function clubCard(team) {
  return `<article class="club-card" style="--club-accent:${team.accent}">
    <div class="club-identity">${clubMark(team)}<div><h3>${esc(team.name)}</h3>
      <p class="club-location">${esc(locationName(team) || divisionName(team))}</p></div></div>
    <div class="club-stats">
      <div><span>Competition</span><strong>${esc(divisionName(team))}</strong></div>
      <div><span>Players</span><strong class="number">${showNumber(team.count)}</strong></div>
    </div>
    <div class="club-card-actions">
      <a class="button club-matches-link" href="#/clubs/${team.id}/results" aria-label="View matches for ${esc(team.name)}">View matches</a>
      <a class="button roster-link" href="#/clubs/${team.id}" aria-label="View roster for ${esc(team.name)}">View roster</a>
    </div>
  </article>`;
}

function renderClubs() {
  const entry = resource("wallet-clubs:" + wallet.address, () => walletClubs(wallet.address));
  const hero = pageHero("Clubs", "Browse owned clubs, match results, fixtures and rosters.");
  if (entry.status !== "ready") return hero + `<section class="panel section-gap">${entry.status === "loading" ? loading("Loading MFL clubs") : loadError(entry, "Clubs couldn't be loaded")}</section>`;
  const all = entry.value;
  if (!all.length) return hero + `<section class="panel section-gap">${notice("No owned clubs", "MFL has no clubs registered to this wallet.", { symbol: "shield" })}</section>`;
  const state = filterFor("clubs");
  const teams = all.filter(team => (team.name + " " + locationName(team)).toLowerCase().includes(state.query.trim().toLowerCase()));
  teams.sort((a, b) => (a.division ?? 99) - (b.division ?? 99) || a.name.localeCompare(b.name));
  const topDivision = Math.min(...all.filter(team => team.division > 0).map(team => team.division));
  return hero + `<div class="metric-grid" aria-label="Club summary">
    ${metric("Clubs owned", showNumber(all.length), "shield")}
    ${metric("Pro clubs", showNumber(all.filter(team => team.type === "Pro").length), "sports_soccer")}
    ${metric("Highest division", Number.isFinite(topDivision) ? showNumber(topDivision) : "—", "emoji_events")}
  </div>
  <section aria-labelledby="owned-clubs-title">
    <div class="section-heading"><h2 id="owned-clubs-title">Owned clubs</h2>${searchBox("clubs-search", "clubs", "Search clubs", state.query)}</div>
    ${teams.length ? `<div class="club-grid">${teams.map(clubCard).join("")}</div>` :
      `<div class="panel">${notice("No matching clubs", "Try another club or city name.", { symbol: "search" })}</div>`}
  </section>`;
}

function getGain(changes, field) {
  return changes && typeof changes === "object" ? number(changes[field]) ?? 0 : null;
}

function gainBars(rows, field) {
  const ranked = rows.filter(row => getGain(row.changes, field) > 0);
  ranked.sort((a, b) => getGain(b.changes, field) - getGain(a.changes, field));
  const top = ranked.slice(0, 5);
  if (!top.length) return notice("No gains recorded", "Select another attribute to explore the progression MFL has recorded.", { symbol: "show_chart" });
  const maximum = getGain(top[0].changes, field);
  return `<div class="bars">${top.map(({ person, changes }) => {
    const value = getGain(changes, field);
    return `<div class="bar-row"><a class="inline-link" href="#/players/${person.id}">${esc(person.name)}</a>
      <div class="bar-track" aria-hidden="true"><span class="bar-fill" style="--bar-width:${value / maximum * 100}%"></span></div>
      <strong class="bar-value delta">+${showNumber(value)}</strong></div>`;
  }).join("")}</div>`;
}

async function loadProgressionSources(rows, checkedAt) {
  const sources = new Map();
  const concurrency = 4;
  for (let index = 0; index < rows.length; index += concurrency) {
    const batch = rows.slice(index, index + concurrency);
    const histories = await Promise.allSettled(batch.map(({ person }) => experienceHistory(person.id)));
    for (const [offset, history] of histories.entries()) {
      const { person, changes } = batch[offset];
      if (history.status === "fulfilled") sources.set(person.id, recentProgressionSources(history.value, changes, checkedAt));
    }
  }
  return sources;
}

function progressionSourceList(gains, recorded = []) {
  const sources = recorded.filter(source => source.reason);
  const attributed = new Set(sources.flatMap(source => source.fields));
  const unavailable = gains.filter(field => !attributed.has(field.key));
  return `<ul class="progression-sources">${sources.map(source => `<li>
    <strong>${esc(readable(source.reason))}</strong><span>${gains.filter(field => source.fields.includes(field.key)).map(field => field.short).join(", ")}</span>
  </li>`).join("")}${unavailable.length ? `<li><strong>Source unavailable</strong><span>${unavailable.map(field => field.short).join(", ")}</span></li>` : ""}</ul>`;
}

function recentProgressionPanel(address, players) {
  const scope = "recent-progression";
  const summary = resource(scope + ":" + address, async () => ({
    changes: await walletProgression(address, "24H"), sourcePages: new Map(),
  }), recentProgressionRefreshMs);
  const error = [players, summary].find(entry => entry.status === "error");
  let rows = [];
  let sources;
  let body;
  if (error) body = loadError(error, "Recent progression couldn't be loaded");
  else if (players.status !== "ready" || summary.status !== "ready") body = loading("Loading progression for the last 24 hours");
  else {
    rows = players.value.map(person => {
      const changes = summary.value.changes[person.id];
      return { person, changes, gains: gainFields.filter(field => getGain(changes, field.key) > 0) };
    }).filter(row => row.gains.length);
    rows.sort((a, b) => getGain(b.changes, "overall") - getGain(a.changes, "overall") || sortByRating(a.person, b.person));

    if (!rows.length) body = notice("No progression gains in the last 24 hours", "", { symbol: "show_chart" });
    else {
      const page = Math.min(filterFor(scope).page, Math.ceil(rows.length / pageSize) - 1);
      filterFor(scope).page = page;
      const visible = rows.slice(page * pageSize, (page + 1) * pageSize);
      const key = visible.map(row => row.person.id).join(",");
      sources = resource(key, () => loadProgressionSources(visible, summary.loadedAt), Infinity, summary.value.sourcePages);
      body = `<div class="table-scroll" tabindex="0" aria-label="Player gains in the last 24 hours">
        <table class="data-table progression-recent-table">
          <caption class="visually-hidden">Positive rating changes in the last 24 hours and their sources</caption>
          <thead><tr><th scope="col">Player</th><th scope="col">Gains</th><th scope="col">Source</th></tr></thead>
          <tbody>${visible.map(({ person, changes, gains }) => `<tr><td>${playerName(person)}</td>
            <td><div class="progression-gains">${gains.map(field => `<span class="delta number">+${showNumber(getGain(changes, field.key))} ${field.short}</span>`).join("")}</div></td>
            <td>${sources.status === "loading" ? '<span class="muted">Checking source…</span>' : progressionSourceList(gains, sources.value?.get(person.id))}</td>
          </tr>`).join("")}</tbody>
        </table></div>${pagination(rows.length, page, scope)}`;
    }
  }
  const checking = summary.status === "loading" || sources?.status === "loading";
  return `<section class="panel section-gap" aria-labelledby="recent-progression-title">
    <div class="panel-heading"><div><h2 id="recent-progression-title">Last 24 hours</h2>
      ${rows.length ? `<p class="heading-meta" role="status">${showNumber(rows.length)} ${rows.length === 1 ? "player" : "players"} with gains</p>` : ""}
    </div><button id="recent-progression-refresh" class="button" type="button" data-action="retry" data-key="${esc(summary.key)}" aria-label="Refresh recent progression"${checking ? " disabled" : ""}>Refresh</button></div>
    ${body}
  </section>`;
}

function renderProgression() {
  const address = wallet.address;
  const players = resource("wallet-players:" + address, () => walletPlayers(address));
  const progression = resource("wallet-progression:" + address, () => walletProgression(address));
  const hero = pageHero("Progression", "Track recent and all-time attribute gains across the wallet’s players.");
  const overview = hero + recentProgressionPanel(address, players);
  const error = [players, progression].find(entry => entry.status === "error");
  if (error) return overview + `<section class="panel section-gap">${loadError(error, "All-time progression couldn't be loaded")}</section>`;
  if (players.status === "loading" || progression.status === "loading") return overview + `<section class="panel section-gap">${loading("Loading all-time MFL progression")}</section>`;
  if (!players.value.length) return overview + `<section class="panel section-gap">${notice("No players found", "Choose a wallet with players to view progression.", { symbol: "groups" })}</section>`;
  const rows = players.value.map(person => ({ person, changes: progression.value[person.id] }));
  const state = filterFor("progression");
  const allGains = rows.map(row => getGain(row.changes, "overall")).filter(value => value !== null);
  const average = allGains.length ? Number((allGains.reduce((sum, value) => sum + value, 0) / allGains.length).toFixed(1)) : null;
  const best = allGains.length ? Math.max(...allGains) : null;
  const filtered = rows.filter(row => matchesSearch(row.person, state.query));
  filtered.sort((a, b) => (getGain(b.changes, state.field) ?? -Infinity) - (getGain(a.changes, state.field) ?? -Infinity) || sortByRating(a.person, b.person));
  const visible = filtered.slice(state.page * pageSize, (state.page + 1) * pageSize);
  const columns = [...gainFields.filter(field => field.key !== state.field)];
  const activeField = gainFields.find(field => field.key === state.field);
  return overview + `<div class="metric-grid" aria-label="Progression summary">
    ${metric("Players with OVR gains", showNumber(allGains.filter(value => value > 0).length), "trending_up")}
    ${metric("Average OVR gain", showGain(average), "bar_chart")}
    ${metric("Biggest OVR gain", showGain(best), "military_tech")}
  </div>
  <section class="panel" aria-label="Top attribute gains">
    <div class="panel-heading"><div><h2>Top gains</h2><p class="heading-meta">All-time ${activeField.title.toLowerCase()} gains</p></div>
      ${selectBox("gain-field", "Attribute to compare", gainFields.map(field => [field.key, field.title]), state.field, "progression", "field")}
    </div>${gainBars(rows, state.field)}
  </section>
  <section class="panel" aria-label="Player progression">
    <div class="panel-heading"><div><h2>Player progression</h2><p role="status" class="heading-meta">${showNumber(filtered.length)} ${filtered.length === 1 ? "player" : "players"}</p></div>
      ${searchBox("progression-search", "progression", "Search player or ID", state.query)}
    </div>
    ${visible.length ? `<div class="table-scroll" tabindex="0" aria-label="Player attribute gains">
      <table class="data-table">
        <caption class="visually-hidden">All-time player attribute gains</caption>
        <thead><tr><th scope="col">Player</th><th class="stat-col" scope="col">OVR</th>
          <th scope="col" class="stat-col">Δ ${activeField.short}</th>
          ${columns.map(field => `<th scope="col" class="stat-col desktop-col" title="${field.title} change">Δ ${field.short}</th>`).join("")}
        </tr></thead>
        <tbody>${visible.map(({ person, changes }) => `<tr><td>${playerName(person)}</td><td class="stat-col">${rating(person.overall)}</td>
          <td class="stat-col">${showGain(getGain(changes, state.field))}</td>
          ${columns.map(({ key }) => `<td class="stat-col desktop-col">${showGain(getGain(changes, key))}</td>`).join("")}
        </tr>`).join("")}</tbody>
      </table></div>${pagination(filtered.length, state.page, "progression")}` :
      notice("No matching players", "Try another player name or ID.", { symbol: "search" })}
  </section>`;
}

function breadcrumb(label, destination, current) {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">
    <a class="inline-link" href="${destination}">${label}</a>${icon("chevron_right")}
    <span aria-current="page">${esc(current)}</span>
  </nav>`;
}

function clubNavigation(id, active) {
  return `<nav class="club-navigation section-nav" aria-label="Club sections">
    ${Object.entries(clubSections).map(([view, label]) => {
      const path = "#/clubs/" + id + (view === "roster" ? "" : "/" + view);
      return `<a href="${path}"${view === active ? ' aria-current="page"' : ""}>${label}</a>`;
    }).join("")}
  </nav>`;
}

function matchSide(side, venue) {
  const mark = side.club ? clubMark(side.club) : `<span class="club-mark">${icon("shield")}</span>`;
  return `<div class="club-match-side">
    ${mark}<div><span class="match-venue">${venue}</span><strong>${esc(side.name)}</strong></div>
  </div>`;
}

function matchScore(match) {
  if (match.home.score === null || match.away.score === null) return "—";
  return `${match.home.score}<span>–</span>${match.away.score}`;
}

function matchOutcome(match, clubId) {
  if (match.status !== "ENDED") return readable(match.status);
  const venue = match.home.club?.id === clubId ? "home" : match.away.club?.id === clubId ? "away" : "";
  if (!venue || match.home.score === null || match.away.score === null) return "Final";
  const difference = (match.home.score - match.away.score) * (venue === "home" ? 1 : -1);
  return difference > 0 ? "Win" : difference < 0 ? "Loss" : "Draw";
}

function matchStatTable(match) {
  const entry = resource("match-stats:" + match.id, () => clubMatchStats(match.id));
  const stats = entry.value;
  const fields = [
    ["overall", "XI OVR", showNumber],
    ["xG", "Expected goals (xG)", value => value == null ? "—" : xgFormat.format(value)],
    ["possession", "Possession (est.)", value => value == null ? "—" : percentFormat.format(value / 100)],
    ["shots", "Shots", showNumber],
    ["shotsOnTarget", "Shots on target", showNumber],
  ];
  return `<div class="club-match-stats" aria-busy="${entry.status === "loading"}">
    <table aria-label="Match stats for ${esc(match.home.name)} and ${esc(match.away.name)}">
      <thead class="visually-hidden"><tr><th scope="col">Home</th><th scope="col">Stat</th><th scope="col">Away</th></tr></thead>
      <tbody>${fields.map(([key, label, format]) => `<tr data-stat="${key}">
        <td>${format(stats?.home[key])}</td><th scope="row">${label}</th><td>${format(stats?.away[key])}</td>
      </tr>`).join("")}</tbody>
    </table>
    ${entry.status === "loading" ? '<p class="club-match-note" role="status">Loading match stats…</p>' : ""}
    ${stats?.retryable || entry.status === "error" ? `<p class="club-match-note">Some stats could not be loaded.
      <button class="text-button" type="button" data-action="retry" data-key="${entry.key}">Retry stats</button></p>` : ""}
  </div>`;
}

function clubMatchCard(match, clubId, upcoming) {
  const live = match.status === "LIVE";
  const label = upcoming ? (live ? "Live" : "Scheduled") : matchOutcome(match, clubId);
  const date = match.date ? `<time datetime="${new Date(match.date).toISOString()}">${kickoffDate.format(match.date)}</time>` : "Date to be confirmed";
  const middle = upcoming && !live
    ? `<span class="club-kickoff">${match.date ? kickoffTime.format(match.date) : "TBC"}</span>`
    : `<strong class="club-match-score">${matchScore(match)}</strong>`;
  return `<li class="club-match-card${upcoming ? " is-fixture" : ""}">
    <div class="club-match-meta">
      <div>${date}${match.competition ? `<span>${esc(match.competition)}</span>` : ""}</div>
      ${label ? `<span class="match-outcome" data-outcome="${esc(label.toLowerCase())}">${esc(label)}</span>` : ""}
    </div>
    <div class="club-match-scoreline">${matchSide(match.home, "Home")}${middle}${matchSide(match.away, "Away")}</div>
    ${upcoming ? "" : matchStatTable(match)}
  </li>`;
}

function clubMatchPanel(id, view, detail) {
  const upcoming = view === "schedule";
  const title = clubSections[view];
  const description = upcoming
    ? "Kickoff times are shown in your local time."
    : "XI OVR is the starting lineup’s total rating at kickoff. Possession is estimated from each team’s share of total passes.";
  const heading = `<div class="panel-heading"><div><h2>${title}</h2><p class="heading-meta">${description}</p></div></div>`;
  let body;
  if (detail.status === "error") {
    body = loadError(detail, "Club details couldn't be loaded");
  } else if (detail.status === "loading") {
    body = loading("Loading club details");
  } else {
    const scope = "club-" + view + ":" + id;
    const entry = resource(scope, () => clubMatches(detail.value.squadIds, upcoming), clubMatchRefreshMs);
    if (entry.status === "error") body = loadError(entry, upcoming ? "Schedule couldn't be loaded" : "Results couldn't be loaded");
    else if (entry.status === "loading") body = loading(upcoming ? "Loading upcoming matches" : "Loading results");
    else if (!entry.value.length) {
      body = upcoming
        ? notice("No upcoming matches", "MFL has no fixtures scheduled for this club.", { symbol: "calendar_month" })
        : notice("No match results", "MFL has no finished matches for this club.", { symbol: "sports_soccer" });
    } else {
      const state = filterFor(scope);
      const page = Math.min(state.page, Math.ceil(entry.value.length / clubMatchPageSize) - 1);
      state.page = page;
      const visible = entry.value.slice(page * clubMatchPageSize, (page + 1) * clubMatchPageSize);
      body = `<ol class="club-match-list" tabindex="-1">${visible.map(match => clubMatchCard(match, id, upcoming)).join("")}</ol>
        ${pagination(entry.value.length, page, scope, clubMatchPageSize)}`;
    }
  }
  return `<section class="panel club-match-panel" aria-label="${title}">${heading}${body}</section>`;
}

function renderClub(id, view) {
  const savedTeams = resources.get("wallet-clubs:" + wallet.address)?.value;
  const known = savedTeams?.find(team => team.id === id);
  const detail = known && (view === "roster" || known.squadIds.length)
    ? { status: "ready", value: known } : resource("club:" + id, () => club(id));
  const team = detail.value || known;
  const title = team?.name || "Club " + id;
  const hero = breadcrumb("Clubs", "#/clubs", title) + `<section class="hero profile-hero profile-club ${team ? "has-portrait" : ""}">
    <div class="hero-content"><h1>${esc(title)}</h1>
      ${team ? `<p>${[locationName(team), divisionName(team)].filter(Boolean).map(esc).join(" · ")}</p>` : ""}
    </div>
    ${team ? `<div class="profile-picture">${clubMark(team)}</div>` : ""}
  </section>`;
  const header = hero + clubNavigation(id, view);
  if (view !== "roster") return header + clubMatchPanel(id, view, detail);
  const roster = resource("club-roster:" + id, () => clubPlayers(id));
  return header + (detail.status === "error" ? `<div class="panel section-gap">${loadError(detail, "Club details couldn't be loaded")}</div>` : "") +
    `<div class="club-roster">${roster.status === "ready" ? playerList(roster.value, "club-" + id, "Club roster", "MFL lists no players in this club’s roster.") :
      `<section class="panel">${roster.status === "loading" ? loading("Loading club roster") : loadError(roster, "Roster couldn't be loaded")}</section>`}
    </div>`;
}

function playerHint(id) {
  const currentRoster = resources.get("wallet-players:" + wallet.address)?.value;
  if (currentRoster) {
    const match = currentRoster.find(person => person.id === id);
    if (match) return match;
  }
  for (const [key, entry] of resources) {
    if (!key.startsWith("club-roster:")) continue;
    const match = entry.value?.find(person => person.id === id);
    if (match) return match;
  }
  return null;
}

function profileHero(person) {
  const label = person.retirement === 0 ? "Retired" : person.nationality;
  return `<section class="hero profile-hero has-portrait">
    <div class="hero-content">
      <h1>${esc(person.name)}</h1>
      <div class="profile-meta">${rating(person.overall, " OVR")}${positions(person)}
        ${label ? `<span>${esc(label)}</span>` : ""}<span class="wallet-id">#${person.id}</span>
      </div>
    </div><div class="profile-picture">${portrait(person)}</div>
  </section>`;
}

function attributesPanel(person) {
  const stats = ATTRIBUTES.filter(field => person.attributes[field.key] !== null);
  const facts = [
    ["Age", person.age === null ? "" : person.age + " years"],
    ["Height", person.height === null ? "" : person.height + " cm"],
    ["Preferred foot", person.foot],
    ["Nationality", person.nationality],
    ["Retirement", person.retirement === 0 ? "Retired" : person.retirement ? "In " + person.retirement + (person.retirement === 1 ? " season" : " seasons") : ""],
  ].filter(([, value]) => value);
  return `<section class="panel" aria-label="Player attributes">
    <div class="panel-heading"><h2>Attributes</h2></div>
    <div class="attr-list">${stats.map(field => {
      const value = person.attributes[field.key];
      return `<div class="attr-row"><strong title="${field.title}">${field.short}</strong>
        <div aria-hidden="true" class="bar-track"><span class="bar-fill" style="--bar-width:${Math.max(0, Math.min(100, value))}%"></span></div>
        <strong class="number">${showNumber(value)}</strong></div>`;
    }).join("")}</div>
    ${facts.length || person.club ? `<ul class="profile-facts">
      ${facts.map(([label, value]) => `<li><span>${label}</span><strong>${esc(value)}</strong></li>`).join("")}
      ${person.club ? `<li><span>Current club</span><a class="inline-link" href="#/clubs/${person.club.id}">${esc(person.club.name)}</a></li>` : ""}
    </ul>` : ""}
  </section>`;
}

function ovrPoints(events) {
  return events.flatMap(event => {
    const value = number(event.values.overall);
    return value === null ? [] : [{ date: event.date, value }];
  });
}

function describeEvent(event) {
  const stats = gainFields.flatMap(field => {
    const value = number(event.values[field.key]);
    return value === null ? [] : [field.short + " " + value];
  });
  const age = number(event.values.age);
  if (age !== null && event.reason !== "INITIAL") stats.push("Age " + age);
  return stats.join(" · ");
}

function historyPanel(entry) {
  let contents;
  if (entry.status === "loading") contents = loading("Loading progression history", 4);
  else if (entry.status === "error") contents = loadError(entry, "Progression history couldn't be loaded");
  else if (!entry.value.length) contents = notice("No history recorded", "MFL hasn’t recorded any progression updates for this player.", { symbol: "show_chart" });
  else {
    const history = entry.value;
    const points = ovrPoints(history);
    const improvement = points.length > 1 ? points.at(-1).value - points[0].value : null;
    contents = (points.length ? `<div class="chart-shell">
      <canvas role="img" aria-label="Overall rating over ${points.length} recorded dates" data-points="${esc(JSON.stringify(points))}"></canvas>
    </div><p class="chart-note">${points.length === 1 ? "One overall rating recorded." : `<strong>${showGain(improvement)} OVR</strong> across ${showNumber(points.length)} recorded overall ratings.`}</p>` : "") +
    `<details class="timeline"><summary>View ${showNumber(history.length)} history events</summary>
      <ol>${[...history].reverse().map(event => `<li>
        <time datetime="${new Date(event.date).toISOString()}">${formatDate(event.date)}</time>
        <span>${esc(event.reason === "INITIAL" ? "Entered MFL" : readable(event.reason) || "Update")}</span>
        <strong>${esc(describeEvent(event))}</strong>
      </li>`).join("")}</ol>
    </details>`;
  }
  return `<section class="panel" aria-label="Career progression">
    <div class="panel-heading"><div><h2>Career progression</h2><p class="heading-meta">Overall rating and recorded attribute changes</p></div></div>
    ${contents}
  </section>`;
}

function matchesPanel(entry, id) {
  const rows = entry.value?.rows || [];
  const heading = `<div class="panel-heading"><div><h2>Career match stats</h2>
    <p class="heading-meta">${rows.length ? (entry.value.cursor ? showNumber(rows.length) + " matches loaded" : showNumber(rows.length) + " recorded matches") : "Match history and results"}</p>
  </div></div>`;
  if (entry.status !== "ready") return `<section class="panel section-gap">${heading}${entry.status === "loading" ? loading("Loading match stats") : loadError(entry, "Match stats couldn't be loaded")}</section>`;
  if (!rows.length) return `<section class="panel section-gap">${heading}${notice("No match stats", "MFL has no match statistics for this player.", { symbol: "sports_soccer" })}</section>`;
  const ratings = rows.map(match => match.rating).filter(value => value !== null && value > 0);
  const average = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2) : "—";
  return `<section class="panel section-gap" aria-label="Career match stats">${heading}
    <div class="match-summary" aria-label="Totals across loaded matches">
      <div><span>Matches</span><strong>${showNumber(rows.length)}</strong></div>
      <div><span>Goals</span><strong>${showNumber(rows.reduce((sum, match) => sum + (match.goals ?? 0), 0))}</strong></div>
      <div><span>Assists</span><strong>${showNumber(rows.reduce((sum, match) => sum + (match.assists ?? 0), 0))}</strong></div>
      <div><span>Avg rating</span><strong>${average}</strong></div>
    </div>
    <div class="table-scroll" tabindex="0" aria-label="Player match history"><table class="data-table">
      <caption class="visually-hidden">Player match history</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Opponent</th><th scope="col" class="desktop-col">Competition</th><th scope="col" class="desktop-col">Position</th><th scope="col" class="stat-col desktop-col">Min</th><th scope="col" class="stat-col desktop-col">G</th><th scope="col" class="stat-col desktop-col">A</th><th scope="col" class="stat-col">Rating</th></tr></thead>
      <tbody>${rows.map(match => `<tr>
        <td>${formatDate(match.date)}</td><td>${esc(match.opponent || "—")}
          ${match.goalsFor !== null && match.goalsAgainst !== null ? `<span class="match-score">${match.goalsFor}–${match.goalsAgainst}</span>` : ""}
        </td>
        <td class="desktop-col">${esc(match.competition || "—")}</td><td class="desktop-col">${esc(match.position || "—")}</td>
        <td class="stat-col desktop-col">${showNumber(match.minutes)}</td><td class="stat-col desktop-col">${showNumber(match.goals)}</td><td class="stat-col desktop-col">${showNumber(match.assists)}</td>
        <td class="stat-col">${rating(match.rating)}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    ${entry.value.cursor ? `<div class="table-footer"><span>${showNumber(MATCH_PAGE_SIZE)} matches per request</span>
      <button class="button" type="button" data-action="earlier-matches" data-id="${id}" ${entry.loadingMore ? "disabled" : ""}>${entry.loadingMore ? "Loading…" : "Load earlier matches"}</button></div>` : ""}
    ${entry.pageError ? `<p class="match-state" role="alert">${esc(entry.pageError)}</p>` : ""}
  </section>`;
}

function renderPlayer(id) {
  const detail = resource("player:" + id, () => player(id));
  const history = resource("history:" + id, () => experienceHistory(id));
  const matches = resource("matches:" + id, () => matchPage(id));
  const person = detail.value || playerHint(id);
  const top = breadcrumb("Players", "#/players", person?.name || "Player " + id);
  if (!person) return top + `<section class="panel section-gap">${detail.status === "loading" ? loading("Loading player profile") : loadError(detail, "Player couldn't be loaded")}</section>`;
  const initial = history.value?.find(event => event.reason === "INITIAL")?.values;
  const startingAge = number(initial?.age);
  const seasons = startingAge !== null && person.age !== null ? Math.max(1, person.age - startingAge + 1) : null;
  const points = ovrPoints(history.value || []);
  const improvement = points.length > 1 ? points.at(-1).value - points[0].value : null;
  return top + profileHero(person) +
    (detail.status === "error" ? `<div class="panel section-gap">${loadError(detail, "Updated profile couldn't be loaded")}</div>` : "") +
    `<div class="metric-grid" aria-label="Player career summary">
      ${metric("Current OVR", showNumber(person.overall), "stars")}
      ${metric("Recorded OVR change", showGain(improvement), "trending_up")}
      ${metric("Seasons in MFL", showNumber(seasons), "calendar_month")}
    </div>
    <div class="profile-columns">${historyPanel(history)}${attributesPanel(person)}</div>
    ${matchesPanel(matches, id)}`;
}

function drawChart(canvas, points) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width) return;
  const width = bounds.width;
  const height = bounds.height;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const style = getComputedStyle(canvas);
  const accent = style.getPropertyValue("--lime").trim();
  ctx.scale(scale, scale);
  const frame = { left: 33, right: width - 15, top: 20, bottom: height - 32 };
  const timeStart = points[0].date;
  const timeEnd = points.at(-1).date;
  const values = points.map(point => point.value);
  const min = Math.max(0, Math.min(...values) - 2);
  const max = Math.max(min + 4, Math.max(...values) + 1);
  const x = date => timeEnd === timeStart ? (frame.left + frame.right) / 2 : frame.left + (date - timeStart) / (timeEnd - timeStart) * (frame.right - frame.left);
  const y = value => frame.bottom - (value - min) / (max - min) * (frame.bottom - frame.top);

  ctx.font = "12px Inter, sans-serif";
  ctx.fillStyle = style.getPropertyValue("--muted").trim();
  ctx.strokeStyle = style.getPropertyValue("--line-bright").trim();
  ctx.lineWidth = 1;
  ctx.textBaseline = "middle";
  const axisStep = Math.max(1, Math.ceil((max - min) / 4));
  for (let value = Math.ceil(min / axisStep) * axisStep; value <= max; value += axisStep) {
    ctx.beginPath();
    ctx.moveTo(frame.left, y(value));
    ctx.lineTo(frame.right, y(value));
    ctx.stroke();
    ctx.fillText(String(value), 8, y(value));
  }
  ctx.textBaseline = "top";
  if (timeStart === timeEnd) {
    ctx.textAlign = "center";
    ctx.fillText(chartDate.format(timeStart), x(timeStart), frame.bottom + 10);
  } else {
    const count = width < 380 ? 3 : 5;
    for (let index = 0; index < count; index++) {
      const date = timeStart + (timeEnd - timeStart) * index / (count - 1);
      ctx.textAlign = index === 0 ? "left" : index === count - 1 ? "right" : "center";
      ctx.fillText(chartDate.format(date), x(date), frame.bottom + 10);
    }
  }

  if (points.length > 1) {
    const gradient = ctx.createLinearGradient(0, frame.top, 0, frame.bottom);
    gradient.addColorStop(0, style.getPropertyValue("--chart-fill").trim());
    gradient.addColorStop(1, "transparent");
    ctx.beginPath();
    ctx.moveTo(x(timeStart), frame.bottom);
    for (const point of points) ctx.lineTo(x(point.date), y(point.value));
    ctx.lineTo(x(timeEnd), frame.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index) ctx.lineTo(x(point.date), y(point.value));
      else ctx.moveTo(x(point.date), y(point.value));
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  ctx.fillStyle = accent;
  for (const point of points) {
    ctx.beginPath();
    ctx.arc(x(point.date), y(point.value), points.length > 17 ? 2 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function render(preserveFocus = false) {
  const active = document.activeElement;
  const focusId = preserveFocus && main.contains(active) ? active.id : "";
  const selection = focusId && active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] : null;
  const openTimeline = main.querySelector(".timeline")?.open;
  const page = getRoute();
  for (const link of document.querySelectorAll("[data-nav]")) {
    if (link.dataset.nav === page.section) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  let view;
  if (page.section === "clubs") view = page.id ? renderClub(page.id, page.view) : renderClubs();
  else if (page.section === "progression") view = renderProgression();
  else view = page.id ? renderPlayer(page.id) : renderPlayers();
  chartObserver?.disconnect();
  main.innerHTML = view;
  if (openTimeline && preserveFocus) {
    const timeline = main.querySelector(".timeline");
    if (timeline) timeline.open = true;
  }
  const title = main.querySelector("h1")?.textContent;
  document.title = title ? title + " · Touchline" : "Touchline — MFL Wallet Explorer";
  const canvas = main.querySelector("canvas[data-points]");
  if (canvas) {
    const points = JSON.parse(canvas.dataset.points);
    drawChart(canvas, points);
    chartObserver = new ResizeObserver(() => drawChart(canvas, points));
    chartObserver.observe(canvas);
  }
  if (focusId) {
    const control = document.getElementById(focusId);
    control?.focus({ preventScroll: true });
    if (control instanceof HTMLInputElement && selection?.[0] !== null && selection) {
      control.setSelectionRange(...selection);
    }
  }
  updateWalletUi();
}

function changeFilter(event) {
  if (!event.target.matches("[data-filter]")) return;
  const state = filterFor(event.target.dataset.scope);
  state[event.target.dataset.filter] = event.target.value;
  state.page = 0;
  render(true);
}

function updateWalletUi() {
  const button = document.getElementById("wallet-button");
  button.querySelector("span:last-child").textContent = connecting ? "Connecting…" : connectedAddress ? shortAddress(connectedAddress) : "Connect wallet";
  button.title = connectedAddress ? "Connected Flow wallet " + connectedAddress : "Connect or view a wallet";
  button.disabled = connecting;
  const info = document.getElementById("connection-info");
  info.hidden = !connectedAddress;
  info.textContent = connectedAddress ? "Connected " + connectedAddress : "";
  document.getElementById("connect-flow").hidden = Boolean(connectedAddress);
  document.getElementById("disconnect-flow").hidden = !connectedAddress;
}

function showWalletError(message) {
  walletError.textContent = message;
  walletError.hidden = !message;
  if (message) walletInput.setAttribute("aria-invalid", "true");
  else walletInput.removeAttribute("aria-invalid");
}

function openWallet() {
  walletInput.value = wallet.mode === "sample" ? "" : wallet.address;
  showWalletError("");
  if (!walletDialog.open) walletDialog.showModal();
  updateWalletUi();
}

function observeWallet() {
  if (watchingWallet) return;
  watchingWallet = true;
  watchWallet(address => {
    if (connectedAddress === address) return;
    connectedAddress = address;
    if (!address && wallet.mode === "connected") chooseWallet(SAMPLE_WALLET, "sample");
    else render(true);
  }).catch(() => { watchingWallet = false; });
}

async function authenticate() {
  if (connecting) return;
  connecting = true;
  walletDialog.close();
  updateWalletUi();
  try {
    const address = await connectWallet();
    connectedAddress = address;
    chooseWallet(address, "connected");
    observeWallet();
  } catch {
    openWallet();
    showWalletError("The Flow connection did not complete. Try connecting again or enter a wallet address.");
  } finally {
    connecting = false;
    updateWalletUi();
  }
}

async function disconnect() {
  try {
    await disconnectWallet();
    connectedAddress = "";
    if (wallet.mode === "connected") chooseWallet(SAMPLE_WALLET, "sample");
    else {
      walletDialog.close();
      render();
    }
  } catch {
    showWalletError("The wallet could not be disconnected. Try again.");
  }
}

async function loadEarlierMatches(id) {
  const entry = resources.get("matches:" + id);
  if (!entry?.value?.cursor || entry.loadingMore) return;
  entry.loadingMore = true;
  entry.pageError = "";
  render(true);
  try {
    const next = await matchPage(id, entry.value.cursor);
    const unique = new Map(entry.value.rows.map(match => [match.id, match]));
    next.rows.forEach(match => unique.set(match.id, match));
    entry.value = { rows: [...unique.values()], cursor: next.cursor };
    announcement.textContent = showNumber(entry.value.rows.length) + " matches loaded";
  } catch (error) {
    entry.pageError = error.message;
  } finally {
    entry.loadingMore = false;
    render(true);
  }
}

document.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  switch (button.dataset.action) {
    case "wallet":
      openWallet();
      break;
    case "close-wallet":
      walletDialog.close();
      break;
    case "connect":
      authenticate();
      break;
    case "disconnect":
      disconnect();
      break;
    case "sample":
      chooseWallet(SAMPLE_WALLET, "sample");
      break;
    case "retry":
      resources.delete(button.dataset.key);
      render();
      break;
    case "page": {
      const scope = button.dataset.scope;
      const state = filterFor(scope);
      state.page = Math.max(0, state.page + Number(button.dataset.step));
      render();
      const matches = main.querySelector(".club-match-list");
      if (matches) {
        matches.focus({ preventScroll: true });
        matches.scrollIntoView({ block: "start" });
      } else {
        const control = [...main.querySelectorAll('button[data-action="page"]')].find(item => item.dataset.scope === scope);
        (control?.closest(".panel") ?? main).querySelector(".table-scroll")?.focus({ preventScroll: true });
      }
      break;
    }
    case "earlier-matches":
      loadEarlierMatches(button.dataset.id);
      break;
  }
});
main.addEventListener("input", event => { if (event.target.tagName === "INPUT") changeFilter(event); });
main.addEventListener("change", event => { if (event.target.tagName === "SELECT") changeFilter(event); });
main.addEventListener("error", event => { if (event.target.tagName === "IMG") event.target.hidden = true; }, true);
document.getElementById("wallet-form").addEventListener("submit", event => {
  event.preventDefault();
  const address = normaliseAddress(walletInput.value);
  if (!address) {
    showWalletError("Enter a Flow address with 16 hexadecimal characters, such as 0x1234567890abcdef.");
    walletInput.focus();
    return;
  }
  chooseWallet(address, address === connectedAddress ? "connected" : "manual");
});
walletInput.addEventListener("input", () => showWalletError(""));
document.querySelector(".skip-link").addEventListener("click", event => {
  event.preventDefault();
  main.focus();
});
window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
});
function refreshVisibleProgression() {
  if (!document.hidden && getRoute().section === "progression") render(true);
}
document.addEventListener("visibilitychange", refreshVisibleProgression);
window.setInterval(refreshVisibleProgression, recentProgressionRefreshMs);
document.addEventListener("touchline-themechange", () => {
  const canvas = main.querySelector("canvas[data-points]");
  if (canvas) drawChart(canvas, JSON.parse(canvas.dataset.points));
});

if (!location.hash) history.replaceState(null, "", "#/players");
render();
if (wallet.mode === "connected") observeWallet();
const pageUrl = new URL(location.href);
if (pageUrl.searchParams.get("wallet") === "settings") {
  pageUrl.searchParams.delete("wallet");
  history.replaceState(null, "", pageUrl);
  openWallet();
}
