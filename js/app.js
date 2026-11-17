/* Fietsgemeenten - kaart en bediening */
(function () {
  "use strict";

  // ---------------------------------------------------------------- kleuren
  // Fietsen, wandelen of alles: dezelfde keuze als op het overzicht
  const FOOT_NAMES = { Walk: "Wandeling", Hike: "Hike", Run: "Hardlopen", TrailRun: "Trailrun" };
  const FOOT_SET = new Set(Object.keys(FOOT_NAMES));
  let SPORT = "bike";
  try { SPORT = localStorage.getItem("fg-home-mode") || "bike"; } catch { /* geen opslag */ }
  if (!["bike", "foot", "all"].includes(SPORT)) SPORT = "bike";
  const WORD = {
    bike: { acts: "ritten", act: "rit", one: "Rit", tab: "Ritten", kicker: "", none: "Geen ritten met deze selectie." },
    foot: { acts: "wandelingen", act: "wandeling", one: "Wandeling", tab: "Wandelingen", kicker: " · wandelen", none: "Geen wandelingen met deze selectie." },
    all: { acts: "activiteiten", act: "activiteit", one: "Activiteit", tab: "Activiteiten", kicker: " · fietsen en wandelen", none: "Geen activiteiten met deze selectie." },
  };
  const W = () => WORD[SPORT];

  // Strava staat één archief per week toe: wanneer kan het weer?
  const STRAVA_URL = "https://www.strava.com/settings/profile";
  function stravaWindow(st) {
    const DAY = 86400, now = Date.now() / 1000;
    const arch = (st && (st.archive_date || st.last_import)) || 0;
    const req = (st && st.requested_at) || 0;
    const base = Math.max(arch, req);
    const next = base ? base + 7 * DAY : 0;
    return {
      arch, req, next, estimated: !!(st && !st.archive_date && st.last_import),
      pending: req > arch, canRequest: !next || now >= next,
      // in kalenderdagen: vandaag = 0
      daysLeft: next ? Math.max(0, Math.round((new Date(next * 1000).setHours(12, 0, 0, 0) - new Date().setHours(12, 0, 0, 0)) / 864e5)) : 0,
    };
  }
  const fmtTs = (ts, wd) => new Date(ts * 1000).toLocaleDateString("nl-NL", { weekday: wd ? "long" : undefined, day: "numeric", month: "long" });

  // Kleuren komen uit de stylesheet (licht of donker), zie themeColors()
  const C = {
    visited: "#eb6834",
    unvisited: "#e4e3de",
    border: "#ffffff",
    ink: "#16181b",
    soft: "#f3c9b5",
    blue: "#2a78d6",
  };
  function themeColors() {
    const css = (n, d) => (window.FGTheme && window.FGTheme.css(n)) || d;
    C.accent = css("--accent", C.accent || C.visited);
    C.walk = css("--walk", "#2f9a68");
    C.visited = SPORT === "foot" ? C.walk : C.accent;
    C.unvisited = css("--unvisited", C.unvisited);
    C.border = css("--map-line", C.border);
    C.ink = css("--ink", C.ink);
    C.soft = SPORT === "foot" ? css("--walk-soft", C.soft) : css("--accent-faint", C.soft);
    C.blue = css("--blue", C.blue);
  }
  themeColors();
  // Hoe vaak: één tint (blauw), licht -> donker
  const FREQ_BINS = [
    { min: 1, max: 1, label: "1 rit", color: "#9ec5f4" },
    { min: 2, max: 3, label: "2 - 3", color: "#6da7ec" },
    { min: 4, max: 9, label: "4 - 9", color: "#3987e5" },
    { min: 10, max: 24, label: "10 - 24", color: "#256abf" },
    { min: 25, max: 99, label: "25 - 99", color: "#184f95" },
    { min: 100, max: Infinity, label: "100 of meer", color: "#0d366b" },
  ];
  const PLAN_TODO = "#2a78d6";
  const ROUTE_COLOR = "#e6007e"; // roze/magenta: valt op tussen grenzen, oranje vlakken en OSM-wegen
  const YEAR_RAMP = ["#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
                     "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];

  // ------------------------------------------------------------------ state
  const S = {
    status: null,
    features: {},       // code -> {naam, provincie, layer}
    acts: [],
    years: new Set(),   // leeg = alle jaren
    rounds: [],         // startdatums van ronde 2, 3, ...
    round: null,        // index van gekozen ronde (0 = ronde 1)
    roundActs: [],
    hatch: new Set(),   // vorige ronde wel, deze ronde (nog) niet
    types: new Set(),   // ritsoorten die meetellen (instelling)
    typeSel: new Set(), // gekozen in filter (leeg = alle)
    rideSel: null,      // geselecteerde rit
    gemSel: null,       // geselecteerde gemeente (zijpaneel)
    gemFilter: null,    // rittenlijst: alleen ritten door deze gemeente
    check: null,        // routecheck: {name, km, visits, pts, sparse}
    rideLimit: 60,
    month: "",          // maandfilter "2026-05" (vanuit het kilometerscherm)
    fill: "visited",    // 'visited' | 'freq' | 'first' | null
    showRoutes: false,
    showBase: false,
    stats: new Map(),   // code -> {n, first, last}   (gefilterd)
    firstEver: new Map(), // code -> act (alle jaren, binnen ritsoort-filter)
    filtered: [],
    routeCache: null,   // id -> polyline
    lastProcessed: -1,
    lastDataLoad: 0,
    wasRunning: false,
  };

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("nl-NL");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }) : "";
  const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  const stravaUrl = (id) => `https://www.strava.com/activities/${id}`;
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  // Periode-tekst voor labels: "" (alles) of " in 2023, 2024"
  function yearsLabel() {
    const ys = [...S.years].sort();
    if (!ys.length) return "";
    if (ys.length > 3) return `${ys.length} jaren`;
    return ys.join(", ").replace(/, ([^,]*)$/, " en $1");
  }
  const MONTHS_NL = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const monthLabel = (ym) => `${MONTHS_NL[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const inSuffix = () => (S.range ? ` in ${S.range.label}` : S.years.size ? ` in ${yearsLabel()}` : "");
  const inPeriod = (a) => !!S.range && a.date >= S.range.start && a.date <= S.range.end;

  // Een ronde telt alle ritten van de begindatum tot en met de einddatum (leeg = loopt door).
  // Rondes mogen elkaar overlappen. S.rounds[0] is ronde 1 (begin leeg = vanaf je eerste rit).
  function roundRange(i) {
    const r = S.rounds[Math.max(0, i || 0)] || { start: "", end: "" };
    return { start: r.start || "", end: r.end || "" };
  }
  const inRange = (a, start, end) => (!start || a.date >= start) && (!end || a.date <= end);
  const isOpen = (i) => { const { end } = roundRange(i); return !end || end >= today(); };

  // Soorten die op de kaart meetellen: fietsen (instelling), te voet, of allebei
  function mtypes() {
    if (SPORT === "foot") return FOOT_SET;
    if (SPORT === "all") return new Set([...S.types, ...FOOT_SET]);
    return S.types;
  }

  // Gemeenten per ronde (alle meetellende soorten, zonder jaar-/maandfilter), op volgorde van eerste bezoek
  function roundFirsts(i, types = mtypes()) {
    const { start, end } = roundRange(i);
    const first = new Map();
    for (const a of S.acts) {
      if (!types.has(a.type) || !inRange(a, start, end)) continue;
      for (const c of a.g) if (S.features[c] && !first.has(c)) first.set(c, a);
    }
    return first;
  }

  const MILESTONES = [50, 75, 90, 100];
  function gemMilestones(i, first) {
    const total = Object.keys(S.features).length;
    const order = [...first.entries()].sort((x, y) => x[1].date.localeCompare(y[1].date));
    return MILESTONES.map((pct) => {
      const n = Math.ceil((pct / 100) * total);
      const hit = order.length >= n && total ? order[n - 1] : null;
      return { pct, date: hit ? hit[1].date : null, code: hit ? hit[0] : null, act: hit ? hit[1] : null, n };
    });
  }

  async function api(path, opts) {
    const r = await fetch(path, opts);
    if (!r.ok && r.status !== 503) throw new Error(`${path}: ${r.status}`);
    return r;
  }
  const post = (path, body) => api(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
  });

  // ------------------------------------------------------------------- kaart
  const map = L.map("map", {
    zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 6.5, maxZoom: 15,
    maxBounds: [[50.2, 2.4], [54.2, 8.2]], maxBoundsViscosity: 0.8,
    preferCanvas: false,
  }).setView([52.2, 5.3], 7.5);
  map.attributionControl.setPrefix(false);
  map.createPane("routes");
  map.getPane("routes").style.zIndex = 450;
  map.getPane("routes").style.pointerEvents = "none";
  const routeRenderer = L.canvas({ pane: "routes", padding: 0.3 });
  const routeLayer = L.layerGroup();
  // Wegenkaart: standaardkaart van OpenStreetMap (geen sleutel nodig)
  const baseLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers',
    maxZoom: 19,
    referrerPolicy: "strict-origin-when-cross-origin",
  });
  let gemeenteLayer = null;
  // OpenStreetMap onder alle lagen (standaard aan; keuze wordt onthouden)
  S.osm = true;
  try { S.osm = localStorage.getItem("fg-osm") !== "0"; } catch { /* geen opslag */ }
  function syncBase() {
    if (S.osm || S.showBase) { if (!map.hasLayer(baseLayer)) baseLayer.addTo(map); }
    else if (map.hasLayer(baseLayer)) map.removeLayer(baseLayer);
  }
  syncBase();
  { const sw = document.querySelector('.switch input[data-layer="osm"]'); if (sw) sw.checked = S.osm; }

  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = () => { const d = L.DomUtil.create("div", "legend"); d.id = "legend"; return d; };
  legend.addTo(map);

  // ------------------------------------------------------------ berekenen
  function compute() {
    const types = S.typeSel.size ? S.typeSel : mtypes();
    const { start, end } = roundRange(S.round);
    const inType = S.acts.filter((a) => types.has(a.type) && inRange(a, start, end));
    S.roundActs = inType;
    S.filtered = S.range ? inType.filter(inPeriod)
      : S.years.size ? inType.filter((a) => S.years.has(a.date.slice(0, 4))) : inType;
    S.stats = new Map();
    for (const a of S.filtered) {
      for (const c of a.g) {
        if (!S.features[c]) continue;
        let s = S.stats.get(c);
        if (!s) { s = { n: 0, first: a, last: a, b: 0 }; S.stats.set(c, s); }
        s.n++;
        if (!FOOT_SET.has(a.type)) s.b++;
        if (a.date < s.first.date) s.first = a;
        if (a.date >= s.last.date) s.last = a;
      }
    }
    S.firstEver = new Map();
    for (const a of inType) {   // inType is gesorteerd op datum
      for (const c of a.g) if (S.features[c] && !S.firstEver.has(c)) S.firstEver.set(c, a);
    }
    // Arcering: in de vorige ronde wel bezocht, in deze ronde nog niet
    S.hatch = new Set();
    if (S.round > 0) {
      const { start: ps, end: pe } = roundRange(S.round - 1);
      const prev = new Set(), cur = new Set();
      for (const a of S.acts) {
        if (!types.has(a.type)) continue;
        if (inRange(a, ps, pe)) a.g.forEach((c) => prev.add(c));
        if (inRange(a, start, end)) a.g.forEach((c) => cur.add(c));
      }
      for (const c of prev) if (!cur.has(c) && S.features[c]) S.hatch.add(c);
    }
  }

  function yearColors() {
    const years = [...new Set([...S.firstEver.values()].map((a) => a.date.slice(0, 4)))].sort();
    const m = new Map();
    years.forEach((y, i) => {
      const idx = years.length === 1 ? YEAR_RAMP.length - 1 : Math.round(i * (YEAR_RAMP.length - 1) / (years.length - 1));
      m.set(y, YEAR_RAMP[idx]);
    });
    return m;
  }

  function freqColor(n) {
    for (const b of FREQ_BINS) if (n >= b.min && n <= b.max) return b.color;
    return FREQ_BINS[FREQ_BINS.length - 1].color;
  }

  let yearColorMap = new Map();
  const CHECK_NEW = "#2a78d6";
  function styleFor(code) {
    let st = S.check ? checkStyle(code) : baseStyle(code);
    if (S.osm && !S.showBase) st = overOsm(st);
    if (code === S.gemSel) st = { ...st, color: C.blue, weight: 3.2, opacity: 1 };
    return st;
  }

  // Met OpenStreetMap eronder: vlakken half doorzichtig, onbezochte bijna helemaal
  function overOsm(st) {
    const o = { ...st };
    if (st.fillColor === C.unvisited || st.fillColor === C.soft) {
      o.fillOpacity = !st.fillOpacity ? 0 : st.fillColor === C.soft ? 0.4 : 0.12;
      o.color = "#8a8984"; o.weight = 0.8; o.opacity = 0.65;
    } else if (String(st.fillColor).startsWith("url(")) {
      o.fillOpacity = 0.55;
    } else {
      o.fillOpacity = Math.min(st.fillOpacity, 0.5);
      if (o.color === C.border) o.opacity = 0.9;
    }
    return o;
  }

  function baseStyle(code) {
    const s = S.stats.get(code);
    let fill = C.unvisited;
    if (S.fill === "visited" && s) fill = SPORT === "all" && !s.b ? C.walk : C.visited;
    else if (S.fill === "freq" && s) fill = freqColor(s.n);
    else if (S.fill === "first") {
      const a = S.firstEver.get(code);
      if (a) fill = yearColorMap.get(a.date.slice(0, 4));
    }
    if (S.showBase) {
      // Plannen: wegenkaart zichtbaar, alleen gemeenten die je nog mist gekleurd
      return s
        ? { color: "#52514e", weight: 0.8, opacity: 0.55, fillColor: "#ffffff", fillOpacity: 0 }
        : { color: "#184f95", weight: 1.4, opacity: 0.9, fillColor: PLAN_TODO, fillOpacity: 0.32 };
    }
    if (!s && S.hatch.has(code) && S.fill !== null && !S.showRoutes) {
      return { color: C.border, weight: 1, opacity: 1, fillColor: "url(#fg-hatch)", fillOpacity: 1 };
    }
    const noFill = S.fill === null;
    let fo = 1;
    if (S.showRoutes) fo = noFill ? 0 : 0.42;   // zacht, zodat de routes opvallen
    return { color: C.border, weight: 1, opacity: 1, fillColor: noFill ? C.unvisited : fill, fillOpacity: noFill && !S.showRoutes ? 1 : fo };
  }

  // ------------------------------------------------------------- tekenen
  function render() {
    compute();
    yearColorMap = yearColors();
    if (gemeenteLayer) gemeenteLayer.eachLayer((l) => l.setStyle(styleFor(l.feature.properties.code)));
    renderPeriodSum();
    renderRounds();
    renderHero();
    renderGemMilestones();
    renderLegend();
    renderProvinces();
    renderTodo();
    renderNew();
    renderTypeChips();
    renderRides();
    applyRideHighlight();
    renderCheck();
    if (S.showRoutes) drawRoutes();
    if (S.gemSel) renderGemCard();
    if (window.FGHome) window.FGHome.refresh();
  }

  function renderHero() {
    const total = Object.keys(S.features).length || 342;
    const visited = S.stats.size;
    $("h-visited").textContent = nf.format(visited);
    $("h-total").textContent = nf.format(total);
    $("h-bar").style.width = `${(visited / total) * 100}%`;
    $("map-kicker").textContent = `${nf.format(visited)} van ${nf.format(total)} · ${roundLabel(S.round || 0).name}${W().kicker}`;
    const km = S.filtered.reduce((t, a) => t + a.km, 0);
    const pct = total ? Math.round((visited / total) * 1000) / 10 : 0;
    const parts = [`<b>${nf.format(pct)}%</b>`];
    if (S.range) {
      const n = [...S.firstEver.values()].filter(inPeriod).length;
      parts.push(`in ${S.range.label}`, `<b>${nf.format(n)}</b> nieuw`);
    } else if (S.years.size) {
      const n = [...S.firstEver.values()].filter((a) => S.years.has(a.date.slice(0, 4))).length;
      parts.push(`in ${yearsLabel()}`, `<b>${nf.format(n)}</b> nieuw`);
    }
    parts.push(`${nf.format(S.filtered.length)} ${W().acts}`, `${nf.format(Math.round(km))} km`);
    $("h-sub").innerHTML = parts.join(" · ");
  }

  function roundLabel(i) {
    const { start, end } = roundRange(i);
    const name = `Ronde ${i + 1}`;
    const firstAct = S.acts.find((a) => mtypes().has(a.type));
    const firstRide = firstAct ? firstAct.date : "";
    const from = start ? fmtDate(start) : firstRide ? `je eerste ${W().act} (${fmtDate(firstRide)})` : "het begin";
    if (end) return { name, since: `${start ? fmtDate(start) : "begin"} t/m ${fmtDate(end)}`, short: `${start ? fmtDate(start) : "begin"} – ${fmtDate(end)}` };
    return { name, since: start ? `sinds ${from}` : `vanaf ${from}`, short: start ? `sinds ${fmtDate(start)}` : "vanaf begin" };
  }

  function renderRounds() {
    const total = Object.keys(S.features).length || 342;
    const chips = [];
    for (let i = S.rounds.length - 1; i >= 0; i--) {
      const n = roundFirsts(i).size;
      const l = roundLabel(i);
      chips.push(`<button type="button" class="rchip${isOpen(i) ? "" : " closed"}" data-round="${i}" aria-pressed="${S.round === i}" title="${esc(l.since)}">
        <b>${l.name}</b><small>${esc(l.short)} · ${n}/${total}</small></button>`);
    }
    chips.push(`<button type="button" class="rchip add" id="round-add">+ Nieuwe ronde</button>`);
    $("round-chips").innerHTML = chips.join("");
    const l = roundLabel(S.round || 0);
    const open = isOpen(S.round || 0) ? (roundRange(S.round).end ? " · loopt nog" : " · loopt door") : " · afgesloten";
    $("h-round").innerHTML = `${l.name} <span>${esc(l.since)}${open}</span>`;
  }

  function renderGemMilestones() {
    const i = S.round || 0;
    const ms = gemMilestones(i, roundFirsts(i));
    $("h-medals").innerHTML = window.FGParty ? window.FGParty.medals(ms, fmtDate) : "";
  }

  // Feestjes voor gemeenten: per ronde, alleen bij mijlpalen die je vanaf nu haalt
  function checkGemParties() {
    if (!window.FGParty || !Object.keys(S.features).length) return;
    const total = Object.keys(S.features).length;
    for (let i = 0; i < S.rounds.length; i++) {
      const first = roundFirsts(i, S.types);
      const ms = gemMilestones(i, first);
      const { start, end } = roundRange(i);
      const group = `gem-${start || "begin"}${end ? `-${end}` : ""}`;
      const label = `${roundLabel(i).name}: gemeenten`;
      const items = ms.map((m) => ({ pct: m.pct, date: m.date, build: () => gemCard(i, m, first, total) }));
      window.FGParty.check(group, label, items, true);
    }
  }

  function gemCard(i, m, first, total) {
    const { start, end } = roundRange(i);
    const l = roundLabel(i);
    const acts = S.acts.filter((a) => S.types.has(a.type) && inRange(a, start, end) && a.date <= m.date);
    const km = acts.reduce((t, a) => t + a.km, 0);
    const days = Math.max(1, Math.round((new Date(m.date) - new Date(start || (S.acts[0] || {}).date || m.date)) / 864e5) + 1);
    const naam = m.code && S.features[m.code] ? S.features[m.code].naam : "";
    const how = m.act ? `${fmtDate(m.date)}, met de rit “${esc(m.act.name || "Rit")}”` : fmtDate(m.date);
    const card = { rows: [], chips: [] };
    if (m.pct === 50) {
      card.title = "Halverwege!";
      card.lead = `${l.name}: ${m.n} van de ${total} gemeenten. ${naam ? `Nummer ${m.n} was <b>${esc(naam)}</b>.` : ""}`;
      card.rows = [["Bereikt op", how], ["Ritten deze ronde", nf.format(acts.length)], ["Kilometers", `${nf.format(Math.round(km))} km`], ["Duur", `${nf.format(days)} dagen`]];
    } else if (m.pct === 75) {
      card.title = "Driekwart!";
      card.lead = `${l.name}: ${m.n} van de ${total} gemeenten binnen. Nog een kwart te gaan.`;
      const fresh = new Map();
      for (const [, a] of first) if (a.date <= m.date) fresh.set(a.id, (fresh.get(a.id) || 0) + 1);
      let best = null;
      for (const [id, n] of fresh) if (!best || n > best.n) best = { id, n };
      const bestAct = best ? S.acts.find((a) => a.id === best.id) : null;
      const per = {};
      for (const [c, f] of Object.entries(S.features)) {
        const p = (per[f.provincie] ||= { t: 0, v: 0 });
        p.t++;
        const fa = first.get(c);
        if (fa && fa.date <= m.date) p.v++;
      }
      const full = Object.values(per).filter((p) => p.v === p.t).length;
      card.rows = [["Bereikt op", how], ["Ritten deze ronde", nf.format(acts.length)], ["Kilometers", `${nf.format(Math.round(km))} km`]];
      if (bestAct) card.rows.push(["Meeste nieuwe in één rit", `${best.n} met “${esc(bestAct.name || "Rit")}”`]);
      card.rows.push(["Provincies compleet", `${full} van ${Object.keys(per).length}`]);
    } else if (m.pct === 90) {
      card.title = "De laatste loodjes";
      const left = Object.keys(S.features).filter((c) => !first.has(c)).map((c) => S.features[c].naam).sort((a, b) => a.localeCompare(b));
      card.lead = `${l.name}: ${m.n} van de ${total}. Nu nog ${left.length} ${left.length === 1 ? "gemeente" : "gemeenten"}:`;
      card.chips = left.slice(0, 60);
      if (left.length > 60) card.note = `en nog ${left.length - 60} meer.`;
    } else {
      card.title = "Alle gemeenten!";
      const firstAct = [...first.entries()].sort((x, y) => x[1].date.localeCompare(y[1].date))[0];
      card.lead = `${l.name} is rond: alle ${total} gemeenten van Nederland aangedaan. Chapeau!`;
      card.rows = [
        ["Start ronde", start ? fmtDate(start) : fmtDate(firstAct ? firstAct[1].date : m.date)],
        ["Voltooid op", how],
        ["Duur", days > 730 ? `${nf.format(Math.round(days / 36.5) / 10)} jaar` : `${nf.format(days)} dagen`],
        ["Ritten", nf.format(acts.length)],
        ["Kilometers", `${nf.format(Math.round(km))} km`],
      ];
      if (firstAct) card.rows.push(["Eerste gemeente", esc(S.features[firstAct[0]].naam)]);
      if (naam) card.rows.push(["Laatste gemeente", esc(naam)]);
      card.note = "Zin in de volgende? Start bij de rondekiezer een nieuwe ronde.";
    }
    return card;
  }

  function renderLegend() {
    const el = $("legend");
    if (!el) return;
    if (S.check) {
      el.style.display = "";
      // Vakjes in dezelfde doorzichtigheid als op de kaart (met OpenStreetMap eronder)
      const sw = (fill, fo) => {
        const st = { color: C.border, weight: 1, opacity: 1, fillColor: fill, fillOpacity: fo };
        const o = S.osm ? overOsm(st) : st;
        return `<span class="sw" style="background:${fill};opacity:${Math.max(o.fillOpacity, 0.08)}"></span>`;
      };
      el.innerHTML = `<div class="lt">Routecheck · ${esc(roundLabel(S.round || 0).name)}</div>
        <div class="li">${sw(CHECK_NEW, 0.85)}Nieuw op deze route</div>
        <div class="li">${sw(C.visited, 0.85)}Al gehad, op deze route</div>
        <div class="li">${sw(C.soft, 1)}Eerder bezocht, niet op deze route</div>
        <div class="li">${sw(C.unvisited, 1)}Nog niet bezocht</div>
        <div class="li"><span class="ln" style="background:${ROUTE_COLOR};height:3px;opacity:1"></span>Route</div>`;
      return;
    }
    const items = [];
    let title = "";
    const rideA = S.rideSel ? S.acts.find((x) => x.id === S.rideSel) : null;
    if (rideA && S.fill === "visited" && !S.showBase) {
      // Geselecteerde rit: gemeenten op de rit vol, de rest vervaagd (zie applyRideHighlight)
      const base = { color: C.border, weight: 1, opacity: 1, fillColor: C.visited, fillOpacity: 1 };
      const o = S.osm ? overOsm(base) : base;
      const sw = (fo, extra = "") => `<span class="sw" style="background:${C.visited};opacity:${Math.max(fo, 0.08)}${extra}"></span>`;
      el.style.display = "";
      el.innerHTML = `<div class="lt">Geselecteerde rit</div>
        <div class="li">${sw(o.fillOpacity, `;outline:2px solid ${C.ink};outline-offset:-2px`)}Op deze rit</div>
        <div class="li">${sw(o.fillOpacity * 0.45)}Eerder bezocht${inSuffix()}</div>
        <div class="li"><span class="sw" style="background:${C.unvisited};opacity:${S.osm ? 0.35 : 1}"></span>Nog niet</div>
        <div class="li"><span class="ln" style="background:${ROUTE_COLOR};height:3px;opacity:1"></span>Route</div>`;
      return;
    }
    if (S.fill === "visited") {
      title = `${SPORT === "foot" ? "Gewandeld" : "Bezocht"}${inSuffix()}`;
      if (SPORT === "all") {
        items.push(`<div class="li"><span class="sw" style="background:${C.visited}"></span>Gefietst</div>`);
        items.push(`<div class="li"><span class="sw" style="background:${C.walk}"></span>Alleen gewandeld</div>`);
      } else items.push(`<div class="li"><span class="sw" style="background:${C.visited}"></span>${SPORT === "foot" ? "Gewandeld" : "Bezocht"}</div>`);
      items.push(`<div class="li"><span class="sw" style="background:${C.unvisited}"></span>Nog niet</div>`);
    } else if (S.fill === "freq") {
      title = `Aantal ${W().acts}${inSuffix()}`;
      for (const b of FREQ_BINS) items.push(`<div class="li"><span class="sw" style="background:${b.color}"></span>${b.label}</div>`);
      items.push(`<div class="li"><span class="sw" style="background:${C.unvisited}"></span>Nog niet</div>`);
    } else if (S.fill === "first") {
      title = "Jaar van eerste bezoek";
      const ys = [...yearColorMap.keys()];
      const shown = ys.length <= 10 ? ys : [ys[0], ...ys.slice(-8)];
      shown.forEach((y, i) => {
        if (ys.length > 10 && i === 1) items.push(`<div class="li"><span class="sw"></span>…</div>`);
        items.push(`<div class="li"><span class="sw" style="background:${yearColorMap.get(y)}"></span>${y}</div>`);
      });
      items.push(`<div class="li"><span class="sw" style="background:${C.unvisited}"></span>Nog niet</div>`);
    }
    if (S.showBase) {
      title = `Plannen${inSuffix()}`;
      items.length = 0;
      items.push(`<div class="li"><span class="sw" style="background:${PLAN_TODO};opacity:.45;outline:1.5px solid #184f95"></span>Nog te gaan</div>`);
      items.push(`<div class="li"><span class="sw" style="outline:1px solid #8a8984"></span>Al bezocht</div>`);
    }
    if (S.hatch.size && S.fill !== null && !S.showBase && !S.showRoutes) {
      items.push(`<div class="li"><span class="sw hatch"></span>Vorige ronde wel, nu nog niet</div>`);
    }
    if (S.showRoutes) items.push(`<div class="li"><span class="ln" style="background:${ROUTE_COLOR};opacity:.6;height:3px"></span>Routes (feller = vaker)</div>`);
    el.style.display = items.length ? "" : "none";
    el.innerHTML = (title ? `<div class="lt">${title}</div>` : "") + items.join("");
  }

  function renderProvinces() {
    const per = {};
    for (const [code, f] of Object.entries(S.features)) {
      const p = (per[f.provincie] ||= { total: 0, visited: 0 });
      p.total++;
      if (S.stats.has(code)) p.visited++;
    }
    const rows = Object.entries(per).sort((a, b) => b[1].visited / b[1].total - a[1].visited / a[1].total || a[0].localeCompare(b[0]));
    $("tab-prov").innerHTML = rows.map(([name, p]) => `
      <div class="prov-row" role="button" tabindex="0" data-prov="${esc(name)}" title="Bekijk ${esc(name)}">
        <span class="name">${esc(name)}</span>
        <span class="num">${p.visited} / ${p.total}</span>
        <div class="bar"><div style="width:${(p.visited / p.total) * 100}%"></div></div>
      </div>`).join("") || `<div class="empty">Nog geen gegevens.</div>`;
  }

  function renderTodo() {
    const q = $("todo-search").value.trim().toLowerCase();
    const byProv = {};
    let open = 0;
    for (const [code, f] of Object.entries(S.features)) {
      if (S.stats.has(code)) continue;
      open++;
      if (q && !f.naam.toLowerCase().includes(q)) continue;
      (byProv[f.provincie] ||= []).push({ code, naam: f.naam });
    }
    $("todo-sum").innerHTML = open ? `Nog <b>${nf.format(open)}</b> ${open === 1 ? "gemeente" : "gemeenten"} te gaan${inSuffix()}` : "Alle gemeenten gehad!";
    const wasOpen = new Set([...document.querySelectorAll("#todo-list details[open]")].map((d) => d.dataset.p));
    const provs = Object.keys(byProv).sort((a, b) => byProv[b].length - byProv[a].length || a.localeCompare(b));
    $("todo-list").innerHTML = provs.length ? provs.map((p) => `
      <details class="prov-drop" data-p="${esc(p)}" ${q || wasOpen.has(p) ? "open" : ""}>
        <summary><span class="pname">${esc(p)}</span><span class="cnt">${byProv[p].length}</span></summary>
        <div class="glist">${byProv[p].sort((a, b) => a.naam.localeCompare(b.naam))
          .map((g) => `<button class="gitem" data-code="${esc(g.code)}">${esc(g.naam)}</button>`).join("")}</div>
      </details>`).join("")
      : `<div class="empty">${q ? "Geen gemeente gevonden." : "Alle gemeenten bezocht. Chapeau!"}</div>`;
  }

  // ------------------------------------------------------------- ritten
  const TYPE_SHORT = { Ride: "Weg", GravelRide: "Gravel", MountainBikeRide: "MTB", EBikeRide: "E-bike",
    EMountainBikeRide: "E-MTB", Velomobile: "Velomobiel", Handcycle: "Handbike",
    Walk: "Wandelen", Hike: "Hike", Run: "Hardlopen", TrailRun: "Trail" };

  function rideRows() {
    const q = $("ride-search").value.trim().toLowerCase();
    let list = S.filtered.slice();
    if (S.gemFilter) list = list.filter((a) => a.g.includes(S.gemFilter));
    if (q) list = list.filter((a) => (a.name || "").toLowerCase().includes(q) || (a.bike || "").toLowerCase().includes(q));
    const fresh = new Map();
    for (const [, a] of S.firstEver) fresh.set(a.id, (fresh.get(a.id) || 0) + 1);
    const nG = (a) => a.g.filter((c) => S.features[c]).length;
    const sort = $("ride-sort").value;
    const cmp = {
      new: (x, y) => y.date.localeCompare(x.date),
      old: (x, y) => x.date.localeCompare(y.date),
      km: (x, y) => y.km - x.km,
      gem: (x, y) => nG(y) - nG(x) || y.date.localeCompare(x.date),
      fresh: (x, y) => (fresh.get(y.id) || 0) - (fresh.get(x.id) || 0) || x.date.localeCompare(y.date),
    }[sort];
    list.sort(cmp);
    return { list, fresh, nG };
  }

  function renderRides() {
    const { list, fresh, nG } = rideRows();
    const km = list.reduce((t, a) => t + a.km, 0);
    $("rides-sum").textContent = `${nf.format(list.length)} ${W().acts} · ${nf.format(Math.round(km))} km`;
    const gf = S.gemFilter && S.features[S.gemFilter];
    $("rides-gem").hidden = !gf;
    if (gf) $("rides-gem-text").textContent = `Door ${gf.naam}`;
    const shown = list.slice(0, S.rideLimit);
    $("rides-list").innerHTML = shown.map((a) => {
      const n = nG(a), f = fresh.get(a.id) || 0;
      return `<div class="ride${S.rideSel === a.id ? " sel" : ""}" data-ride="${a.id}">
        <span class="rn" title="${esc(a.name)}">${esc(a.name || (FOOT_SET.has(a.type) ? "Wandeling" : "Rit"))}</span>
        <span class="rk">${nf.format(a.km)} km</span>
        <span class="rm"><span class="tbadge${FOOT_SET.has(a.type) ? " walk" : ""}">${esc(TYPE_SHORT[a.type] || a.type)}</span>${fmtDate(a.date)}${a.bike ? " · " + esc(a.bike) : ""}</span>
        <span class="rg">${n ? `${n} gem.` : "buiten NL"}${f ? ` · <b>${f} nieuw</b>` : ""}</span>
      </div>`;
    }).join("") + (list.length > shown.length ? `<button class="btn small more" id="rides-more">Toon meer (${nf.format(list.length - shown.length)})</button>` : "")
      || `<div class="empty">${W().none}</div>`;
  }

  map.createPane("selected");
  map.getPane("selected").style.zIndex = 460;
  map.getPane("selected").style.pointerEvents = "none";
  const selRenderer = L.svg({ pane: "selected", padding: 0.5 });
  const selLayer = L.layerGroup().addTo(map);
  async function selectRide(id, zoom = true) {
    if (S.rideSel === id) { clearRide(); return; }
    if (S.check) closeCheck(false);
    S.rideSel = id;
    const a = S.acts.find((x) => x.id === id);
    if (!S.routeCache) {
      const r = await api("/api/routes");
      S.routeCache = await r.json();
    }
    selLayer.clearLayers();
    let pts = S.routeCache[id];
    if (typeof pts === "string") pts = S.routeCache[id] = decodePolyline(pts);
    if (pts && pts.length) {
      const halo = L.polyline(pts, { renderer: selRenderer, color: "#ffffff", weight: 7, opacity: 0.95, interactive: false }).addTo(selLayer);
      L.polyline(pts, { renderer: selRenderer, color: ROUTE_COLOR, weight: 3.5, opacity: 1, interactive: false }).addTo(selLayer);
      if (zoom) map.fitBounds(halo.getBounds(), { padding: [70, 70], maxZoom: 12 });
    }
    $("sel-bar").hidden = false;
    $("sel-name").textContent = `${a ? a.name : "Rit"} · ${a ? fmtDate(a.date) : ""} · ${a ? nf.format(a.km) + " km" : ""}`;
    $("sel-link").href = stravaUrl(id);
    $("sel-gpx").href = `/api/gpx/${id}`;
    $("sel-gpx").hidden = !(pts && pts.length);
    $("sel-detail").dataset.id = id;
    applyRideHighlight();
    renderLegend();
    document.querySelectorAll(".ride").forEach((el) => el.classList.toggle("sel", Number(el.dataset.ride) === id));
  }

  function clearRide() {
    S.rideSel = null;
    selLayer.clearLayers();
    $("sel-bar").hidden = true;
    applyRideHighlight();
    renderLegend();
    document.querySelectorAll(".ride.sel").forEach((el) => el.classList.remove("sel"));
  }

  function applyRideHighlight() {
    if (!gemeenteLayer) return;
    const a = S.rideSel ? S.acts.find((x) => x.id === S.rideSel) : null;
    const set = new Set(a ? a.g : []);
    for (const [code, f] of Object.entries(S.features)) {
      const st = styleFor(code);
      if (a) {
        if (set.has(code)) { st.weight = 2.2; st.color = C.ink; }
        else st.fillOpacity = st.fillOpacity * 0.45;
      }
      f.layer.setStyle(st);
    }
    if (a) for (const c of set) if (S.features[c]) S.features[c].layer.bringToFront();
  }

  function renderNew() {
    let list = [...S.firstEver.entries()].map(([code, a]) => ({ code, a }));
    if (S.range) list = list.filter((x) => inPeriod(x.a));
    else if (S.years.size) list = list.filter((x) => S.years.has(x.a.date.slice(0, 4)));
    list.sort((x, y) => y.a.date.localeCompare(x.a.date) || S.features[x.code].naam.localeCompare(S.features[y.code].naam));
    const top = list.slice(0, 40);
    $("tab-new").innerHTML = top.length ? top.map((x) => `
      <div class="new-row" data-code="${esc(x.code)}">
        <span class="new-name">${esc(S.features[x.code].naam)}</span>
        <span class="new-date">${fmtDate(x.a.date)}</span>
      </div>`).join("") : `<div class="empty">${S.years.size ? `Geen nieuwe gemeenten in ${yearsLabel()}.` : "Nog geen gemeenten bezocht."}</div>`;
  }

  // ------------------------------------------------------- gemeente in het zijpaneel
  function gemCardHtml(code) {
    const f = S.features[code];
    const s = S.stats.get(code);
    const rf = roundFirsts(S.round || 0).get(code);
    const rl = roundLabel(S.round || 0).name;
    const rides = S.filtered.filter((a) => a.g.includes(code)).sort((x, y) => y.date.localeCompare(x.date));
    let pill;
    if (rf) pill = `<span class="pill acc">Bezocht in ${esc(rl)}</span>`;
    else if (S.hatch.has(code)) pill = `<span class="pill">Vorige ronde wel</span>`;
    else pill = `<span class="pill blue">Nog te gaan in ${esc(rl)}</span>`;
    const stat = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    // Altijd: alle ritten van de meetellende soorten, over alle rondes heen
    const all = S.acts.filter((a) => mtypes().has(a.type) && a.g.includes(code));
    const stats = [
      stat(`In ${esc(rl)}${inSuffix()}`, s ? `${nf.format(s.n)}×` : "0×"),
      stat(`Eerst in ${esc(rl)}`, rf ? fmtDate(rf.date) : "nog niet"),
      stat("Totaal, alle rondes", `${nf.format(all.length)}×`),
      stat("Eerste keer ooit", all.length ? fmtDate(all[0].date) : "nog nooit"),
    ];
    if (all.length) stats.push(stat("Laatste keer", fmtDate(all[all.length - 1].date)));
    const top = rides.slice(0, 4).map((a) => `<li><button type="button" class="gc-ride" data-ride="${a.id}"><span class="gc-rn">${esc(a.name || "Rit")}</span><span class="gc-rm">${fmtDate(a.date)} · ${nf.format(a.km)} km</span></button></li>`).join("");
    const more = rides.length > 4 ? `<button type="button" class="link" data-gem-rides="${esc(code)}">Alle ${nf.format(rides.length)} ${W().acts} door ${esc(f.naam)}</button>` : "";
    return `<div class="gc-head"><div><p class="eyebrow"><button type="button" class="link prov-link" data-prov="${esc(f.provincie)}">${esc(f.provincie)} ›</button></p><h2 id="gem-card-title">${esc(f.naam)}</h2></div>
        <button type="button" class="gc-x" id="gem-card-x" aria-label="Sluiten">×</button></div>
      <div class="pills">${pill}</div>
      <dl class="gc-stats">${stats.join("")}</dl>
      ${rides.length ? `<div class="gc-rides"><p class="eyebrow">${W().tab} in ${esc(rl)}${inSuffix()}</p><ul>${top}</ul>${more}</div>` : ""}
      <div class="actions">
        ${rf ? "" : `<button type="button" class="btn primary" data-action="routecheck">Route controleren</button>`}
        <button type="button" class="btn" id="gem-card-zoom">Inzoomen</button>
      </div>`;
  }

  // Tooltip bij het aanwijzen van een gemeente: precies wat er voor de huidige keuze geldt
  function tipHtml(code) {
    const f = S.features[code];
    if (!f) return "";
    const s = S.stats.get(code);
    const fe = S.firstEver.get(code);
    const rl = roundLabel(S.round || 0).name;
    const per = S.range || S.years.size;
    const where = per ? inSuffix() : ` in ${rl}`;
    const lines = [];
    const row = (k, v, cls = "") => lines.push(`<span class="tk">${k}</span><span class="tv ${cls}">${v}</span>`);
    if (S.check) {
      const { had, codes } = S.checkSets || checkSets();
      if (codes.has(code)) row("Route", had.has(code) ? "al gehad" : "nieuw!", had.has(code) ? "" : "new");
    }
    if (S.rideSel) {
      const a = S.acts.find((x) => x.id === S.rideSel);
      if (a) row("Deze rit", a.g.includes(code) ? "erdoorheen" : "niet geraakt");
    }
    if (s) {
      row("Bezocht", `${nf.format(s.n)}×${esc(where)}`, "strong");
      if (per) {
        row("Eerste keer", fmtDate(s.first.date));
        if (s.n > 1) row("Laatste keer", fmtDate(s.last.date));
      } else {
        row("Eerste keer", fe ? fmtDate(fe.date) : fmtDate(s.first.date));
        if (s.n > 1) row("Laatste keer", fmtDate(s.last.date));
      }
    } else if (fe) {
      row("Bezocht", `0×${esc(where)}`, "muted");
      row(`Wel in ${esc(rl)}`, `eerst ${fmtDate(fe.date)}`);
    } else {
      row("Bezocht", `nog niet in ${esc(rl)}`, "muted");
      if (S.hatch.has(code)) row("Vorige ronde", "wel geweest");
    }
    // Totaal over alle rondes, als dat iets toevoegt
    const all = S.acts.filter((x) => mtypes().has(x.type) && x.g.includes(code));
    if (all.length && (!s || all.length !== s.n)) row("Alle rondes", `${nf.format(all.length)}×, laatst ${fmtDate(all[all.length - 1].date)}`);
    return `<div class="tip-h"><b>${esc(f.naam)}</b><span>${esc(f.provincie)}</span></div><div class="tip-g">${lines.join("")}</div>`;
  }

  function renderGemCard() {
    const card = $("gem-card");
    const code = S.gemSel;
    if (!code || !S.features[code]) { card.hidden = true; return; }
    card.innerHTML = gemCardHtml(code);
    card.hidden = false;
  }

  function selectGemeente(code, { zoom = false } = {}) {
    const prev = S.gemSel;
    S.gemSel = code && S.features[code] ? code : null;
    if (prev && S.features[prev]) S.features[prev].layer.setStyle(styleFor(prev));
    if (S.rideSel) applyRideHighlight();
    if (S.gemSel) {
      const l = S.features[S.gemSel].layer;
      l.setStyle(styleFor(S.gemSel));
      l.bringToFront();
      if (zoom) map.fitBounds(l.getBounds(), { maxZoom: 10, padding: [60, 60] });
    }
    renderGemCard();
    if (S.gemSel) {
      const side = document.querySelector("#view-map .side");
      if (side) side.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function focusGemeente(code) {
    if (!S.features[code]) return;
    selectGemeente(code, { zoom: true });
  }

  function setGemFilter(code) {
    S.gemFilter = code;
    S.rideLimit = 60;
    renderRides();
  }

  // ---------------------------------------------------------------- routes
  function decodePolyline(str) {
    const pts = []; let i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      for (let k = 0; k < 2; k++) {
        let shift = 0, result = 0, b;
        do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const d = result & 1 ? ~(result >> 1) : result >> 1;
        if (k === 0) lat += d; else lng += d;
      }
      pts.push([lat / 1e5, lng / 1e5]);
    }
    return pts;
  }

  async function drawRoutes() {
    if (!S.routeCache) {
      const r = await api("/api/routes");
      const raw = await r.json();
      S.routeCache = {};
      for (const [id, pl] of Object.entries(raw)) S.routeCache[id] = pl;
    }
    routeLayer.clearLayers();
    const rides = S.filtered.filter((a) => S.routeCache[a.id]);
    // Doorzichtige lijnen: hoe vaker je een weg reed, hoe donkerder hij wordt
    const op = Math.max(0.1, Math.min(0.75, 5 / Math.sqrt(rides.length || 1)));
    for (const a of rides) {
      let pts = S.routeCache[a.id];
      if (typeof pts === "string") pts = S.routeCache[a.id] = decodePolyline(pts);
      L.polyline(pts, { renderer: routeRenderer, color: ROUTE_COLOR, weight: 1.8, opacity: op, interactive: false }).addTo(routeLayer);
    }
    if (!map.hasLayer(routeLayer)) routeLayer.addTo(map);
  }

  // ------------------------------------------------------------- laden
  // Arceerpatroon (oranje streepjes op grijs) in de SVG van de kaart
  function addHatchPattern() {
    const svg = map.getPane("overlayPane").querySelector("svg");
    if (!svg || svg.querySelector("#fg-hatch")) return;
    const ns = "http://www.w3.org/2000/svg";
    const defs = document.createElementNS(ns, "defs");
    const pat = document.createElementNS(ns, "pattern");
    pat.setAttribute("id", "fg-hatch");
    pat.setAttribute("patternUnits", "userSpaceOnUse");
    pat.setAttribute("width", "7");
    pat.setAttribute("height", "7");
    pat.setAttribute("patternTransform", "rotate(45)");
    const bg = document.createElementNS(ns, "rect");
    bg.setAttribute("width", "7"); bg.setAttribute("height", "7"); bg.setAttribute("fill", C.unvisited); bg.id = "fg-hatch-bg";
    const ln = document.createElementNS(ns, "rect");
    ln.setAttribute("width", "2.6"); ln.setAttribute("height", "7"); ln.setAttribute("fill", C.visited); ln.setAttribute("opacity", "0.55"); ln.id = "fg-hatch-ln";
    pat.append(bg, ln);
    defs.append(pat);
    svg.prepend(defs);
  }

  async function loadGemeenten() {
    for (;;) {
      const r = await api("/api/gemeenten");
      if (r.status === 200) {
        const gj = await r.json();
        S.gj = gj;
        gemeenteLayer = L.geoJSON(gj, {
          style: (f) => styleFor(f.properties.code),
          onEachFeature: (f, layer) => {
            const p = f.properties;
            S.features[p.code] = { naam: p.naam, provincie: p.provincie, layer };
            layer.bindTooltip(() => tipHtml(p.code), { sticky: true, className: "gtip", direction: "top", offset: [0, -8] });
            layer.on("click", () => selectGemeente(S.gemSel === p.code ? null : p.code));
            layer.on("mouseover", () => { layer.setStyle({ weight: 2.5, color: C.ink }); layer.bringToFront(); });
            layer.on("mouseout", () => {
              if (S.rideSel) applyRideHighlight(); else layer.setStyle(styleFor(p.code));
              if (S.gemSel && S.features[S.gemSel]) S.features[S.gemSel].layer.bringToFront();
            });
          },
        }).addTo(map);
        addHatchPattern();
        map.fitBounds(gemeenteLayer.getBounds(), { padding: [12, 12] });
        $("map-loading").hidden = true;
        render();
        return;
      }
      const body = await r.json().catch(() => ({}));
      $("map-loading").textContent = body.error ? body.error + " Controleer je internetverbinding en start de app opnieuw." : "Gemeentegrenzen laden… (eerste keer duurt dit even)";
      await new Promise((res) => setTimeout(res, 2000));
    }
  }

  async function loadData() {
    S.lastDataLoad = Date.now();
    const r = await api("/api/data");
    const d = await r.json();
    S.acts = d.activities;
    S.routeCache = null;
    fillYears();
    render();
    checkGemParties();
    if (window.FGKm) window.FGKm.refresh();
  }

  function fillYears() {
    const wrap = $("f-years");
    const { start, end } = roundRange(S.round);
    const mt = mtypes();
    const years = [...new Set(S.acts.filter((a) => mt.has(a.type) && inRange(a, start, end))
      .map((a) => a.date.slice(0, 4)))].sort().reverse();
    for (const y of [...S.years]) if (!years.includes(y)) S.years.delete(y);
    wrap.innerHTML = years.map((y) => `<button type="button" class="chip small" data-year="${y}" aria-pressed="${S.years.has(y)}">${y}</button>`).join("")
      || `<span class="hint">Nog geen ${W().acts} in deze ronde.</span>`;
    renderPeriodSum();
  }

  // Samenvatting van de gekozen periode op de knop
  function renderPeriodSum() {
    let txt = "Alles";
    if (S.range) txt = S.range.label;
    else if (S.years.size) {
      const ys = [...S.years].sort();
      const run = ys.every((y, i) => !i || Number(y) === Number(ys[i - 1]) + 1);
      txt = ys.length <= 3 ? ys.join(", ") : run ? `${ys[0]} – ${ys[ys.length - 1]}` : `${ys.length} jaren`;
    }
    $("period-sum").textContent = txt;
    const on = !!(S.range || S.years.size);
    $("period-pick").classList.toggle("on", on);
    $("month-chip-x").hidden = !on;
    document.querySelectorAll("#pp-pop [data-pp]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pp === "all" && !on)));
  }

  // Periode op de kaart: alleen ritten van ... tot en met ...
  function applyRange(start, end, label, kind = "period") {
    if (end < start) [start, end] = [end, start];
    // kies een ronde die de hele periode omvat (anders ronde 1)
    const covers = (i) => { const r = roundRange(i); return (!r.start || r.start <= start) && (!r.end || r.end >= end); };
    if (!covers(S.round)) {
      const hit = S.rounds.map((_, i) => i).reverse().find(covers);
      S.round = hit != null ? hit : 0;
    }
    S.range = { start, end, label: label || rangeLabel(start, end), kind, autoRoutes: false };
    S.years.clear();
    fillYears();
    render();
    if (S.filtered.length && gemeenteLayer) {
      const codes = new Set(S.filtered.flatMap((a) => a.g));
      const b = L.latLngBounds([]);
      for (const c of codes) if (S.features[c]) b.extend(S.features[c].layer.getBounds());
      if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 10 });
    }
  }
  // "1 mei – 30 sep 2026" (zelfde jaar) of "1 mei 2025 – 30 sep 2026"
  function rangeLabel(a, z) {
    const o = (d, y) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", y ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" });
    if (a === z) return o(a, true);
    return a.slice(0, 4) === z.slice(0, 4) ? `${o(a, false)} – ${o(z, true)}` : `${o(a, true)} – ${o(z, true)}`;
  }
  const isoD = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  function setPP(open) {
    $("pp-pop").hidden = !open;
    $("period-pick").setAttribute("aria-expanded", String(open));
    if (open) setTimeout(() => scrollSide($("period-pick"), -60), 30);
  }
  $("period-pick").addEventListener("click", () => setPP($("pp-pop").hidden));
  $("pp-pop").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pp]");
    if (!b) return;
    const now = new Date(), y = now.getFullYear();
    const pp = b.dataset.pp;
    clearRange(false);
    S.years.clear();
    if (pp === "thisyear") S.years.add(String(y));
    else if (pp === "lastyear") S.years.add(String(y - 1));
    if (pp === "12m") {
      const from = new Date(now); from.setFullYear(y - 1); from.setDate(from.getDate() + 1);
      applyRange(isoD(from), today(), "Laatste 12 maanden");
    } else if (pp === "thismonth") {
      const m = today().slice(0, 7);
      const last = new Date(y, now.getMonth() + 1, 0);
      applyRange(`${m}-01`, isoD(last), now.toLocaleDateString("nl-NL", { month: "long", year: "numeric" }), "month");
    } else { fillYears(); render(); }
    setPP(false);
  });
  $("pp-range").addEventListener("submit", (e) => {
    e.preventDefault();
    const a = $("pp-from").value, z = $("pp-to").value;
    if (!a || !z) return;
    clearRange(false);
    applyRange(a, z);
    setPP(false);
  });
  // Klik buiten het venster sluit het
  document.addEventListener("click", (e) => {
    if (!e.target.isConnected) return; // knop is net vervangen (jaartal aangeklikt)
    if (!$("pp-pop").hidden && !$("pp-pop").contains(e.target) && !$("period-pick").contains(e.target)) setPP(false);
  });

  function fillRounds(status) {
    const rounds = (status.rondes || []).map((r) => ({ start: r.van || "", end: r.tot || "" }));
    if (!rounds.length) rounds.push({ start: "", end: "" });
    const key = JSON.stringify(rounds);
    if (S.roundsKey === key) return false;
    const grew = S.roundsKey !== undefined && rounds.length > S.rounds.length;
    S.roundsKey = key;
    S.rounds = rounds;
    const want = S.selectAfter;
    S.selectAfter = null;
    const wi = want ? rounds.findIndex((r) => r.start === want.start && r.end === (want.end || "")) : -1;
    if (wi >= 0) {
      S.round = wi; // net aangemaakte ronde tonen
    } else if (S.round === null || grew || S.round >= rounds.length) {
      // standaard: de nieuwste ronde die nog loopt
      let pick = rounds.length - 1;
      for (let i = rounds.length - 1; i >= 0; i--) if (isOpen(i)) { pick = i; break; }
      S.round = pick;
    }
    return true;
  }

  function fillTypeChips(status) {
    const types = status.sport_types;
    const key = types.join(",");
    if (S.typesKey === key) return;
    S.typesKey = key;
    S.types = new Set(types);
    S.typeNames = Object.fromEntries(status.all_types);
    for (const t of [...S.typeSel]) if (!S.types.has(t)) S.typeSel.delete(t);
    renderTypeChips();
  }

  function renderTypeChips() {
    const { start, end } = roundRange(S.round);
    const count = {};
    for (const a of S.acts) {
      if (!inRange(a, start, end)) continue;
      if (S.range ? !inPeriod(a) : S.years.size && !S.years.has(a.date.slice(0, 4))) continue;
      count[a.type] = (count[a.type] || 0) + 1;
    }
    const names = { ...(S.typeNames || {}), ...FOOT_NAMES };
    const mt = [...mtypes()].filter((t) => !FOOT_SET.has(t) || count[t]);
    $("f-types").innerHTML = `<button class="chip small" data-type="" aria-pressed="${S.typeSel.size === 0}">Alle</button>` +
      mt.map((t) => `<button class="chip small" data-type="${esc(t)}" aria-pressed="${S.typeSel.has(t)}">${esc(names[t] || t)} <span class="cn">${nf.format(count[t] || 0)}</span></button>`).join("");
  }

  // ------------------------------------------------------------- status
  async function pollStatus() {
    let st;
    try {
      st = await (await api("/api/status")).json();
    } catch {
      $("sync").hidden = false;
      $("sync").classList.add("error");
      $("sync-msg").textContent = "De app is gestopt.";
      $("sync-detail").textContent = "Start Fietsgemeenten opnieuw.";
      $("btn-sync").hidden = true;
      schedulePoll(5000);
      return;
    }
    $("btn-sync").hidden = false;
    S.status = st;
    if (window.FGParty) window.FGParty.init(st);
    fillTypeChips(st);
    if (fillRounds(st) && S.acts.length) { fillYears(); render(); }
    $("athlete").textContent = st.athlete ? `Ritten van ${st.athlete}` : "";
    const im = st.import;
    const hasData = st.rides > 0 || !!st.last_import;
    $("onboarding").hidden = st.connected || hasData || im.running || S.uploading;
    if (st.storage_error) showBanner(st.storage_error, false, 0);
    // Weigert Strava de koppeling (abonnement nodig), dan geen melding in het paneel
    $("sync").hidden = !st.connected || (st.api_blocked && !st.sync.running);
    $("imp").hidden = !$("onboarding").hidden ? true : !(st.last_import || im.running || im.error || S.uploading || !st.connected);
    renderSync(st);
    renderImport(st);
    $("set-api-text").textContent = !st.connected ? "Strava-koppeling: niet gekoppeld"
      : st.api_blocked ? "Strava-koppeling: staat uit. Strava vraagt hiervoor een abonnement; je ritten komen via het archief."
        : `Strava-koppeling: gekoppeld${st.athlete ? ` (${st.athlete})` : ""}`;
    $("set-api-btn").hidden = st.connected;
    $("set-api-retry").hidden = !(st.connected && st.api_blocked);

    const sy = st.sync;
    const busy = sy.running || im.running;
    const changed = st.processed !== S.lastProcessed;
    const finished = S.wasRunning && !busy;
    if ((changed && Date.now() - S.lastDataLoad > (busy ? 8000 : 0)) || finished) {
      S.lastProcessed = st.processed;
      if (S.status && Object.keys(S.features).length) loadData();
    }
    S.wasRunning = busy;
    schedulePoll(busy || S.uploading ? 2000 : 15000);
  }

  function schedulePoll(ms) {
    clearTimeout(S.pollTimer);
    S.pollTimer = setTimeout(pollStatus, ms);
  }

  function renderImport(st) {
    const im = st.import;
    const box = $("imp");
    const btn = $("btn-imp");
    box.classList.toggle("error", !!im.error && !im.running);
    $("imp-progress").hidden = true;
    let msg, detail = "";
    if (S.uploading) {
      msg = "Archief uploaden…";
      detail = S.uploadPct != null ? `${S.uploadPct}% · laat dit venster open` : "";
      $("imp-progress").hidden = false;
      $("imp-bar").style.width = `${S.uploadPct || 0}%`;
      btn.hidden = true;
    } else if (im.running) {
      msg = im.message || "Archief inlezen…";
      detail = "De kaart vult zich tijdens het inlezen.";
      if (im.total) { $("imp-progress").hidden = false; $("imp-bar").style.width = `${(im.done / im.total) * 100}%`; }
      btn.hidden = false; btn.textContent = "Stoppen"; btn.dataset.action = "stop-import";
    } else if (im.error) {
      msg = im.error;
      btn.hidden = false; btn.textContent = "Ander bestand"; btn.dataset.action = "pick-archive";
    } else {
      msg = im.message && im.finished_at ? im.message : "Strava-archief";
      const sw = stravaWindow(st);
      const when = sw.pending ? `Nieuw archief aangevraagd op ${fmtTs(sw.req)}.` : sw.canRequest ? "Je kunt bij Strava weer een nieuw archief aanvragen." : `Nieuw archief aanvragen bij Strava kan weer vanaf ${fmtTs(sw.next, true)}.`;
      detail = st.last_import ? `Laatst ingelezen ${new Date(st.last_import * 1000).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}. ${when}` : "Lees je Strava-archief (zip) in.";
      btn.hidden = false; btn.textContent = "Archief inlezen"; btn.dataset.action = "pick-archive";
    }
    $("imp-msg").textContent = msg;
    $("imp-detail").textContent = detail;
  }

  // Archief inlezen: gebeurt helemaal in deze browser (niets wordt geüpload)
  function uploadArchive(file) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) { alert("Kies het zip-bestand dat je van Strava hebt gedownload."); return; }
    const dlgEl = $("dlg-settings");
    if (dlgEl.open) dlgEl.close();
    window.FGEngine.importArchive(file).then(() => { $("archive-file").value = ""; pollStatus(); });
    setView("map");
    setTimeout(pollStatus, 100);
  }

  // ------------------------------------------------------------- je gegevens
  function showBanner(text, ok = false, ms = 12000) {
    const b = $("banner");
    b.hidden = false;
    b.classList.toggle("ok", ok);
    b.textContent = text;
    if (ms) setTimeout(() => { b.hidden = true; }, ms);
  }
  async function makeBackup() {
    const blob = await window.FGEngine.backupBlob();
    window.FGEngine.download(blob, `fietsgemeenten-backup-${today()}.json.gz`);
  }
  async function restoreBackup(file) {
    if (!file) return;
    try {
      const data = await window.FGEngine.readBackup(file);
      const n = data.activiteiten.length;
      const have = window.FGEngine.stats().activities;
      const when = data.gemaakt ? new Date(data.gemaakt).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" }) : "onbekend";
      if (!confirm(`Back-up van ${when} met ${n} activiteiten terugzetten?${have ? `\n\nDe ${have} activiteiten die nu in deze browser staan, worden vervangen.` : ""}`)) return;
      await window.FGEngine.restoreBackup(data);
      if ($("dlg-settings").open) $("dlg-settings").close();
      S.typesKey = "";
      await pollStatus();
      await loadData();
      showBanner(`Back-up teruggezet: ${n} activiteiten.`, true);
    } catch (e) {
      alert(e.message);
    } finally {
      $("backup-file").value = "";
    }
  }
  async function wipeAll() {
    const n = window.FGEngine.stats().activities;
    if (!confirm(`Alle gegevens van Fietsgemeenten uit deze browser wissen (${n} activiteiten, rondes, doelen en instellingen)?\n\nDit kan niet ongedaan worden gemaakt. Maak eerst een back-up als je ze wilt bewaren.`)) return;
    await window.FGEngine.wipe();
    location.reload();
  }
  $("backup-file").addEventListener("change", (e) => restoreBackup(e.target.files[0]));

  function renderSync(st) {
    const sy = st.sync;
    const box = $("sync");
    box.classList.toggle("error", !!sy.error);
    const btn = $("btn-sync");
    let msg = "", detail = "";
    $("sync-progress").hidden = true;
    if (sy.running && sy.waiting_until && sy.waiting_kind === "netwerk") {
      msg = "Geen verbinding met Strava";
      detail = `Nieuwe poging om ${fmtTime(sy.waiting_until)}.`;
      btn.textContent = "Stoppen"; btn.dataset.action = "stop";
    } else if (sy.running && sy.waiting_until) {
      msg = "Pauze: Strava-limiet bereikt";
      const t = fmtTime(sy.waiting_until);
      detail = sy.waiting_daily ? `Gaat vanzelf verder om ${t} (daglimiet). Laat het venster openstaan.` : `Gaat vanzelf verder om ${t}.`;
      btn.textContent = "Stoppen"; btn.dataset.action = "stop";
      showProgress(sy);
    } else if (sy.running) {
      msg = sy.message || "Bezig…";
      detail = sy.phase === "routes" ? "De kaart vult zich tijdens het verwerken." : "";
      btn.textContent = "Stoppen"; btn.dataset.action = "stop";
      showProgress(sy);
    } else if (sy.error) {
      msg = sy.error;
      detail = "";
      btn.textContent = "Opnieuw"; btn.dataset.action = "sync";
      if (/koppel/i.test(sy.error)) { btn.textContent = "Opnieuw koppelen"; btn.dataset.action = "login"; }
    } else {
      msg = st.last_sync ? "Bijgewerkt" : "Nog niet gesynchroniseerd";
      const pending = st.rides - st.processed;
      const bits = [`${nf.format(st.rides)} ritten`];
      if (pending > 0) bits.push(`${nf.format(pending)} nog te verwerken`);
      if (st.no_gps) bits.push(`${nf.format(st.no_gps)} zonder GPS`);
      detail = bits.join(" · ");
      btn.textContent = "Bijwerken"; btn.dataset.action = "sync";
    }
    $("sync-msg").textContent = msg;
    $("sync-detail").textContent = detail;
    $("foot-sync").textContent = st.last_sync ? `laatst bijgewerkt ${new Date(st.last_sync * 1000).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}` : "";
  }

  function showProgress(sy) {
    if (sy.phase === "routes" && sy.total > 0) {
      $("sync-progress").hidden = false;
      $("sync-bar").style.width = `${(sy.done / sy.total) * 100}%`;
    }
  }

  // ------------------------------------------------------------ bediening
  $("set-api-retry").addEventListener("click", async () => {
    await post("/api/sync");
    setTimeout(pollStatus, 300);
  });
  $("btn-sync").addEventListener("click", async (e) => {
    const action = e.currentTarget.dataset.action;
    if (action === "login") { location.href = "/login"; return; }
    await post(action === "stop" ? "/api/stop" : "/api/sync");
    setTimeout(pollStatus, 300);
  });


  $("f-years").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const y = b.dataset.year;
    clearRange(false);
    if (S.years.has(y)) S.years.delete(y);
    else S.years.add(y);
    fillYears();
    render();
  });

  async function saveRounds(rounds) {
    await post("/api/settings", { rondes: rounds.map((r) => ({ van: r.start || "", tot: r.end || "" })) });
    await pollStatus();
  }

  // Controle van een nieuwe of gewijzigde ronde; geeft een foutmelding of "" terug
  function roundError(start, end, skip) {
    if (!start) return "Kies een begindatum.";
    if (end && end < start) return "De einddatum ligt vóór de begindatum.";
    if (S.rounds.some((r, i) => i !== skip && r.start === start && (r.end || "") === (end || ""))) return "Deze ronde bestaat al.";
    return "";
  }

  $("round-chips").addEventListener("click", (e) => {
    if (e.target.closest("#round-add")) {
      const f = $("round-new");
      f.hidden = !f.hidden;
      if (!f.hidden) {
        $("round-new-date").value = today();
        $("round-new-end").value = "";
        const fa = S.acts.find((a) => mtypes().has(a.type));
        $("round-new-date").min = fa ? fa.date : "";
        $("round-new-date").max = today();
        $("round-new-date").focus();
      }
      return;
    }
    const b = e.target.closest("[data-round]");
    if (!b) return;
    S.round = Number(b.dataset.round);
    clearRange(false);
    S.years.clear();
    fillYears();
    render();
  });
  $("round-new-cancel").addEventListener("click", () => { $("round-new").hidden = true; });
  $("round-new").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = $("round-new-date").value;
    const t = $("round-new-end").value;
    const err = roundError(d, t, -1);
    if (err) { alert(err); return; }
    $("round-new").hidden = true;
    S.selectAfter = { start: d, end: t };
    await saveRounds([...S.rounds, { start: d, end: t }]);
    fillYears();
    render();
  });

  $("f-types").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const t = b.dataset.type;
    if (!t) S.typeSel.clear();
    else if (S.typeSel.has(t)) S.typeSel.delete(t);
    else S.typeSel.add(t);
    if (S.typeSel.size === mtypes().size) S.typeSel.clear();
    S.rideLimit = 60;
    render();
  });

  document.querySelectorAll(".switch input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const l = inp.dataset.layer;
      if (["visited", "freq", "first"].includes(l)) {
        if (inp.checked) {
          document.querySelectorAll('.switch input[data-layer="visited"],.switch input[data-layer="freq"],.switch input[data-layer="first"]')
            .forEach((o) => { if (o !== inp) o.checked = false; });
          S.fill = l;
        } else {
          S.fill = null;
        }
      } else if (l === "routes") {
        S.showRoutes = inp.checked;
        if (!inp.checked) map.removeLayer(routeLayer);
      } else if (l === "base") {
        S.showBase = inp.checked;
        syncBase();
      } else if (l === "osm") {
        S.osm = inp.checked;
        try { localStorage.setItem("fg-osm", S.osm ? "1" : "0"); } catch { /* geen opslag */ }
        syncBase();
      }
      render();
    });
  });

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((o) => o.classList.toggle("active", o === t));
    document.querySelectorAll(".tabpane").forEach((p) => { p.hidden = p.id !== `tab-${t.dataset.tab}`; });
  }));
  $("todo-search").addEventListener("input", renderTodo);
  $("ride-search").addEventListener("input", () => { S.rideLimit = 60; renderRides(); });
  $("ride-sort").addEventListener("change", () => { S.rideLimit = 60; renderRides(); });
  $("rides-list").addEventListener("click", (e) => {
    if (e.target.id === "rides-more") { S.rideLimit += 100; renderRides(); return; }
    const r = e.target.closest("[data-ride]");
    if (r) selectRide(Number(r.dataset.ride));
  });
  $("sel-close").addEventListener("click", clearRide);
  function clearRange(rerender = true) {
    if (!S.range) return;
    if (S.range.autoRoutes) {
      const sw = document.querySelector('.switch input[data-layer="routes"]');
      if (sw) sw.checked = false;
      S.showRoutes = false;
      map.removeLayer(routeLayer);
    }
    S.range = null;
    if (rerender) { fillYears(); render(); }
  }
  $("month-chip-x").addEventListener("click", () => {
    if (S.range) clearRange(false);
    S.years.clear();
    fillYears();
    render();
  });

  // ----------------------------------------------------- schermen wisselen
  // home = overzicht, map = kaart, rides = kaart met de rittenlijst, km = kilometers
  let curView = "";
  // Menu: welk item is actief? Routecheck telt als actief zolang de routecheckkaart open is.
  function syncNav() {
    const checkOpen = curView === "map" && !$("route-card").hidden;
    const key = checkOpen ? "check" : curView === "ride" ? "rides" : curView;
    document.querySelectorAll(".nav-btn[data-view], .nav-btn[data-nav]").forEach((b) => {
      if ((b.dataset.view || b.dataset.nav) === key) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  }
  function setView(view) {
    if (!["home", "map", "rides", "km", "ride", "prov"].includes(view)) view = "home";
    const v = view === "rides" ? "map" : view;
    const changed = v !== (curView === "rides" ? "map" : curView);
    curView = view;
    $("view-home").hidden = v !== "home";
    $("view-map").hidden = v !== "map";
    $("km-view").hidden = v !== "km";
    $("view-ride").hidden = v !== "ride";
    $("view-prov").hidden = v !== "prov";
    syncNav();
    if (changed) document.querySelector(".views").scrollTop = 0;
    if (v === "km" && window.FGKm) window.FGKm.show();
    if (v === "home" && window.FGHome) window.FGHome.show();
    if (v === "prov" && window.FGProv) window.FGProv.show();
    if (v === "map") setTimeout(() => map.invalidateSize(), 50);
    if (view === "rides") {
      document.querySelectorAll(".tab").forEach((o) => o.classList.toggle("active", o.dataset.tab === "rides"));
      document.querySelectorAll(".tabpane").forEach((p) => { p.hidden = p.id !== "tab-rides"; });
      setTimeout(() => scrollSide(document.querySelector(".lists")), 60);
    }
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) setView(b.dataset.view);
  });

  // Thema gewisseld: kaartkleuren opnieuw zetten
  window.addEventListener("fg-theme", () => {
    themeColors();
    const bg = document.getElementById("fg-hatch-bg"), ln = document.getElementById("fg-hatch-ln");
    if (bg) bg.setAttribute("fill", C.unvisited);
    if (ln) ln.setAttribute("fill", C.visited);
    render();
  });

  // Op een breed scherm scrolt alleen de inhoud, nooit het hele venster. Zet het venster
  // terug als de browser het toch verschuift (bijvoorbeeld bij focus op een verborgen veld).
  window.addEventListener("scroll", () => {
    if (window.innerWidth > 820 && (window.scrollY || window.scrollX)) window.scrollTo(0, 0);
  });

  /** Het zijpaneel (en alleen dat) laten scrollen naar een element */
  function scrollSide(el, extra = -8) {
    const side = document.querySelector("#view-map .side");
    if (!side || !el) return;
    const top = el.getBoundingClientRect().top - side.getBoundingClientRect().top + side.scrollTop + extra;
    side.scrollTo({ top: Math.max(0, top) });
  }

  /** Kaart tonen en daarna iets doen (de kaart moet eerst zijn juiste maat hebben) */
  function onMap(fn, view = "map") {
    setView(view);
    setTimeout(() => { map.invalidateSize(); fn(); }, 80);
  }

  // Koppeling met het kilometerscherm
  // Zijpaneel: gemeentekaart en gemeentefilter van de rittenlijst
  $("gem-card").addEventListener("click", (e) => {
    if (e.target.closest("#gem-card-x")) { selectGemeente(null); return; }
    if (e.target.closest("#gem-card-zoom")) { focusGemeente(S.gemSel); return; }
    const r = e.target.closest("[data-ride]");
    if (r) { selectRide(Number(r.dataset.ride)); return; }
    const g = e.target.closest("[data-gem-rides]");
    if (g) {
      setGemFilter(g.dataset.gemRides);
      setView("rides");
    }
  });
  $("rides-gem-x").addEventListener("click", () => setGemFilter(null));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.gemSel && !document.querySelector("dialog[open]") && !$("view-map").hidden) selectGemeente(null);
  });

  $("sel-detail").addEventListener("click", (e) => window.FGRide && window.FGRide.open(Number(e.currentTarget.dataset.id)));

  // Fietsen / Wandelen / Alles (gedeeld met het overzicht)
  function setSport(m) {
    if (!WORD[m]) return;
    const changed = m !== SPORT;
    SPORT = m;
    try { localStorage.setItem("fg-home-mode", m); } catch { /* geen opslag */ }
    syncSportUi();
    if (!changed) return;
    themeColors();
    S.typeSel.clear();
    S.gemFilter = null;
    if (S.rideSel && !mtypes().has((S.acts.find((a) => a.id === S.rideSel) || {}).type)) clearRide();
    fillYears();
    render();
  }
  function syncSportUi() {
    document.querySelectorAll("#map-mode [data-hm]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hm === SPORT)));
    $("view-map").dataset.sport = SPORT;
    const tab = document.querySelector('.tab[data-tab="rides"]');
    if (tab) tab.textContent = W().tab;
    $("ride-search").placeholder = SPORT === "foot" ? "Zoek op naam…" : "Zoek op naam of fiets…";
  }
  syncSportUi();
  $("map-mode").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hm]");
    if (b) setSport(b.dataset.hm);
  });

  window.FG = {
    setView,
    /** Alles wat het detailscherm van een rit nodig heeft */
    rideCtx(id) {
      const i = S.round || 0;
      const { start, end } = roundRange(i);
      const act = S.acts.find((a) => a.id === id) || null;
      const firsts = roundFirsts(i);
      // volgorde van de ritten in deze ronde, om "voor" en "na" deze rit te tellen
      const order = new Map();
      const mt = mtypes();
      S.acts.filter((a) => mt.has(a.type) && inRange(a, start, end)).forEach((a, k) => order.set(a.id, k));
      const pos = order.has(id) ? order.get(id) : -1;
      let before = 0, mine = 0;
      for (const [, a] of firsts) {
        const k = order.get(a.id);
        if (a.id === id) mine++;
        else if (pos >= 0 && k < pos) before++;
      }
      return {
        act, features: S.features, gj: S.gj, osm: S.osm, colors: { ...C },
        round: roundLabel(i), inRound: pos >= 0, counts: mt.has(act ? act.type : ""),
        firsts, before, after: before + mine, total: Object.keys(S.features).length,
        // was je hier vóór deze rit al eens geweest (alle rondes)?
        everBefore: (code) => !!act && S.acts.some((a) => mt.has(a.type) && a.id !== id && a.date < act.date && a.g.includes(code)),
      };
    },
    openRide(id) { if (window.FGRide) window.FGRide.open(id); },
    stravaWindow, stravaUrl: STRAVA_URL,
    async stravaRequested(on) {
      await fetch("/api/strava-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ at: on ? 1 : null }) });
      await pollStatus();
    },
    sport: () => SPORT,
    setSport,
    view: () => curView,
    /** Gegevens voor het overzicht en de zoekbalk */
    data() {
      const total = Object.keys(S.features).length;
      return {
        ready: total > 0, total, acts: S.acts, types: S.types, features: S.features,
        round: S.round || 0, rounds: S.rounds.map((_, i) => roundLabel(i)),
        roundOpen: isOpen(S.round || 0), roundRange: roundRange(S.round || 0),
        ranges: S.rounds.map((_, i) => roundRange(i)),
        firsts: total ? roundFirsts(S.round || 0, S.types) : new Map(),
        prevFirsts: total && S.round > 0 ? roundFirsts(S.round - 1, S.types) : null,
        status: S.status,
      };
    },
    /** Eerste bezoek per gemeente in ronde i, voor fietsen, wandelen of alles */
    firsts(i, kind) {
      const t = kind === "foot" ? FOOT_SET : kind === "all" ? new Set([...S.types, ...FOOT_SET]) : S.types;
      return Object.keys(S.features).length ? roundFirsts(i, t) : new Map();
    },
    sportTypes(kind) { return kind === "foot" ? FOOT_SET : kind === "all" ? new Set([...S.types, ...FOOT_SET]) : S.types; },
    current: () => curView,
    medalsHtml() {
      const i = S.round || 0;
      return window.FGParty && Object.keys(S.features).length ? window.FGParty.medals(gemMilestones(i, roundFirsts(i, S.types)), fmtDate) : "";
    },
    setRound(i) {
      S.round = Math.max(0, Math.min(S.rounds.length - 1, Number(i) || 0));
      clearRange(false);
      S.years.clear();
      fillYears();
      render();
    },
    focusGemeente(code) { onMap(() => focusGemeente(code)); },
    showRide(id) {
      const a = S.acts.find((x) => x.id === id);
      if (a && !mtypes().has(a.type)) setSport(FOOT_SET.has(a.type) ? "foot" : "bike");
      onMap(() => {
        if (S.rideSel !== id) selectRide(id); else selectRide(id).then(() => selectRide(id));
        const el = document.querySelector(`#rides-list [data-ride="${id}"]`);
        if (el) scrollSide(el, -200);
      }, "rides");
    },
    routeCheck() { openCheckIntro(); },
    /** Nieuwe ronde starten; geeft een foutmelding terug of null */
    async newRound(start, end) {
      const err = roundError(start, end || "", -1);
      if (err) return err;
      S.selectAfter = { start, end: end || "" };
      await saveRounds([...S.rounds, { start, end: end || "" }]);
      fillYears();
      render();
      return null;
    },
    /** Alle rondes met hun stand, voor het beheervenster */
    roundsInfo() {
      return S.rounds.map((r, i) => ({ start: r.start, end: r.end, ...roundLabel(i), n: roundFirsts(i, S.types).size, cur: i === (S.round || 0) }));
    },
    /** Begin- of einddatum van ronde i aanpassen; geeft een foutmelding terug of null */
    async updateRound(i, field, value) {
      const next = S.rounds.map((r) => ({ ...r }));
      if (!next[i]) return "Deze ronde bestaat niet meer.";
      next[i][field] = value;
      const err = i === 0 && !next[i].start ? "" : roundError(next[i].start, next[i].end, i);
      if (err) return err;
      S.selectAfter = { start: next[S.round || 0].start, end: next[S.round || 0].end || "" };
      await saveRounds(next);
      fillYears();
      render();
      return null;
    },
    async deleteRound(i) {
      if (i <= 0 || !S.rounds[i]) return;
      const keep = S.round !== i ? S.rounds[S.round || 0] : null;
      if (keep) S.selectAfter = { start: keep.start, end: keep.end || "" };
      else S.round = 0;
      await saveRounds(S.rounds.filter((_, j) => j !== i));
      fillYears();
      render();
    },
    /** Hoeveel gemeenten zou je nu al hebben in een ronde van start tot end? */
    roundPreview(start, end) {
      const seen = new Set();
      for (const a of S.acts) {
        if (!S.types.has(a.type) || a.date < start || (end && a.date > end)) continue;
        for (const c of a.g) if (S.features[c]) seen.add(c);
      }
      const fb = S.acts.find((a) => S.types.has(a.type));
      return { n: seen.size, total: Object.keys(S.features).length, first: fb ? fb.date : "" };
    },
    openTodo() {
      setView("map");
      const d = $("todo-drop");
      d.open = true;
      setTimeout(() => scrollSide(d), 60);
    },
    showMonth(ym, rideId) {
      const last = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
      this.showRange(`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`, monthLabel(ym), rideId, { kind: "month" });
    },
    /** Kaart filteren op een periode (van/tot, inclusief); optioneel met routes erbij */
    showRange(start, end, label, rideId, opts = {}) {
      const covers = (i) => { const r = roundRange(i); return (!r.start || r.start <= end) && (!r.end || r.end >= start); };
      if (!covers(S.round)) {
        const hit = S.rounds.map((_, i) => i).reverse().find(covers);
        S.round = hit != null ? hit : 0;
      }
      const prevAuto = S.range && S.range.autoRoutes;
      S.range = { start, end, label, kind: opts.kind || "period", autoRoutes: false };
      if (opts.routes && !S.showRoutes) {
        const sw = document.querySelector('.switch input[data-layer="routes"]');
        if (sw) sw.checked = true;
        S.showRoutes = true;
        S.range.autoRoutes = true;
      } else if (prevAuto) S.range.autoRoutes = true;
      S.years.clear();
      S.typeSel.clear();
      S.rideLimit = 200;
      fillYears();
      render();
      setView("map");
      document.querySelectorAll(".tab").forEach((o) => o.classList.toggle("active", o.dataset.tab === "rides"));
      document.querySelectorAll(".tabpane").forEach((p) => { p.hidden = p.id !== "tab-rides"; });
      if (rideId && S.acts.some((a) => a.id === rideId)) {
        setTimeout(() => selectRide(rideId), 120);
      } else if (S.filtered.length && gemeenteLayer) {
        const codes = new Set(S.filtered.flatMap((a) => a.g));
        const b = L.latLngBounds([]);
        for (const c of codes) if (S.features[c]) b.extend(S.features[c].layer.getBounds());
        if (b.isValid()) setTimeout(() => map.fitBounds(b, { padding: [40, 40], maxZoom: 11 }), 80);
      }
    },
    reload: () => loadData(),
    /** Gemeenten (fiets) in een periode: aantal en welke voor het eerst ooit */
    gemeentenInPeriod(start, end) {
      const set = new Set();
      for (const a of S.acts) if (S.types.has(a.type) && a.date >= start && a.date <= end) a.g.forEach((c) => S.features[c] && set.add(c));
      const fresh = [...roundFirsts(0, S.types).entries()].filter(([, a]) => a.date >= start && a.date <= end)
        .map(([c, a]) => ({ code: c, naam: S.features[c].naam, date: a.date }))
        .sort((x, y) => x.date.localeCompare(y.date));
      return { count: set.size, fresh };
    },
    newGemeentenInYear(y) {
      return [...roundFirsts(0, S.types).values()].filter((a) => a.date.startsWith(String(y))).length;
    },
    gemeentenInYear(y) {
      const set = new Set();
      for (const a of S.acts) if (S.types.has(a.type) && a.date.startsWith(String(y))) a.g.forEach((c) => S.features[c] && set.add(c));
      return set.size;
    },
  };
  $("rides-gpx").addEventListener("click", async () => {
    const { list } = rideRows();
    const ids = list.filter((a) => a.g.length).map((a) => a.id);
    if (!ids.length) { alert("Geen ritten met een route in deze lijst."); return; }
    if (ids.length > 300 && !confirm(`${ids.length} ritten downloaden als zip?`)) return;
    const btn = $("rides-gpx");
    btn.disabled = true; btn.textContent = "Bezig…";
    try {
      const r = await fetch("/api/gpx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (!r.ok) throw new Error((await r.json()).error || r.status);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `fietsgemeenten-${ids.length}-ritten.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert("Downloaden mislukt: " + e.message);
    } finally {
      btn.disabled = false; btn.textContent = "GPX downloaden";
    }
  });
  $("todo-drop").addEventListener("click", (e) => {
    const el = e.target.closest("[data-code]");
    if (el) focusGemeente(el.dataset.code);
  });
  document.querySelector(".lists").addEventListener("click", (e) => {
    const el = e.target.closest("[data-code]");
    if (el) focusGemeente(el.dataset.code);
  });

  // Instellingen
  const dlg = $("dlg-settings");
  $("btn-settings").addEventListener("click", () => {
    const st = S.status || { all_types: [], sport_types: [] };
    const f = $("form-settings");
    f.client_id.value = st.client_id || "";
    f.client_secret.value = "";
    $("set-types").innerHTML = st.all_types.map(([k, v]) =>
      `<label><input type="checkbox" name="types" value="${esc(k)}" ${st.sport_types.includes(k) ? "checked" : ""}>${esc(v)}</label>`).join("");
    $("btn-disconnect").hidden = !st.connected;
    const es = window.FGEngine.stats();
    $("set-data-info").textContent = `Je ${nf.format(es.activities)} activiteiten en je instellingen staan alleen in deze browser op dit apparaat. Wis je je browsergegevens, dan zijn ze weg: maak dus af en toe een back-up.`;
    renderRoundSettings();
    if (window.FGParty) window.FGParty.renderSettings($("set-party"), fmtDate);
    loadBikes();
    dlg.showModal();
  });
  async function loadBikes() {
    const list = await (await api("/api/bikes")).json();
    $("set-bikes-fs").hidden = list.length === 0;
    const names = S.typeNames || {};
    const opts = [["auto", "Automatisch"], ["Ride", "Racefiets / weg"], ["GravelRide", "Gravel"],
      ["MountainBikeRide", "Mountainbike"], ["EBikeRide", "E-bike"], ["EMountainBikeRide", "E-mountainbike"], ["Other", "Niet meetellen"]];
    $("set-bikes").innerHTML = list.map((b) => {
      const mix = Object.entries(b.types).sort((x, y) => y[1] - x[1])
        .map(([t, n]) => `${n}× ${TYPE_SHORT[t] || names[t] || (t === "Other" ? "niet meetellen" : t)}`).join(", ");
      return `<div class="bike-row"><span>${esc(b.name)}</span>
        <select data-bike="${esc(b.name)}">${opts.map(([v, l]) => `<option value="${v}" ${b.choice === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <small>${b.rides} ritten · nu: ${esc(mix)}</small></div>`;
    }).join("");
  }

  dlg.addEventListener("close", async () => {
    if (dlg.returnValue !== "save") return;
    const bikes = {};
    document.querySelectorAll("#set-bikes select").forEach((sel) => { bikes[sel.dataset.bike] = sel.value; });
    if (Object.keys(bikes).length) await post("/api/bikes", { bikes });
    const f = $("form-settings");
    const types = [...f.querySelectorAll('input[name="types"]:checked')].map((i) => i.value);
    await post("/api/settings", { client_id: f.client_id.value, client_secret: f.client_secret.value, sport_types: types });
    S.typesKey = "";
    await pollStatus();
    await loadData();
  });
  function renderRoundSettings() {
    $("set-rounds").innerHTML = `<div class="round-grid"><span></span><span class="rg-h">van</span><span class="rg-h">tot en met</span><span></span>` +
      S.rounds.map((r, i) => `
        <span class="rg-n">Ronde ${i + 1}</span>
        <input type="date" data-ri="${i}" data-f="start" value="${esc(r.start)}" aria-label="Ronde ${i + 1} van" ${i === 0 && !r.start ? 'title="Leeg = vanaf je eerste rit"' : ""}>
        <input type="date" data-ri="${i}" data-f="end" value="${esc(r.end)}" aria-label="Ronde ${i + 1} tot en met" title="Leeg = loopt door">
        ${i === 0 ? "<span></span>" : `<button type="button" class="link-btn" data-del="${i}">Verwijderen</button>`}`).join("") + "</div>";
    $("set-round-date").value = today();
    $("set-round-end").value = "";
  }
  $("set-rounds").addEventListener("change", async (e) => {
    const inp = e.target.closest("[data-ri]");
    if (!inp) return;
    const i = Number(inp.dataset.ri);
    const next = S.rounds.map((r) => ({ ...r }));
    next[i][inp.dataset.f] = inp.value;
    const err = i === 0 && !next[i].start ? (next[i].end && next[i].end < "1900" ? "Ongeldige datum." : "") : roundError(next[i].start, next[i].end, i);
    if (err) { alert(err); renderRoundSettings(); return; }
    await saveRounds(next);
    renderRoundSettings();
  });
  $("set-rounds").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    const i = Number(b.dataset.del);
    if (!confirm(`${roundLabel(i).name} (${roundLabel(i).since}) verwijderen? Je ritten blijven bewaard.`)) return;
    await saveRounds(S.rounds.filter((_, j) => j !== i));
    renderRoundSettings();
  });
  $("btn-add-round").addEventListener("click", async () => {
    const d = $("set-round-date").value, t = $("set-round-end").value;
    const err = roundError(d, t, -1);
    if (err) { alert(err); return; }
    S.selectAfter = { start: d, end: t };
    await saveRounds([...S.rounds, { start: d, end: t }]);
    renderRoundSettings();
  });

  $("btn-disconnect").addEventListener("click", async () => {
    if (!confirm("Strava ontkoppelen? Je opgehaalde ritten blijven bewaard.")) return;
    await post("/api/disconnect");
    dlg.close();
    pollStatus();
  });

  // Archief kiezen en inlezen
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.id === "btn-sync") return;
    if (b.dataset.action === "settings") { $("btn-settings").click(); return; }
    if (b.dataset.action === "routecheck") { window.FG.routeCheck(); return; }
    if (b.dataset.action === "pick-archive") { e.preventDefault(); $("archive-file").click(); }
    else if (b.dataset.action === "pick-backup") { e.preventDefault(); $("backup-file").click(); }
    else if (b.dataset.action === "backup") { e.preventDefault(); makeBackup(); }
    else if (b.dataset.action === "wipe") { e.preventDefault(); wipeAll(); }
    else if (b.dataset.action === "stop-import") { await post("/api/import/stop"); pollStatus(); }
  });
  $("archive-file").addEventListener("change", (e) => uploadArchive(e.target.files[0]));
  // Slepen en neerzetten van het zip-bestand op de pagina
  window.addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dragging"); });
  window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dragging"); });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    document.body.classList.remove("dragging");
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    if (/\.(gpx|tcx|fit)(\.gz)?$/i.test(f.name)) checkRoute(f);
    else uploadArchive(f);
  });

  // ------------------------------------------------------------ routecheck
  function checkSets() {
    const had = roundFirsts(S.round || 0);
    const codes = new Set(S.check.visits.map((v) => v.code));
    return { had, codes };
  }

  function checkStyle(code) {
    const { had, codes } = S.checkSets || checkSets();
    if (codes.has(code)) {
      return had.has(code)
        ? { color: C.border, weight: 1.2, opacity: 1, fillColor: C.visited, fillOpacity: 0.85 }
        : { color: "#0d2a5c", weight: 1.6, opacity: 1, fillColor: CHECK_NEW, fillOpacity: 0.85 };
    }
    return { color: C.border, weight: 1, opacity: 1, fillColor: had.has(code) ? C.soft : C.unvisited, fillOpacity: 1 };
  }

  async function checkRoute(file) {
    if (!file) return;
    if (!Object.keys(S.features).length) { alert("Wacht even tot de kaart geladen is."); return; }
    const card = $("route-card");
    card.hidden = false;
    card.innerHTML = `<div class="rc-busy">Route “${esc(file.name)}” controleren…</div>`;
    try {
      const r = await fetch("/api/route-check", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(file.name).slice(0, 200) }, body: file });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.status);
      d.name = d.name && /%[0-9A-F]{2}/i.test(d.name) ? decodeURIComponent(d.name) : d.name;
      d.pts = decodePolyline(d.polyline);
      if (S.rideSel) clearRide();
      S.check = d;
      S.checkSets = null;
      setView("map");
      render();
      const line = L.polyline(d.pts);
      map.fitBounds(line.getBounds(), { padding: [50, 50], maxZoom: 12 });
      scrollSide(card);
    } catch (e) {
      card.innerHTML = `<div class="rc-err">${esc(e.message)}</div><div class="rc-actions"><button type="button" class="btn small" data-rc="pick">Ander bestand</button><button type="button" class="btn small" data-rc="close">Sluiten</button></div>`;
    } finally {
      $("route-file").value = "";
    }
  }

  const checkLayer = L.layerGroup().addTo(map);
  function renderCheck() {
    checkLayer.clearLayers();
    const card = $("route-card");
    if (!S.check) { if (!card.querySelector(".rc-err") && !card.querySelector(".rc-busy")) card.hidden = true; return; }
    S.checkSets = checkSets();
    const { had } = S.checkSets;
    const d = S.check;
    L.polyline(d.pts, { renderer: selRenderer, color: "#ffffff", weight: 7, opacity: 0.95, interactive: false }).addTo(checkLayer);
    L.polyline(d.pts, { renderer: selRenderer, color: ROUTE_COLOR, weight: 3.5, opacity: 1, interactive: false }).addTo(checkLayer);
    L.circleMarker(d.pts[0], { renderer: selRenderer, radius: 6, color: "#ffffff", weight: 2, fillColor: "#1a7f37", fillOpacity: 1, interactive: false }).addTo(checkLayer);
    L.circleMarker(d.pts[d.pts.length - 1], { renderer: selRenderer, radius: 6, color: "#ffffff", weight: 2, fillColor: "#c4321f", fillOpacity: 1, interactive: false }).addTo(checkLayer);
    const total = Object.keys(S.features).length;
    const rows = d.visits.filter((v) => S.features[v.code]);
    const fresh = rows.filter((v) => !had.has(v.code));
    const old = rows.filter((v) => had.has(v.code));
    const l = roundLabel(S.round || 0);
    const item = (v, isNew) => {
      const f = S.features[v.code];
      const warn = v.m < 300 ? `<span class="rc-warn" title="De route komt maar ${v.m} m in deze gemeente">! ${v.m} m</span>` : `<span class="rc-m">${nf.format(Math.round(v.m / 100) / 10)} km</span>`;
      const extra = isNew ? warn : `<span class="rc-m">sinds ${fmtDate(had.get(v.code).date)}</span>`;
      return `<button type="button" class="rc-item${isNew ? " new" : ""}" data-code="${esc(v.code)}"><span class="rc-n">${esc(f.naam)}</span><span class="rc-p">${esc(f.provincie)}</span>${extra}</button>`;
    };
    card.hidden = false;
    card.innerHTML = `
      <div class="rc-head">
        <div><div class="rc-kicker">Routecheck · ${esc(l.name)}</div><h2>${esc(d.name)}</h2></div>
        <button type="button" class="icon-btn" data-rc="close" aria-label="Routecheck sluiten">×</button>
      </div>
      <div class="rc-sum">${nf.format(d.km)} km · ${rows.length} ${rows.length === 1 ? "gemeente" : "gemeenten"} ·
        <b class="${fresh.length ? "rc-new" : ""}">${fresh.length} nieuw</b></div>
      <div class="rc-after">${fresh.length ? `Na deze rit sta je in ${esc(l.name)} op <b>${had.size + fresh.length}</b> van ${total} (nu ${had.size}).` : `Geen nieuwe gemeenten voor ${esc(l.name)}: je hebt ze allemaal al gehad.`}</div>
      ${d.sparse ? `<p class="rc-note">Dit bestand bevat alleen losse routepunten, geen volledig spoor. De app trekt rechte lijnen tussen de punten, dus het resultaat kan afwijken. Exporteer de route liefst als “track”.</p>` : ""}
      ${fresh.length ? `<div class="rc-group">Nieuw <span>(in volgorde van de route)</span></div><div class="rc-list">${fresh.map((v) => item(v, true)).join("")}</div>` : ""}
      ${fresh.some((v) => v.m < 300) ? `<p class="rc-note"><b class="rc-warn-i">!</b> = de route komt maar heel kort in die gemeente. Telt wel, maar één verkeerde afslag en je mist hem.</p>` : ""}
      ${old.length ? `<details class="rc-old"><summary>Al gehad (${old.length})</summary><div class="rc-list">${old.map((v) => item(v, false)).join("")}</div></details>` : ""}
      <div class="rc-actions"><button type="button" class="btn small" data-rc="pick">Andere route</button><button type="button" class="btn small" data-rc="close">Sluiten</button></div>`;
    syncNav();
  }

  // Routecheck vanuit het menu: eerst uitleg en een vak om het bestand in te zetten
  function openCheckIntro() {
    setView("map");
    if (S.check) { syncNav(); scrollSide($("route-card")); return; }
    const card = $("route-card");
    const l = roundLabel(S.round || 0);
    card.hidden = false;
    card.innerHTML = `
      <div class="rc-head">
        <div><div class="rc-kicker">Routecheck · ${esc(l.name)}</div><h2>Route controleren</h2></div>
        <button type="button" class="icon-btn" data-rc="close" aria-label="Routecheck sluiten">×</button>
      </div>
      <p class="rc-after">Kies een geplande route. Je ziet meteen welke gemeenten hij raakt, in welke volgorde, en welke nieuw zijn in ${esc(l.name)}.</p>
      <button type="button" class="rc-drop" data-rc="pick">
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
        <span><b>Kies een bestand</b> of sleep het hierheen</span>
        <small>GPX, TCX of FIT</small>
      </button>
      <p class="rc-note">Tip: exporteer uit je routeplanner (Komoot, RideWithGPS, Garmin) als <b>track</b>, niet alleen als routepunten. Dan volgt de controle de wegen precies.</p>`;
    syncNav();
    scrollSide(card);
  }

  function closeCheck(rerender = true) {
    S.check = null;
    S.checkSets = null;
    checkLayer.clearLayers();
    $("route-card").hidden = true;
    $("route-card").innerHTML = "";
    syncNav();
    if (rerender) render();
  }

  $("btn-route-check").addEventListener("click", () => $("route-file").click());
  $("route-file").addEventListener("change", (e) => checkRoute(e.target.files[0]));
  $("route-card").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rc]");
    if (b && b.dataset.rc === "close") { closeCheck(); return; }
    if (b && b.dataset.rc === "pick") { $("route-file").click(); return; }
    const it = e.target.closest("[data-code]");
    if (it) focusGemeente(it.dataset.code);
  });

  // Meldingen na het koppelen
  const params = new URLSearchParams(location.search);
  const MSG = {
    instellingen: "Vul eerst je Client ID en Client Secret in.",
    geweigerd: "Je hebt de koppeling bij Strava geweigerd. Probeer het opnieuw als je toch wilt koppelen.",
    rechten: "Geef bij het koppelen ook toestemming om je activiteiten te bekijken (laat dat vinkje bij Strava aan staan).",
    koppeling: "Koppelen is mislukt. Controleer je Client ID en Client Secret in de instellingen.",
  };
  if (params.get("fout") || params.get("gekoppeld")) {
    showBanner(params.get("gekoppeld") ? "Gekoppeld!" : MSG[params.get("fout")] || "Er ging iets mis.", !!params.get("gekoppeld"));
    history.replaceState(null, "", location.pathname);
  }

  // Start
  // Start altijd op het overzicht
  setTimeout(() => setView("home"), 0);
  (async () => {
    await pollStatus();
    await loadGemeenten();
    await loadData();
  })();
})();
