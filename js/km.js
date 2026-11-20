/* Fietsgemeenten - kilometerscherm: jaardoel, schema, prognose en ritten per maand */
(function () {
  "use strict";

  // Fietsen: 80% in maart t/m oktober (10% per maand), 20% in de andere maanden (5% per maand)
  const W_BIKE = [0.05, 0.05, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.05, 0.05];
  // Te voet: elke maand even veel
  const W_FOOT = Array(12).fill(1 / 12);
  let W = W_BIKE; // verdeling van de soort die nu berekend wordt (zie weightsFor)
  const MAAND = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const KORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const COL = {
    out: "#eb6834", ind: "#3987e5", walk: "#45b07c", run: "#11724a",
    ink: "#0b0b0b", ink2: "#52514e", muted: "#898781",
    grid: "#ecebe6", ahead: "#1a7f37", behind: "#c4321f", plan: "#52514e",
    surface: "#ffffff", line2: "#d7d6d0", accentInk: "#b8461a",
  };
  const TYPE_SHORT = { Ride: "Weg", GravelRide: "Gravel", MountainBikeRide: "MTB", EBikeRide: "E-bike",
    EMountainBikeRide: "E-MTB", VirtualRide: "Indoor", Velomobile: "Velomobiel", Handcycle: "Handbike",
    Walk: "Wandeling", Hike: "Hike", Run: "Hardlopen", TrailRun: "Trailrun" };
  // Per scherm: welke series (gestapeld van onder naar boven), kleur van de lijn, woorden
  const MODES = {
    bike: { name: "Fietsen", series: ["out", "ind"], line: "#eb6834", lineDark: "#b8461a", noun: ["rit", "ritten"], verb: "gereden" },
    foot: { name: "Wandelen", series: ["walk", "run"], line: "#2f9a68", lineDark: "#11724a", noun: ["keer op pad", "keer op pad"], verb: "gelopen" },
    total: { name: "Totaal", series: ["out", "ind", "walk", "run"], line: "#3b3a36", lineDark: "#0b0b0b", noun: ["activiteit", "activiteiten"], verb: "afgelegd" },
  };
  const SERIES = { out: "Fietsen buiten", ind: "Fietsen indoor", walk: "Wandelen", run: "Hardlopen" };

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sum = (a) => a.reduce((t, x) => t + x, 0);
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDay = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });

  const K = { rides: [], goals: {}, goalsFoot: {}, year: new Date().getFullYear(), sel: null, loaded: false, visible: false, mode: "bike" };
  try { K.mode = localStorage.getItem("fg-km-mode") || "bike"; } catch { /* geen opslag */ }
  if (!MODES[K.mode]) K.mode = "bike";
  K.view = "year";
  try { K.view = localStorage.getItem("fg-km-view") || "year"; } catch { /* geen opslag */ }
  if (!["year", "period", "weeks"].includes(K.view)) K.view = "year";
  K.period = null; // {start, end}
  const tcache = new Map(); // doelen per maand, opnieuw berekend bij elke weergave

  const goalOf = (mode, y) => {
    const b = Number(K.goals[String(y)] || 0), f = Number(K.goalsFoot[String(y)] || 0);
    return mode === "bike" ? b : mode === "foot" ? f : b + f;
  };
  // Verdeling over de maanden; voor Totaal de som van beide schema's
  function weightsFor(mode, y) {
    if (mode === "bike") return W_BIKE;
    if (mode === "foot") return W_FOOT;
    const b = goalOf("bike", y), f = goalOf("foot", y);
    if (!b && !f) return W_BIKE;
    return W_BIKE.map((w, i) => (b * w + f * W_FOOT[i]) / (b + f));
  }
  const inMode = (mode, r) => mode === "total" || r.cat === mode;

  // ------------------------------------------------------------- rekenen
  function today() {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() };
  }
  const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
  const isLeap = (y) => new Date(y, 1, 29).getMonth() === 1;
  const dayOfYear = (y, m, d) => Math.round((new Date(y, m, d) - new Date(y, 0, 1)) / 864e5) + 1;

  function model() {
    const y = K.year;
    const t = today();
    const mode = K.mode;
    W = weightsFor(mode, y);
    const ser = { out: Array(12).fill(0), ind: Array(12).fill(0), walk: Array(12).fill(0), run: Array(12).fill(0) };
    const cnt = Array(12).fill(0);
    const rides = K.rides.filter((r) => r.date.startsWith(String(y)) && inMode(mode, r));
    for (const r of rides) {
      const m = Number(r.date.slice(5, 7)) - 1;
      ser[r.sub || (r.indoor ? "ind" : "out")][m] += r.km;
      cnt[m]++;
    }
    const tot = Array.from({ length: 12 }, (_, i) => ser.out[i] + ser.ind[i] + ser.walk[i] + ser.run[i]);
    const { out, ind } = ser;
    const G = goalOf(mode, y);
    const T = W.map((w) => G * w);
    // c = huidige maand (0-11) in het lopende jaar; 12 = jaar voorbij; -1 = jaar nog niet begonnen
    const c = y < t.y ? 12 : y > t.y ? -1 : t.m;
    const dayFrac = c >= 0 && c < 12 ? t.d / daysIn(y, c) : 0;
    // Inhaaldoel: wat nog over is van het jaardoel, verdeeld over de resterende maanden (weer 80/20)
    const adj = T.slice();
    if (c >= 0 && c < 12 && G) {
      const done = sum(tot.slice(0, c));
      const rest = Math.max(0, G - done);
      const wRest = sum(W.slice(c));
      for (let m = c; m < 12; m++) adj[m] = rest * W[m] / wRest;
    }
    const ytd = sum(tot.slice(0, Math.max(0, Math.min(c + 1, 12))));
    const fracToday = c >= 12 ? 1 : c < 0 ? 0 : sum(W.slice(0, c)) + W[c] * dayFrac;
    const planToday = G * fracToday;
    const monthSched = c >= 0 && c < 12 ? adj[c] * dayFrac : 0;
    const projected = fracToday > 0.02 ? ytd / fracToday : null;
    return { y, t, mode, MD: MODES[mode], ser, out, ind, tot, cnt, G, T, adj, c, dayFrac, ytd, fracToday, planToday, monthSched, projected, rides };
  }

  // ---------------------------------------------------------------- laden
  async function load() {
    const r = await fetch("/api/km");
    const d = await r.json();
    K.rides = d.rides;
    K.goals = d.goals || {};
    K.goalsFoot = d.goals_foot || {};
    K.loaded = true;
  }

  async function show() {
    K.visible = true;
    if (!K.loaded) await load();
    render();
  }

  async function refresh() {
    await load();
    checkKmParties();
    if (K.visible && !$("km-view").hidden) render();
    if (window.FGHome) window.FGHome.refresh();
  }

  // ---------------------------------------------------------- mijlpalen
  const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });

  function planFrac(y, d) {
    const nDays = 365 + (isLeap(y) ? 1 : 0);
    const dt = new Date(y, 0, d);
    const mo = d >= nDays ? 11 : dt.getMonth();
    const dd = d >= nDays ? 31 : dt.getDate();
    return Math.min(1, sum(W.slice(0, mo)) + W[mo] * (dd / daysIn(y, mo)));
  }

  function kmMilestones(y, G, mode) {
    const rides = K.rides.filter((r) => r.date.startsWith(String(y)) && inMode(mode, r)).sort((a, b) => a.date.localeCompare(b.date));
    let run = 0;
    const hits = {};
    for (const r of rides) {
      run += r.km;
      for (const pct of [50, 75, 90, 100]) if (!hits[pct] && G && run >= (pct / 100) * G) hits[pct] = r.date;
    }
    return [50, 75, 90, 100].map((pct) => ({ pct, date: hits[pct] || null }));
  }

  function checkKmParties() {
    if (!window.FGParty) return;
    const thisYear = new Date().getFullYear();
    // Eigen feestjes voor het fietsdoel en voor het doel te voet
    for (const [mode, goals, prefix, label] of [["bike", K.goals, "km", "Fietsdoel"], ["foot", K.goalsFoot, "foot", "Wandeldoel"]]) {
      for (const [yy, g] of Object.entries(goals)) {
        const y = Number(yy), G = Number(g);
        if (!G) continue;
        const items = kmMilestones(y, G, mode).map((m) => ({ ...m, build: () => kmCard(y, G, m, mode) }));
        window.FGParty.check(`${prefix}-${y}-${G}`, `${label} ${y} (${nf.format(G)} km)`, items, y === thisYear);
      }
    }
  }

  function kmCard(y, G, m, mode) {
    W = weightsFor(mode, y);
    const MD = MODES[mode];
    const what = mode === "foot" ? "wandeldoel" : "fietsdoel";
    const rides = K.rides.filter((r) => r.date.startsWith(String(y)) && inMode(mode, r));
    const upto = rides.filter((r) => r.date <= m.date);
    const kmUpto = sum(upto.map((r) => r.km));
    const total = sum(rides.map((r) => r.km));
    // dagen voor/achter: wanneer zou het schema dit percentage halen?
    const dReached = dayOfYear(y, Number(m.date.slice(5, 7)) - 1, Number(m.date.slice(8, 10)));
    let dPlan = 1;
    while (dPlan < 366 && planFrac(y, dPlan) < m.pct / 100) dPlan++;
    const diff = dPlan - dReached;
    const sched = diff >= 0 ? `<span class="ok">▲ ${diff} ${diff === 1 ? "dag" : "dagen"} voor</span>` : `<span class="bad">▼ ${-diff} ${diff === -1 ? "dag" : "dagen"} achter</span>`;
    const longest = upto.reduce((a, b) => (!a || b.km > a.km ? b : a), null);
    const perMonth = Array(12).fill(0);
    for (const r of upto) perMonth[Number(r.date.slice(5, 7)) - 1] += r.km;
    const bm = perMonth.indexOf(Math.max(...perMonth));
    const card = { rows: [] };
    if (m.pct === 50) {
      card.title = "Halverwege!";
      card.lead = `${nf.format(G / 2)} km ${MD.verb}: de helft van je ${what} van ${nf.format(G)} km.`;
      card.rows = [["Bereikt op", fmtDate(m.date)], ["Op schema", sched], [cap(MD.noun[1]), nf.format(upto.length)], [`Gemiddeld per ${MD.noun[0]}`, `${nf1.format(kmUpto / Math.max(1, upto.length))} km`]];
    } else if (m.pct === 75) {
      card.title = "Driekwart!";
      card.lead = `${nf.format(G * 0.75)} km van je ${what} van ${nf.format(G)} km ${MD.verb}. Het einde komt in zicht.`;
      card.rows = [["Bereikt op", fmtDate(m.date)], ["Op schema", sched], [cap(MD.noun[1]), nf.format(upto.length)]];
      if (longest) card.rows.push([mode === "foot" ? "Langste tocht" : "Langste rit", `${nf1.format(longest.km)} km · ${esc(longest.name || "")}`]);
      card.rows.push(["Beste maand", `${MAAND[bm]} · ${nf.format(perMonth[bm])} km`]);
    } else if (m.pct === 90) {
      const left = Math.max(0, G - total);
      const avg = sum(rides.filter((r) => !r.indoor).map((r) => r.km)) / Math.max(1, rides.filter((r) => !r.indoor).length);
      const t = today();
      const weeks = y === t.y ? Math.max(1, (dayOfYear(y, 11, 31) - dayOfYear(y, t.m, t.d) + 1) / 7) : 1;
      card.title = "De laatste loodjes";
      card.lead = left > 0 ? `Nog <b>${nf.format(left)} km</b> tot je ${what} van ${nf.format(G)} km.` : `Je zit al boven de ${nf.format(G * 0.9)} km.`;
      card.rows = [["Bereikt op", fmtDate(m.date)], ["Op schema", sched]];
      if (left > 0) {
        card.rows.push(["Dat is ongeveer", `${Math.ceil(left / Math.max(1, avg))} ${mode === "foot" ? "keer" : "ritten"} van je gemiddelde ${nf1.format(avg)} km`]);
        if (y === t.y) card.rows.push(["Per week tot 31 december", `${nf.format(left / weeks)} km`]);
      }
    } else {
      const ind = sum(rides.filter((r) => r.indoor).map((r) => r.km));
      const allMonth = Array(12).fill(0);
      for (const r of rides) allMonth[Number(r.date.slice(5, 7)) - 1] += r.km;
      const best = allMonth.indexOf(Math.max(...allMonth));
      const lng = rides.reduce((a, b) => (!a || b.km > a.km ? b : a), null);
      card.title = mode === "foot" ? "Wandeldoel gehaald!" : "Fietsdoel gehaald!";
      card.lead = `${nf.format(G)} km ${MD.verb} in ${y}. Gehaald op ${fmtDate(m.date)}.`;
      card.rows = [["Totaal tot nu", `${nf.format(total)} km`], ["Op schema", sched], [cap(MD.noun[1]), nf.format(rides.length)]];
      if (mode === "bike" && ind) card.rows.push(["Waarvan indoor", `${nf.format(ind)} km`]);
      if (mode === "foot") {
        const run = sum(rides.filter((r) => r.sub === "run").map((r) => r.km));
        if (run) card.rows.push(["Waarvan hardlopen", `${nf.format(run)} km`]);
      }
      card.rows.push(["Beste maand", `${MAAND[best]} · ${nf.format(allMonth[best])} km`]);
      if (lng) card.rows.push([mode === "foot" ? "Langste tocht" : "Langste rit", `${nf1.format(lng.km)} km · ${esc(lng.name || "")}`]);
      if (mode === "bike" && window.FG && window.FG.gemeentenInYear) {
        card.rows.push(["Gemeenten aangedaan", nf.format(window.FG.gemeentenInYear(y))]);
        const nw = window.FG.newGemeentenInYear(y);
        if (nw) card.rows.push(["Voor het eerst", `${nf.format(nw)} gemeenten`]);
      }
      card.note = "Nog niet klaar? Verhoog je doel bij Kilometers.";
    }
    return card;
  }

  // Kleuren volgen het thema (licht/donker)
  function themeColors() {
    const T = window.FGTheme;
    if (!T) return;
    const c = (n, d) => T.css(n) || d;
    Object.assign(COL, {
      out: c("--accent", COL.out), ink: c("--ink", COL.ink), ink2: c("--ink-2", COL.ink2), muted: c("--muted", COL.muted),
      grid: c("--line-soft", COL.grid), ahead: c("--good", COL.ahead), behind: c("--bad", COL.behind), plan: c("--ink-2", COL.plan),
      surface: c("--surface", COL.surface), line2: c("--line-2", COL.line2), accentInk: c("--accent-ink", COL.accentInk),
    });
    MODES.bike.line = COL.out; MODES.bike.lineDark = COL.accentInk;
    MODES.total.line = COL.ink2; MODES.total.lineDark = COL.ink;
  }

  // ---------------------------------------------------------------- tekenen
  function render() {
    themeColors();
    document.querySelectorAll(".kmode").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === K.mode)));
    document.querySelectorAll(".kview").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kview === K.view)));
    $("kv-year").hidden = K.view !== "year";
    $("kv-period").hidden = K.view !== "period";
    $("kv-weeks").hidden = K.view !== "weeks";
    tcache.clear();
    if (K.view === "period") renderPeriod();
    else if (K.view === "weeks") renderWeeks();
    else renderYear();
  }

  function renderYear() {
    const M = model();
    $("km-year").textContent = M.y;
    const years = K.rides.map((r) => Number(r.date.slice(0, 4)));
    const minY = Math.min(M.t.y, ...years);
    $("km-prev").disabled = M.y <= minY;
    $("km-next").disabled = M.y >= M.t.y + 1;
    document.querySelectorAll(".kmode").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === M.mode)));
    const inp = $("goal-input");
    const total = M.mode === "total";
    $("goal-form").hidden = total;
    $("goal-total").hidden = !total;
    $("goal-label").textContent = M.mode === "foot" ? "Wandeldoel" : "Fietsdoel";
    if (total) {
      const b = goalOf("bike", M.y), f = goalOf("foot", M.y);
      $("goal-total").innerHTML = b || f ? `Totaaldoel <b>${nf.format(b + f)} km</b> <span>= fietsen ${nf.format(b)} + wandelen ${nf.format(f)}</span>` : "Stel bij Fietsen en Wandelen een doel in.";
    }
    if (document.activeElement !== inp) inp.value = M.G || "";
    renderKpis(M);
    renderBars(M);
    renderCum(M);
    renderMonth(M);
    renderWeather(M);
  }

  // ---------------------------------------------------------- weerrecords
  function renderWeather(M) {
    const el = $("km-wx");
    const all = !!K.wxAll;
    const pool = (all ? K.rides.filter((r) => inMode(M.mode, r)) : M.rides).filter((r) => !r.indoor);
    const withWx = pool.filter((r) => r.wx);
    const what = M.mode === "foot" ? "wandelingen" : M.mode === "total" ? "activiteiten" : "ritten";
    const toggle = `<div class="seg small" role="group" aria-label="Periode"><button type="button" class="seg-btn" data-wxall="0" aria-pressed="${!all}">${M.y}</button><button type="button" class="seg-btn" data-wxall="1" aria-pressed="${all}">Alle jaren</button></div>`;
    const head = `<div class="kcard-head"><h2>Weer</h2>${toggle}</div>`;
    if (!withWx.length) {
      el.innerHTML = `${head}<p class="hint">Nog geen weergegevens${pool.length ? ` bij je ${what}` : ""}. Zet "Weer bij je activiteiten" aan in Instellingen; het weer wordt dan op de achtergrond opgehaald.</p>`;
      return;
    }
    const X = window.FGWx;
    const pick = (key, dir, min = 0) => withWx.filter((r) => r.wx[key] != null && r.km >= min).sort((a, b) => dir * (b.wx[key] - a.wx[key]))[0];
    const recs = [
      ["Koudste", pick("t", -1), (w) => `${nf1.format(w.t)} °C`, X.icon(71, 20)],
      ["Warmste", pick("t", 1), (w) => `${nf1.format(w.t)} °C`, X.icon(0, 20)],
      ["Natste", pick("p", 1), (w) => `${nf1.format(w.p)} mm`, X.icon(63, 20)],
      ["Meeste wind", pick("ws", 1), (w) => `${w.ws} km/u · ${X.bft(w.ws)} Bft`, X.arrow(225, 20)],
      ["Hardste windstoot", pick("gu", 1), (w) => `${w.gu} km/u`, X.arrow(270, 20)],
      ["Meeste tegenwind", pick("hw", 1, 10), (w) => `${w.hw}% van de route`, X.arrow(0, 20)],
    ].filter((x) => x[1] && !(x[0] === "Natste" && !(x[1].wx.p > 0)));
    const recHtml = recs.map(([k, r, v, ic]) => `<button type="button" class="wx-rec" data-ride="${r.id}">
        <span class="wr-ic">${ic}</span><span class="wr-t"><span class="wr-k">${k}</span><span class="wr-v">${v(r.wx)}</span>
        <span class="wr-n">${esc(r.name || "Activiteit")} · ${fmtDate(r.date)} · ${nf.format(r.km)} km</span></span></button>`).join("");
    const totKm = withWx.reduce((s, r) => s + r.km, 0);
    const wetKm = withWx.filter((r) => r.wx.p >= 0.5).reduce((s, r) => s + r.km, 0);
    const avgT = withWx.reduce((s, r) => s + r.wx.t * r.km, 0) / Math.max(totKm, 1);
    const headKm = withWx.filter((r) => r.wx.hw != null).reduce((s, r) => s + (r.km * r.wx.hw) / 100, 0);
    const tailKm = withWx.filter((r) => r.wx.tw != null).reduce((s, r) => s + (r.km * r.wx.tw) / 100, 0);
    el.innerHTML = `${head}
      <div class="wx-grid">
        <div class="wx-recs">${recHtml}</div>
        <div class="wx-dist">
          <p class="wx-sum"><b>${nf1.format(avgT)} °C</b> gemiddeld · <b>${Math.round((wetKm / Math.max(totKm, 1)) * 100)}%</b> van je kilometers nat · <b>${nf.format(Math.round(headKm))} km</b> tegenwind tegen <b>${nf.format(Math.round(tailKm))} km</b> meewind</p>
          <p class="wx-al-h">Kilometers per temperatuur, per seizoen</p>
          ${tempCurve(withWx)}
          <p class="hint">Weer bekend bij ${nf.format(withWx.length)} van ${nf.format(pool.length)} ${what}${all ? "" : ` in ${M.y}`}. Weer: Open-Meteo, rond het startpunt.</p>
        </div>
      </div>`;
  }

  // Vloeiende verdeling van je kilometers over de temperatuur (kerndichtheid, 1,5° breed),
  // als vlak voor het totaal en een lijn per seizoen. Klik een seizoen om het uit te lichten.
  const SEASONS = [
    ["winter", "Winter", [12, 1, 2]], ["lente", "Lente", [3, 4, 5]],
    ["zomer", "Zomer", [6, 7, 8]], ["herfst", "Herfst", [9, 10, 11]],
  ];
  function tempCurve(rides) {
    const ts = rides.map((r) => r.wx.t);
    const lo = Math.max(-15, Math.floor(Math.min(...ts)) - 3), hi = Math.min(40, Math.ceil(Math.max(...ts)) + 3);
    const BW = 1.5, NORM = 1 / (BW * Math.sqrt(2 * Math.PI)), STEP = 0.25;
    const xs = [];
    for (let x = lo; x <= hi + 1e-9; x += STEP) xs.push(x);
    const dens = (list) => xs.map((x) => list.reduce((s, r) => s + r.km * NORM * Math.exp(-0.5 * ((x - r.wx.t) / BW) ** 2), 0));
    const month = (r) => Number(r.date.slice(5, 7));
    const per = SEASONS.map(([k, l, ms]) => {
      const list = rides.filter((r) => ms.includes(month(r)));
      const km = list.reduce((s, r) => s + r.km, 0);
      return { k, l, km, avg: km ? list.reduce((s, r) => s + r.km * r.wx.t, 0) / km : null, d: list.length ? dens(list) : null };
    });
    const tot = dens(rides);
    const yMax = Math.max(...tot, 1) * 1.08;
    const CW = 560, H = 210, L = 8, Rr = 8, T = 10, B = 26;
    const X = (x) => L + ((x - lo) / (hi - lo)) * (CW - L - Rr);
    const Y = (v) => T + (1 - v / yMax) * (H - T - B);
    const line = (d) => d.map((v, i) => `${i ? "L" : "M"}${X(xs[i]).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
    const sel = K.wxSeason || "";
    const ticks = [];
    for (let t = Math.ceil(lo / 5) * 5; t <= hi; t += 5) ticks.push(`<line class="g" x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${T}" y2="${H - B}"/><text class="tx" x="${X(t).toFixed(1)}" y="${H - 8}" text-anchor="middle">${t}°</text>`);
    const zero = lo < 0 && hi > 0 ? `<line class="z" x1="${X(0).toFixed(1)}" x2="${X(0).toFixed(1)}" y1="${T}" y2="${H - B}"/>` : "";
    const seasonPaths = per.filter((p) => p.d).map((p) => `<path class="sl s-${p.k}${sel && sel !== p.k ? " dim" : ""}${sel === p.k ? " on" : ""}" d="${line(p.d)}"/>`).join("");
    const area = `${line(tot)}L${X(hi).toFixed(1)} ${Y(0)}L${X(lo).toFixed(1)} ${Y(0)}Z`;
    const legend = per.map((p) => `<button type="button" class="wx-sea s-${p.k}" data-season="${p.k}" aria-pressed="${sel === p.k}"${p.km ? "" : " disabled"}>
        <i></i><span class="ws-l">${p.l}</span><span class="ws-v">${nf.format(Math.round(p.km))} km${p.avg != null ? ` · gem. ${nf1.format(p.avg)}°` : ""}</span></button>`).join("");
    return `<svg class="wx-curve" viewBox="0 0 ${CW} ${H}" role="img" aria-label="Kilometers per temperatuur">
        ${ticks.join("")}${zero}<line class="g" x1="${L}" x2="${CW - Rr}" y1="${Y(0)}" y2="${Y(0)}"/>
        <path class="ta${sel ? " dim" : ""}" d="${area}"/><path class="tl${sel ? " dim" : ""}" d="${line(tot)}"/>${seasonPaths}
      </svg>
      <div class="wx-seas">${legend}</div>`;
  }

  function status(diff, label) {
    const ahead = diff >= 0;
    const icon = ahead ? "▲" : "▼";
    return `<div class="kpi-status ${ahead ? "ahead" : "behind"}"><span class="ico" aria-hidden="true">${icon}</span>` +
      `${nf.format(Math.abs(Math.round(diff)))} km ${ahead ? "voor" : "achter"}<small>${label}</small></div>`;
  }

  function meter(value, target, mark, ticks) {
    if (!target) return "";
    const pct = Math.min(100, (value / target) * 100);
    const mk = mark != null ? `<span class="meter-mark" style="left:${Math.min(100, (mark / target) * 100)}%" title="Schema vandaag"></span>` : "";
    const tk = ticks ? '<i style="left:50%"></i><i style="left:75%"></i><i style="left:90%"></i>' : "";
    return `<div class="kmeter"><div class="kmeter-fill" style="width:${pct}%"></div>${tk}${mk}</div>`;
  }

  function renderKpis(M) {
    const el = $("km-kpis");
    const tiles = [];
    const weeksLeftYear = M.c >= 0 && M.c < 12 ? Math.max(1, (365 + (isLeap(M.y) ? 1 : 0) - dayOfYear(M.y, M.t.m, M.t.d) + 1) / 7) : 0;

    if (M.c >= 0 && M.c < 12) {
      // Lopend jaar
      const mKm = M.tot[M.c];
      const mName = MAAND[M.c];
      const daysLeft = daysIn(M.y, M.c) - M.t.d;
      if (M.G) {
        const need = Math.max(0, M.adj[M.c] - mKm);
        const perWeek = need / Math.max(1, (daysLeft + 1) / 7);
        tiles.push(`<div class="kpi">
          <div class="kpi-label">${M.MD.name} · deze maand · ${mName}</div>
          ${status(mKm - M.monthSched, "op schema van vandaag")}
          <div class="kpi-main"><b>${nf.format(mKm)}</b> van ${nf.format(M.adj[M.c])} km${Math.abs(M.adj[M.c] - M.T[M.c]) > 1 ? ' <span class="tag">inhaaldoel</span>' : ""}</div>
          ${meter(mKm, M.adj[M.c], M.monthSched)}
          <div class="kpi-sub">${need > 0 ? `Nog <b>${nf.format(need)} km</b> in ${daysLeft + 1} ${daysLeft === 0 ? "dag" : "dagen"} · ${nf.format(perWeek)} km per week` : "Maanddoel gehaald! Alles extra is winst voor je jaardoel."}</div>
        </div>`);
        tiles.push(`<div class="kpi">
          <div class="kpi-label">${M.MD.name} · dit jaar · ${M.y}</div>
          ${status(M.ytd - M.planToday, "op jaarschema van vandaag")}
          <div class="kpi-main"><b>${nf.format(M.ytd)}</b> van ${nf.format(M.G)} km · ${nf.format((M.ytd / M.G) * 100)}%</div>
          ${meter(M.ytd, M.G, M.planToday, true)}
          ${window.FGParty && M.mode !== "total" ? window.FGParty.medals(kmMilestones(M.y, M.G, M.mode), fmtDate) : ""}
          <div class="kpi-sub">${M.ytd >= M.G ? "Doel gehaald! Chapeau." : `Nog <b>${nf.format(M.G - M.ytd)} km</b> · gemiddeld ${nf.format((M.G - M.ytd) / weeksLeftYear)} km per week`}</div>
        </div>`);
      } else {
        tiles.push(`<div class="kpi"><div class="kpi-label">${M.MD.name} · deze maand · ${mName}</div><div class="kpi-big">${nf.format(mKm)} km</div><div class="kpi-sub">${M.cnt[M.c]} ${M.MD.noun[M.cnt[M.c] === 1 ? 0 : 1]}</div></div>`);
        tiles.push(`<div class="kpi"><div class="kpi-label">${M.MD.name} · dit jaar · ${M.y}</div><div class="kpi-big">${nf.format(M.ytd)} km</div><div class="kpi-sub">${M.mode === "total" ? "Stel bij Fietsen en Wandelen een doel in om te zien of je op schema ligt." : "Stel hierboven een doel in om te zien of je op schema ligt."}</div></div>`);
      }
      if (M.projected != null) {
        const p = M.projected;
        const verdict = M.G ? (p >= M.G ? `<span class="ok">▲ Op dit tempo haal je je doel</span>` : `<span class="bad">▼ ${nf.format(M.G - p)} km tekort op dit tempo</span>`) : "";
        tiles.push(`<div class="kpi">
          <div class="kpi-label">${M.MD.name} · prognose 31 december</div>
          <div class="kpi-big">≈ ${nf.format(p)} km</div>
          <div class="kpi-sub">${verdict}${verdict ? "<br>" : ""}Als je in hetzelfde tempo doorgaat${M.mode === "foot" ? "" : ", met rekening voor de rustiger wintermaanden"}.</div>
        </div>`);
      }
    } else if (M.c === 12) {
      // Afgelopen jaar
      const total = sum(M.tot);
      const hit = M.G ? M.tot.filter((v, i) => v >= M.T[i] && M.T[i] > 0).length : 0;
      const best = M.tot.indexOf(Math.max(...M.tot));
      tiles.push(`<div class="kpi"><div class="kpi-label">${M.MD.name} · totaal ${M.y}</div><div class="kpi-big">${nf.format(total)} km</div>
        <div class="kpi-sub">${M.G ? (total >= M.G ? `<span class="ok">▲ Doel van ${nf.format(M.G)} km gehaald</span>` : `<span class="bad">▼ ${nf.format(M.G - total)} km onder je doel van ${nf.format(M.G)} km</span>`) : `${sum(M.cnt)} ${M.MD.noun[1]}`}</div>
        ${M.G && M.mode !== "total" && window.FGParty ? window.FGParty.medals(kmMilestones(M.y, M.G, M.mode), fmtDate) : ""}</div>`);
      if (M.G) tiles.push(`<div class="kpi"><div class="kpi-label">Maanddoelen gehaald</div><div class="kpi-big">${hit} van 12</div><div class="kpi-sub">${M.mode === "foot" ? "Elke maand 1/12 van het doel" : M.mode === "bike" ? "Volgens de 80/20-verdeling" : "Fietsen 80/20 plus wandelen per maand"}</div></div>`);
      if (total > 0) tiles.push(`<div class="kpi"><div class="kpi-label">Beste maand</div><div class="kpi-big">${MAAND[best]}</div><div class="kpi-sub">${nf.format(M.tot[best])} km in ${M.cnt[best]} ${M.MD.noun[M.cnt[best] === 1 ? 0 : 1]}</div></div>`);
    } else {
      // Komend jaar
      tiles.push(`<div class="kpi"><div class="kpi-label">${M.y}</div><div class="kpi-big">${M.G ? nf.format(M.G) + " km" : "Nog geen doel"}</div>
        <div class="kpi-sub">${!M.G ? "Stel hierboven je doel in." : M.mode === "foot" ? `Elke maand ${nf.format(M.G / 12)} km.` : M.mode === "bike" ? `Maart t/m oktober ${nf.format(M.G * 0.1)} km per maand, de andere maanden ${nf.format(M.G * 0.05)} km.` : `Samen ${nf.format(M.G)} km: fietsen plus wandelen.`}</div></div>`);
    }
    el.innerHTML = tiles.join("");
  }

  // ---------------------------------------------------------- svg-hulp
  function niceMax(v) {
    // vier ronde stappen (bijv. 250, 500, 750, 1.000)
    if (v <= 0) return 100;
    const raw = v / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10]) if (k * p >= raw) return k * p * 4;
    return 40 * p;
  }
  function svgEl(w, h, body) {
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">${body}</svg>`;
  }
  function yAxis(w, h, m, ymax, unit) {
    let g = "";
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = (ymax / steps) * i;
      const yy = h - m.b - ((h - m.t - m.b) * i) / steps;
      g += `<line x1="${m.l}" x2="${w - m.r}" y1="${yy}" y2="${yy}" stroke="${i ? COL.grid : COL.line2}" stroke-width="1"/>`;
      g += `<text x="${m.l - 8}" y="${yy + 4}" text-anchor="end" class="ax">${nf1.format(v)}${i === steps && unit ? " " + unit : ""}</text>`;
    }
    return g;
  }

  // ---------------------------------------------------------- staven per maand
  function renderBars(M) {
    const box = $("km-bars");
    const w = Math.max(320, box.clientWidth);
    const h = 300;
    const m = { l: 56, r: 12, t: 18, b: 30 };
    const showAdj = M.G && M.c >= 0 && M.c < 12;
    const target = (i) => (showAdj && i >= M.c ? M.adj[i] : M.T[i]);
    const ymax = niceMax(Math.max(...M.tot, ...(M.G ? M.adj.concat(M.T) : [0])) * 1.08);
    const ih = h - m.t - m.b;
    const Y = (v) => h - m.b - (v / ymax) * ih;
    const band = (w - m.l - m.r) / 12;
    const bw = Math.min(46, band * 0.58);
    let g = yAxis(w, h, m, ymax, "km");
    for (let i = 0; i < 12; i++) {
      const cx = m.l + band * i + band / 2;
      const dim = K.sel != null && K.sel !== i;
      const op = dim ? 0.4 : 1;
      // series gestapeld met 2px tussenruimte; alleen het bovenste deel krijgt een afgeronde kop
      const parts = M.MD.series.map((k) => [k, M.ser[k][i]]).filter(([, v]) => v > 0);
      let acc = 0;
      const yt = Y(M.tot[i]);
      parts.forEach(([k, v], j) => {
        const bottom = Y(acc) - (j ? 2 : 0);
        acc += v;
        const top = Y(acc);
        if (bottom - top <= 0.5) return;
        const last = j === parts.length - 1;
        const r = last ? Math.min(4, (bottom - top) / 2) : 0;
        g += `<path d="${roundTop(cx - bw / 2, top, bw, bottom - top, r)}" fill="${COL[k]}" opacity="${op}"/>`;
      });
      // doelstreepjes
      if (M.G) {
        const tv = target(i);
        if (showAdj && i >= M.c && Math.abs(M.adj[i] - M.T[i]) > 1) {
          g += `<line x1="${cx - bw / 2 - 5}" x2="${cx + bw / 2 + 5}" y1="${Y(M.T[i])}" y2="${Y(M.T[i])}" stroke="${COL.muted}" stroke-width="1.5" stroke-dasharray="3 3" opacity="${op}"/>`;
        }
        g += `<line x1="${cx - bw / 2 - 5}" x2="${cx + bw / 2 + 5}" y1="${Y(tv)}" y2="${Y(tv)}" stroke="${COL.ink}" stroke-width="2" stroke-linecap="round" opacity="${op}"/>`;
      }
      // label huidige maand of gekozen maand
      const isCur = M.c === i;
      if ((isCur || K.sel === i) && M.tot[i] > 0) {
        g += `<text x="${cx}" y="${Math.min(yt, M.G ? Y(target(i)) : yt) - 7}" text-anchor="middle" class="val">${nf.format(M.tot[i])}</text>`;
      }
      g += `<text x="${cx}" y="${h - m.b + 18}" text-anchor="middle" class="ax${isCur || K.sel === i ? " cur" : ""}">${KORT[i]}</text>`;
      g += `<rect class="hit" data-m="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih + m.b}" fill="transparent"/>`;
    }
    box.innerHTML = svgEl(w, h, g);
    const leg = M.MD.series.map((k) => `<span><i style="background:${COL[k]}"></i>${SERIES[k]}</span>`);
    if (M.G) leg.push(`<span><i class="tick"></i>${showAdj ? "Maanddoel / inhaaldoel" : "Maanddoel"}</span>`);
    if (showAdj && M.adj.some((v, i) => i >= M.c && Math.abs(v - M.T[i]) > 1)) leg.push(`<span><i class="tick dash"></i>Oorspronkelijk doel</span>`);
    $("km-legend").innerHTML = leg.join("");

    box.querySelectorAll(".hit").forEach((r) => {
      const i = Number(r.dataset.m);
      r.addEventListener("mousemove", (e) => tip(e, barTip(M, i)));
      r.addEventListener("mouseleave", hideTip);
      r.addEventListener("click", () => { K.sel = K.sel === i ? null : i; hideTip(); render(); if (K.sel != null) $("km-month").scrollIntoView({ behavior: "smooth", block: "nearest" }); });
    });
  }

  function roundTop(x, y, w, h, r) {
    if (h <= 0) return "";
    r = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
  }

  function barTip(M, i) {
    const rows = M.MD.series.map((k) => [`<i class="dot" style="background:${COL[k]}"></i>${SERIES[k]}`, `${nf1.format(M.ser[k][i])} km`]);
    rows.push(["Totaal", `<b>${nf1.format(M.tot[i])} km</b> · ${M.cnt[i]} ${M.MD.noun[M.cnt[i] === 1 ? 0 : 1]}`]);
    if (M.G) {
      const showAdj = M.c >= 0 && M.c < 12 && i >= M.c;
      const tv = showAdj ? M.adj[i] : M.T[i];
      rows.push([showAdj && Math.abs(M.adj[i] - M.T[i]) > 1 ? "Inhaaldoel" : "Maanddoel", `${nf.format(tv)} km`]);
      if (showAdj && Math.abs(M.adj[i] - M.T[i]) > 1) rows.push(["Oorspronkelijk", `${nf.format(M.T[i])} km`]);
      if (M.c > i || M.c === 12) {
        const d = M.tot[i] - M.T[i];
        rows.push(["Resultaat", d >= 0 ? `<span class="ok">▲ gehaald (+${nf.format(d)})</span>` : `<span class="bad">▼ ${nf.format(-d)} km tekort</span>`]);
      }
    }
    return `<div class="tt">${MAAND[i]} ${M.y}</div>` + rows.map(([k, v]) => `<div class="tr"><span>${k}</span><span>${v}</span></div>`).join("");
  }

  // ---------------------------------------------------------- opgeteld
  function renderCum(M) {
    const box = $("km-cum");
    const w = Math.max(320, box.clientWidth);
    const h = 280;
    const m = { l: 56, r: 92, t: 16, b: 30 };
    const y = M.y;
    const nDays = 365 + (isLeap(y) ? 1 : 0);
    // werkelijk: per dag opgeteld
    const perDay = new Map(), perDayBike = new Map();
    for (const r of M.rides) {
      perDay.set(r.date, (perDay.get(r.date) || 0) + r.km);
      if (r.cat === "bike") perDayBike.set(r.date, (perDayBike.get(r.date) || 0) + r.km);
    }
    const lastDay = M.c === 12 ? nDays : M.c < 0 ? 0 : dayOfYear(y, M.t.m, M.t.d);
    const cum = [0], cumBike = [0];
    let run = 0, runBike = 0;
    for (let d = 1; d <= lastDay; d++) {
      const dt = new Date(y, 0, d);
      const key = `${y}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      run += perDay.get(key) || 0;
      runBike += perDayBike.get(key) || 0;
      cum.push(run);
      cumBike.push(runBike);
    }
    const split = M.mode === "total"; // fietsen en te voet als twee lagen
    // schema: lineair binnen elke maand
    const fracAt = (day) => {
      const dt = new Date(y, 0, day);
      const mo = day >= nDays ? 11 : dt.getMonth();
      const dd = day >= nDays ? 31 : dt.getDate();
      return Math.min(1, sum(W.slice(0, mo)) + W[mo] * (dd / daysIn(y, mo)));
    };
    const proj = M.projected;
    const top = Math.max(run, M.G || 0, M.c >= 0 && M.c < 12 && proj ? proj : 0);
    const ymax = niceMax(top * 1.05 || 100);
    const ih = h - m.t - m.b;
    const X = (d) => m.l + ((w - m.l - m.r) * d) / nDays;
    const Y = (v) => h - m.b - (v / ymax) * ih;
    let g = yAxis(w, h, m, ymax, "km");
    for (let i = 0; i < 12; i++) {
      const d0 = dayOfYear(y, i, 1) - 1;
      const d1 = dayOfYear(y, i, daysIn(y, i));
      g += `<text x="${X((d0 + d1) / 2)}" y="${h - m.b + 18}" text-anchor="middle" class="ax">${KORT[i]}</text>`;
      if (i) g += `<line x1="${X(d0)}" x2="${X(d0)}" y1="${h - m.b}" y2="${h - m.b + 4}" stroke="${COL.line2}"/>`;
    }
    const labels = [];
    if (M.G) {
      const pts = [];
      for (let d = 0; d <= nDays; d += 3) pts.push(`${X(d).toFixed(1)},${Y(M.G * fracAt(Math.max(1, d)) * (d === 0 ? 0 : 1)).toFixed(1)}`);
      pts.push(`${X(nDays)},${Y(M.G)}`);
      g += `<polyline points="${pts.join(" ")}" fill="none" stroke="${COL.plan}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
      labels.push({ y: Y(M.G), text: `Doel ${nf.format(M.G)}`, color: COL.ink2 });
    }
    if (M.c >= 0 && M.c < 12 && proj) {
      const f0 = M.fracToday;
      const pts = [];
      for (let d = lastDay; d <= nDays; d += 3) {
        const f = fracAt(d);
        pts.push(`${X(d).toFixed(1)},${Y(run + (proj - run) * ((f - f0) / Math.max(1e-6, 1 - f0))).toFixed(1)}`);
      }
      pts.push(`${X(nDays)},${Y(proj)}`);
      g += `<polyline points="${pts.join(" ")}" fill="none" stroke="${M.MD.line}" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>`;
      labels.push({ y: Y(proj), text: `Prognose ${nf.format(proj)}`, color: M.MD.lineDark });
    }
    if (lastDay > 0) {
      const pts = cum.map((v, d) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`);
      if (split) {
        // Totaal: fietsen (oranje) onderaan, te voet (groen) erbovenop, totaallijn erover
        const ptsB = cumBike.map((v, d) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`);
        g += `<polygon points="${X(0)},${Y(0)} ${ptsB.join(" ")} ${X(lastDay)},${Y(0)}" fill="${COL.out}" fill-opacity="0.38"/>`;
        g += `<polygon points="${pts.join(" ")} ${ptsB.slice().reverse().join(" ")}" fill="${COL.walk}" fill-opacity="0.45"/>`;
        g += `<polyline points="${ptsB.join(" ")}" fill="none" stroke="${COL.out}" stroke-width="1.5" stroke-linejoin="round"/>`;
        if (M.c === 12 || !proj) {
          labels.push({ y: Y(runBike / 2), text: `Fietsen ${nf.format(runBike)}`, color: COL.accentInk });
        }
      } else {
        // ruimte onder de lijn in de tint van de lijn (verloop van boven naar beneden)
        g += `<defs><linearGradient id="cum-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${M.MD.line}" stop-opacity="0.32"/>
          <stop offset="1" stop-color="${M.MD.line}" stop-opacity="0.06"/></linearGradient></defs>`;
        g += `<polygon points="${X(0)},${Y(0)} ${pts.join(" ")} ${X(lastDay)},${Y(0)}" fill="url(#cum-fill)"/>`;
      }
      g += `<polyline points="${pts.join(" ")}" fill="none" stroke="${M.MD.line}" stroke-width="2.25" stroke-linejoin="round"/>`;
      g += `<circle cx="${X(lastDay)}" cy="${Y(run)}" r="4.5" fill="${M.MD.line}" stroke="${COL.surface}" stroke-width="2"/>`;
      if (M.c === 12 || !proj) labels.push({ y: Y(run), text: `${nf.format(run)} km`, color: M.MD.lineDark });
    }
    // labels rechts, niet over elkaar
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
    for (const l of labels) g += `<text x="${w - m.r + 8}" y="${l.y + 4}" class="lbl" fill="${l.color}">${esc(l.text)}</text>`;
    g += `<line id="cum-x" x1="0" x2="0" y1="${m.t}" y2="${h - m.b}" stroke="${COL.ink2}" stroke-width="1" opacity="0"/>`;
    g += `<circle id="cum-dot" r="4" fill="${M.MD.line}" stroke="${COL.surface}" stroke-width="2" opacity="0"/>`;
    g += `<rect id="cum-hit" x="${m.l}" y="${m.t}" width="${w - m.l - m.r}" height="${ih}" fill="transparent"/>`;
    box.innerHTML = svgEl(w, h, g);

    const leg = split
      ? [`<span><i style="background:${COL.out};opacity:.6"></i>Fietsen</span>`, `<span><i style="background:${COL.walk};opacity:.7"></i>Wandelen</span>`, `<span><i class="line" style="background:${M.MD.line}"></i>Totaal</span>`]
      : [`<span><i class="area" style="--c:${M.MD.line}"></i>${cap(M.MD.verb)}</span>`];
    if (M.G) leg.push(`<span><i class="line dash"></i>Schema naar je doel</span>`);
    if (M.c >= 0 && M.c < 12 && proj) leg.push(`<span><i class="line dot" style="--c:${M.MD.line}"></i>Prognose</span>`);
    $("km-legend2").innerHTML = leg.join("");

    const hit = box.querySelector("#cum-hit"), xl = box.querySelector("#cum-x"), dot = box.querySelector("#cum-dot");
    const svg = box.querySelector("svg");
    hit.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const d = Math.max(1, Math.min(nDays, Math.round(((px - m.l) / (w - m.l - m.r)) * nDays)));
      const dt = new Date(y, 0, d);
      xl.setAttribute("x1", X(d)); xl.setAttribute("x2", X(d)); xl.setAttribute("opacity", "0.5");
      const rows = [];
      if (d <= lastDay) {
        dot.setAttribute("cx", X(d)); dot.setAttribute("cy", Y(cum[d])); dot.setAttribute("opacity", "1");
        if (split) {
          rows.push([`<i class="dot" style="background:${COL.out}"></i>Fietsen`, `${nf.format(cumBike[d])} km`]);
          rows.push([`<i class="dot" style="background:${COL.walk}"></i>Wandelen`, `${nf.format(cum[d] - cumBike[d])} km`]);
          rows.push(["Totaal", `<b>${nf.format(cum[d])} km</b>`]);
        } else rows.push([cap(M.MD.verb), `<b>${nf.format(cum[d])} km</b>`]);
      } else dot.setAttribute("opacity", "0");
      if (M.G) {
        const plan = M.G * fracAt(d);
        rows.push(["Schema", `${nf.format(plan)} km`]);
        if (d <= lastDay) {
          const diff = cum[d] - plan;
          rows.push(["Verschil", diff >= 0 ? `<span class="ok">▲ ${nf.format(diff)} voor</span>` : `<span class="bad">▼ ${nf.format(-diff)} achter</span>`]);
        }
      }
      tip(e, `<div class="tt">${dt.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}</div>` +
        rows.map(([k, v]) => `<div class="tr"><span>${k}</span><span>${v}</span></div>`).join(""));
    });
    hit.addEventListener("mouseleave", () => { hideTip(); xl.setAttribute("opacity", "0"); dot.setAttribute("opacity", "0"); });
  }

  // ---------------------------------------------------------- ritten van een maand
  function renderMonth(M) {
    const el = $("km-month");
    if (K.sel == null) { el.hidden = true; el.innerHTML = ""; return; }
    const i = K.sel;
    const ym = `${M.y}-${pad(i + 1)}`;
    const list = M.rides.filter((r) => r.date.startsWith(ym)).sort((a, b) => a.date.localeCompare(b.date));
    const anyMap = list.some((r) => r.map);
    let goalLine = "";
    if (M.G) {
      const showAdj = M.c >= 0 && M.c < 12 && i >= M.c;
      const tv = showAdj ? M.adj[i] : M.T[i];
      const d = M.tot[i] - tv;
      if (M.c > i || M.c === 12) goalLine = d >= 0 ? `<span class="ok">▲ Maanddoel gehaald (+${nf.format(d)} km)</span>` : `<span class="bad">▼ ${nf.format(-d)} km onder het maanddoel</span>`;
      else if (M.c === i) goalLine = d >= 0 ? `<span class="ok">▲ Maanddoel al gehaald</span>` : `Nog ${nf.format(-d)} km tot je ${showAdj && Math.abs(M.adj[i] - M.T[i]) > 1 ? "inhaaldoel" : "maanddoel"}`;
      else goalLine = `Doel ${nf.format(tv)} km`;
    }
    el.hidden = false;
    el.innerHTML = `
      <div class="kmonth-head">
        <div>
          <h2>${MAAND[i]} ${M.y}</h2>
          <div class="kmonth-sub">${list.length} ${M.MD.noun[list.length === 1 ? 0 : 1]} · <b>${nf.format(M.tot[i])} km</b> (${M.MD.series.filter((k) => M.ser[k][i] > 0).map((k) => `${SERIES[k].toLowerCase()} ${nf.format(M.ser[k][i])}`).join(" · ") || "0"})${goalLine ? " · " + goalLine : ""}</div>
        </div>
        <div class="kmonth-actions">
          ${anyMap ? `<button class="btn small primary" type="button" id="km-to-map">Bekijk op kaart</button>` : ""}
          <button class="icon-btn" type="button" id="km-close" aria-label="Sluiten">×</button>
        </div>
      </div>
      ${list.length ? `<div class="krides">${list.map((r) => `
        <div class="kride${r.map ? " clickable" : ""}" data-id="${r.id}" ${r.map ? 'title="Toon deze rit op de kaart"' : ""}>
          <span class="kd">${fmtDay(r.date)}</span>
          <span class="kn">${esc(r.name || "Rit")}</span>
          <span class="kt"><span class="tbadge ${r.sub || ""}">${r.indoor ? "Indoor" : esc(TYPE_SHORT[r.type] || r.type)}</span></span>
          <span class="kk">${nf1.format(r.km)} km</span>
          <a class="ks" href="https://www.strava.com/activities/${r.id}" target="_blank" rel="noopener" title="Op Strava">↗</a>
        </div>`).join("")}</div>` : `<div class="empty">Niets in deze maand.</div>`}`;
    const toMap = $("km-to-map");
    if (toMap) toMap.addEventListener("click", () => window.FG && window.FG.showMonth(ym));
    $("km-close").addEventListener("click", () => { K.sel = null; render(); });
    el.querySelectorAll(".kride.clickable").forEach((row) => row.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      if (window.FG) window.FG.showMonth(ym, Number(row.dataset.id));
    }));
  }

  // ================================================== periodes en weken
  const iso = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const parse = (d) => new Date(`${d}T12:00:00`);
  const addD = (d, n) => { const x = parse(d); x.setDate(x.getDate() + n); return iso(x); };
  const todayISO = () => iso(new Date());
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const mondayOf = (d) => { const x = parse(d); return addD(d, -((x.getDay() + 6) % 7)); };
  function isoWeek(d) {
    const x = parse(d);
    const th = new Date(x); th.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7)); // donderdag van die week
    const jan4 = new Date(th.getFullYear(), 0, 4);
    return { year: th.getFullYear(), week: 1 + Math.round(((th - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7) };
  }
  const fmtShort = (d) => parse(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  function rangeLabel(a, b) {
    if (a === b) return fmtDate(a);
    const ya = a.slice(0, 4), yb = b.slice(0, 4);
    return ya === yb ? `${fmtShort(a)} – ${fmtShort(b)} ${yb}` : `${fmtDate(a)} – ${fmtDate(b)}`;
  }

  // Doel per maand (voor één soort), optioneel met inhaaldoel vanaf de huidige maand
  function monthTargets(mode, y, catchUp) {
    const G = goalOf(mode, y);
    if (!G) return null;
    const Wm = weightsFor(mode, y);
    const T = Wm.map((w) => G * w);
    const t = today();
    if (!catchUp || y !== t.y) return T;
    const done = sum(K.rides.filter((r) => inMode(mode, r) && r.date.startsWith(String(y)) && Number(r.date.slice(5, 7)) - 1 < t.m).map((r) => r.km));
    const rest = Math.max(0, G - done), wRest = sum(Wm.slice(t.m));
    return T.map((v, m) => (m < t.m ? v : (rest * Wm[m]) / wRest));
  }
  /** Doel voor één dag = maanddoel / dagen in die maand */
  function dayTarget(mode, d, catchUp) {
    const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1;
    const key = `${mode}|${y}|${catchUp ? 1 : 0}`;
    if (!tcache.has(key)) tcache.set(key, monthTargets(mode, y, catchUp));
    const T = tcache.get(key);
    return T ? T[m] / daysIn(y, m) : 0;
  }
  const hasGoal = (mode, a, b) => goalOf(mode, Number(a.slice(0, 4))) > 0 || goalOf(mode, Number(b.slice(0, 4))) > 0;
  const emptySer = () => ({ out: 0, ind: 0, walk: 0, run: 0 });
  const serOf = (r) => r.sub || (r.indoor ? "ind" : "out");

  // ---------------------------------------------- generieke staafgrafiek
  // buckets: [{key, label, short, ser, tot, n, goal, cur}]
  function barChart(box, buckets, opt) {
    const MD = MODES[K.mode];
    const w = Math.max(320, box.clientWidth);
    const h = opt.height || 260;
    const m = { l: 56, r: 12, t: 18, b: 30 };
    const ymax = niceMax(Math.max(1, ...buckets.map((b) => Math.max(b.tot, b.goal || 0))) * 1.08);
    const ih = h - m.t - m.b;
    const Y = (v) => h - m.b - (v / ymax) * ih;
    const band = (w - m.l - m.r) / Math.max(1, buckets.length);
    const bw = Math.max(2, Math.min(40, band * (buckets.length > 40 ? 0.7 : 0.6)));
    const every = Math.ceil(buckets.length / Math.max(1, Math.floor((w - m.l - m.r) / 44)));
    let g = yAxis(w, h, m, ymax, "km");
    buckets.forEach((b, i) => {
      const cx = m.l + band * i + band / 2;
      const op = opt.sel != null && opt.sel !== b.key ? 0.4 : 1;
      const parts = MD.series.map((k) => [k, b.ser[k]]).filter(([, v]) => v > 0);
      let acc = 0;
      parts.forEach(([k, v], j) => {
        const bottom = Y(acc) - (j && bw > 6 ? 1.5 : 0);
        acc += v;
        const top = Y(acc);
        if (bottom - top <= 0.3) return;
        const r = j === parts.length - 1 ? Math.min(3, (bottom - top) / 2, bw / 3) : 0;
        g += `<path d="${roundTop(cx - bw / 2, top, bw, bottom - top, r)}" fill="${COL[k]}" opacity="${op}"/>`;
      });
      if (b.goal) {
        const ext = Math.min(5, band * 0.15);
        g += `<line x1="${cx - bw / 2 - ext}" x2="${cx + bw / 2 + ext}" y1="${Y(b.goal)}" y2="${Y(b.goal)}" stroke="${COL.ink}" stroke-width="${buckets.length > 40 ? 1.5 : 2}" stroke-linecap="round" opacity="${op}"/>`;
      }
      if (i % every === 0 || b.cur) {
        g += `<text x="${cx}" y="${h - m.b + 18}" text-anchor="middle" class="ax${b.cur ? " cur" : ""}">${esc(b.short)}</text>`;
      }
      g += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih + m.b}" fill="transparent"/>`;
    });
    box.innerHTML = svgEl(w, h, g);
    box.querySelectorAll(".hit").forEach((r) => {
      const b = buckets[Number(r.dataset.i)];
      r.addEventListener("mousemove", (e) => tip(e, bucketTip(b)));
      r.addEventListener("mouseleave", hideTip);
      if (opt.onClick) r.addEventListener("click", () => { hideTip(); opt.onClick(b); });
      else r.style.cursor = "default";
    });
  }

  function bucketTip(b) {
    const MD = MODES[K.mode];
    const rows = MD.series.map((k) => [`<i class="dot" style="background:${COL[k]}"></i>${SERIES[k]}`, `${nf1.format(b.ser[k])} km`]);
    rows.push(["Totaal", `<b>${nf1.format(b.tot)} km</b> · ${b.n} ${MD.noun[b.n === 1 ? 0 : 1]}`]);
    if (b.goal) {
      rows.push([b.goalLabel || "Doel", `${nf.format(b.goal)} km`]);
      if (b.done) {
        const d = b.tot - b.goal;
        rows.push(["Resultaat", d >= 0 ? `<span class="ok">▲ gehaald (+${nf.format(d)})</span>` : `<span class="bad">▼ ${nf.format(-d)} km tekort</span>`]);
      }
    }
    return `<div class="tt">${esc(b.label)}</div>` + rows.map(([k, v]) => `<div class="tr"><span>${k}</span><span>${v}</span></div>`).join("");
  }

  function seriesLegend(withGoal, goalText) {
    const MD = MODES[K.mode];
    const leg = MD.series.map((k) => `<span><i style="background:${COL[k]}"></i>${SERIES[k]}</span>`);
    if (withGoal) leg.push(`<span><i class="tick"></i>${goalText || "Doel"}</span>`);
    return leg.join("");
  }

  // ---------------------------------------------- opgeteld over een periode
  function cumChart(box, legendEl, days, rides, goalPerDay) {
    const MD = MODES[K.mode];
    const split = K.mode === "total";
    const w = Math.max(320, box.clientWidth);
    const h = 240;
    const m = { l: 56, r: 92, t: 16, b: 30 };
    const n = days.length;
    const per = new Map(), perB = new Map();
    for (const r of rides) {
      per.set(r.date, (per.get(r.date) || 0) + r.km);
      if (r.cat === "bike") perB.set(r.date, (perB.get(r.date) || 0) + r.km);
    }
    const lastIdx = days.findIndex((d) => d > todayISO());
    const upto = lastIdx === -1 ? n : lastIdx; // geen toekomst tekenen
    const cum = [0], cumB = [0], plan = [0];
    let a = 0, bb = 0, p = 0;
    days.forEach((d, i) => {
      a += per.get(d) || 0; bb += perB.get(d) || 0; p += goalPerDay ? goalPerDay[i] : 0;
      cum.push(a); cumB.push(bb); plan.push(p);
    });
    const run = cum[upto];
    const ymax = niceMax(Math.max(run, goalPerDay ? p : 0, 1) * 1.08);
    const ih = h - m.t - m.b;
    const X = (i) => m.l + ((w - m.l - m.r) * i) / Math.max(1, n);
    const Y = (v) => h - m.b - (v / ymax) * ih;
    let g = yAxis(w, h, m, ymax, "km");
    const every = Math.ceil(n / Math.max(1, Math.floor((w - m.l - m.r) / 60)));
    days.forEach((d, i) => { if (i % every === 0) g += `<text x="${X(i + 0.5)}" y="${h - m.b + 18}" text-anchor="middle" class="ax">${esc(fmtShort(d))}</text>`; });
    const labels = [];
    if (goalPerDay && p > 0) {
      g += `<polyline points="${plan.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}" fill="none" stroke="${COL.plan}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
      labels.push({ y: Y(p), text: `Doel ${nf.format(p)}`, color: COL.ink2 });
    }
    const pts = cum.slice(0, upto + 1).map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
    if (split) {
      const ptsB = cumB.slice(0, upto + 1).map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
      g += `<polygon points="${X(0)},${Y(0)} ${ptsB.join(" ")} ${X(upto)},${Y(0)}" fill="${COL.out}" fill-opacity="0.38"/>`;
      g += `<polygon points="${pts.join(" ")} ${ptsB.slice().reverse().join(" ")}" fill="${COL.walk}" fill-opacity="0.45"/>`;
      g += `<polyline points="${ptsB.join(" ")}" fill="none" stroke="${COL.out}" stroke-width="1.5"/>`;
    } else {
      g += `<defs><linearGradient id="pcum-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${MD.line}" stop-opacity="0.32"/><stop offset="1" stop-color="${MD.line}" stop-opacity="0.06"/></linearGradient></defs>`;
      g += `<polygon points="${X(0)},${Y(0)} ${pts.join(" ")} ${X(upto)},${Y(0)}" fill="url(#pcum-fill)"/>`;
    }
    g += `<polyline points="${pts.join(" ")}" fill="none" stroke="${MD.line}" stroke-width="2.25" stroke-linejoin="round"/>`;
    g += `<circle cx="${X(upto)}" cy="${Y(run)}" r="4.5" fill="${MD.line}" stroke="${COL.surface}" stroke-width="2"/>`;
    labels.push({ y: Y(run), text: `${nf.format(run)} km`, color: MD.lineDark });
    labels.sort((x, y) => x.y - y.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
    for (const l of labels) g += `<text x="${w - m.r + 8}" y="${l.y + 4}" class="lbl" fill="${l.color}">${esc(l.text)}</text>`;
    g += `<line class="cx" x1="0" x2="0" y1="${m.t}" y2="${h - m.b}" stroke="${COL.ink2}" opacity="0"/>`;
    g += `<rect class="chit" x="${m.l}" y="${m.t}" width="${w - m.l - m.r}" height="${ih}" fill="transparent"/>`;
    box.innerHTML = svgEl(w, h, g);
    legendEl.innerHTML = (split
      ? [`<span><i style="background:${COL.out};opacity:.6"></i>Fietsen</span>`, `<span><i style="background:${COL.walk};opacity:.7"></i>Wandelen</span>`, `<span><i class="line" style="background:${MD.line}"></i>Totaal</span>`]
      : [`<span><i class="area" style="--c:${MD.line}"></i>${cap(MD.verb)}</span>`]).concat(goalPerDay && p > 0 ? [`<span><i class="line dash"></i>Doel (opgeteld)</span>`] : []).join("");
    const svg = box.querySelector("svg"), hit = box.querySelector(".chit"), xl = box.querySelector(".cx");
    hit.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const i = Math.max(1, Math.min(n, Math.round(((e.clientX - rect.left - m.l) / (w - m.l - m.r)) * n)));
      xl.setAttribute("x1", X(i)); xl.setAttribute("x2", X(i)); xl.setAttribute("opacity", "0.5");
      const rows = [];
      if (i <= upto) {
        if (split) {
          rows.push([`<i class="dot" style="background:${COL.out}"></i>Fietsen`, `${nf.format(cumB[i])} km`]);
          rows.push([`<i class="dot" style="background:${COL.walk}"></i>Wandelen`, `${nf.format(cum[i] - cumB[i])} km`]);
        }
        rows.push([split ? "Totaal" : cap(MD.verb), `<b>${nf.format(cum[i])} km</b>`]);
      }
      if (goalPerDay && p > 0) {
        rows.push(["Doel tot dan", `${nf.format(plan[i])} km`]);
        if (i <= upto) {
          const d = cum[i] - plan[i];
          rows.push(["Verschil", d >= 0 ? `<span class="ok">▲ ${nf.format(d)} voor</span>` : `<span class="bad">▼ ${nf.format(-d)} achter</span>`]);
        }
      }
      tip(e, `<div class="tt">t/m ${esc(fmtDate(days[i - 1]))}</div>` + rows.map(([k, v]) => `<div class="tr"><span>${k}</span><span>${v}</span></div>`).join(""));
    });
    hit.addEventListener("mouseleave", () => { hideTip(); xl.setAttribute("opacity", "0"); });
  }

  // ---------------------------------------------- lijst van activiteiten
  function activityList(el, list, head, toMap) {
    const MD = MODES[K.mode];
    const anyMap = list.some((r) => r.map);
    el.innerHTML = `
      <div class="kmonth-head">
        <div><h2>${head}</h2><div class="kmonth-sub">${list.length} ${MD.noun[list.length === 1 ? 0 : 1]} · ${nf.format(sum(list.map((r) => r.km)))} km</div></div>
        <div class="kmonth-actions">${anyMap && toMap ? `<button class="btn small primary" type="button" data-tomap>Bekijk op kaart</button>` : ""}</div>
      </div>
      ${list.length ? `<div class="krides">${list.map((r) => `
        <div class="kride${r.map ? " clickable" : ""}" data-id="${r.id}" ${r.map ? 'title="Toon op de kaart"' : ""}>
          <span class="kd">${fmtDay(r.date)}</span>
          <span class="kn">${esc(r.name || "")}</span>
          <span class="kt"><span class="tbadge ${r.sub || ""}">${r.indoor ? "Indoor" : esc(TYPE_SHORT[r.type] || r.type)}</span></span>
          <span class="kk">${nf1.format(r.km)} km</span>
          <a class="ks" href="https://www.strava.com/activities/${r.id}" target="_blank" rel="noopener" title="Op Strava">↗</a>
        </div>`).join("")}</div>` : `<div class="empty">Geen activiteiten in deze periode.</div>`}`;
    const b = el.querySelector("[data-tomap]");
    if (b) b.addEventListener("click", () => toMap(null));
    el.querySelectorAll(".kride.clickable").forEach((row) => row.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      if (toMap) toMap(Number(row.dataset.id));
    }));
  }

  // ---------------------------------------------- PERIODE
  function presets() {
    const t = todayISO(), y = Number(t.slice(0, 4)), mo = t.slice(0, 7);
    const mon = mondayOf(t);
    const lastMonthEnd = addD(`${mo}-01`, -1);
    return [
      ["Deze week", mon, addD(mon, 6)],
      ["Vorige week", addD(mon, -7), addD(mon, -1)],
      ["Deze maand", `${mo}-01`, addD(iso(new Date(y, Number(mo.slice(5)) , 1)), -1)],
      ["Vorige maand", `${lastMonthEnd.slice(0, 7)}-01`, lastMonthEnd],
      ["Laatste 30 dagen", addD(t, -29), t],
      ["Dit jaar", `${y}-01-01`, `${y}-12-31`],
      ["Vorig jaar", `${y - 1}-01-01`, `${y - 1}-12-31`],
    ];
  }

  function renderPeriod() {
    if (!K.period) { const p = presets()[2]; K.period = { start: p[1], end: p[2] }; }
    const { start, end } = K.period;
    const MD = MODES[K.mode];
    if (document.activeElement !== $("period-from")) $("period-from").value = start;
    if (document.activeElement !== $("period-to")) $("period-to").value = end;
    $("period-presets").innerHTML = presets().map(([l, a, b]) =>
      `<button type="button" class="chip small" data-a="${a}" data-b="${b}" aria-pressed="${a === start && b === end}">${l}</button>`).join("");
    const label = rangeLabel(start, end);
    $("period-title").innerHTML = `${esc(MD.name)} · ${esc(label)}`;
    const list = K.rides.filter((r) => r.date >= start && r.date <= end && inMode(K.mode, r)).sort((a, b) => a.date.localeCompare(b.date));
    const days = [];
    for (let d = start; d <= end && days.length < 3700; d = addD(d, 1)) days.push(d);
    const nDays = days.length;
    const elapsed = days.filter((d) => d <= todayISO()).length || nDays;
    const total = sum(list.map((r) => r.km));
    const ser = emptySer();
    list.forEach((r) => { ser[serOf(r)] += r.km; });
    const longest = list.reduce((a, b) => (!a || b.km > a.km ? b : a), null);
    const activeDays = new Set(list.map((r) => r.date)).size;
    const withGoal = hasGoal(K.mode, start, end);
    const goalDays = withGoal ? days.map((d) => dayTarget(K.mode, d, false)) : null;
    const goalAll = goalDays ? sum(goalDays) : 0;
    const goalSoFar = goalDays ? sum(goalDays.slice(0, elapsed)) : 0;

    // kerncijfers
    const tiles = [];
    tiles.push(`<div class="kpi"><div class="kpi-label">Totaal</div><div class="kpi-big">${nf.format(total)} km</div>
      <div class="kpi-sub">${MD.series.filter((k) => ser[k] > 0).map((k) => `<i class="sdot" style="background:${COL[k]}"></i>${SERIES[k]} ${nf.format(ser[k])} km`).join("<br>") || "Nog niets in deze periode."}</div></div>`);
    tiles.push(`<div class="kpi"><div class="kpi-label">Aantal</div><div class="kpi-big">${list.length} <small>${MD.noun[list.length === 1 ? 0 : 1]}</small></div>
      <div class="kpi-sub">op ${activeDays} van de ${nDays} dagen · gemiddeld ${nf1.format(list.length ? total / list.length : 0)} km per keer</div></div>`);
    tiles.push(`<div class="kpi"><div class="kpi-label">Gemiddeld</div><div class="kpi-big">${nf.format((total / Math.max(1, elapsed)) * 7)} km <small>per week</small></div>
      <div class="kpi-sub">${longest ? `Langste: ${nf1.format(longest.km)} km · ${esc(longest.name || "")} (${fmtShort(longest.date)})` : ""}</div></div>`);
    if (withGoal && goalAll > 0) {
      const done = end < todayISO();
      const diff = total - (done ? goalAll : goalSoFar);
      tiles.push(`<div class="kpi"><div class="kpi-label">Doel in deze periode</div>
        ${status(diff, done ? "ten opzichte van het doel" : "op schema van vandaag")}
        <div class="kpi-main"><b>${nf.format(total)}</b> van ${nf.format(goalAll)} km</div>
        ${meter(total, goalAll, done ? null : goalSoFar)}
        <div class="kpi-sub">${done ? (total >= goalAll ? "Doel gehaald!" : "Doel niet gehaald.") : total >= goalAll ? "Doel al gehaald!" : `Nog ${nf.format(goalAll - total)} km tot ${fmtShort(end)}.`} Afgeleid van je jaardoel.</div></div>`);
    }
    $("period-kpis").innerHTML = tiles.join("");

    // gemeenten (alleen fietsritten tellen)
    const gem = $("period-gem");
    const G = K.mode !== "foot" && window.FG && window.FG.gemeentenInPeriod ? window.FG.gemeentenInPeriod(start, end) : null;
    gem.hidden = !G;
    if (G) {
      gem.innerHTML = `<div class="kcard-head"><h2>Gemeenten</h2></div>
        <div class="pgem"><div><span class="kpi-big">${G.count}</span> gemeenten aangedaan op de fiets</div>
        <div><span class="kpi-big ${G.fresh.length ? "fresh" : ""}">${G.fresh.length}</span> daarvan voor het eerst ooit</div></div>
        ${G.fresh.length ? `<div class="party-chips pchips">${G.fresh.map((f) => `<span title="${esc(fmtDate(f.date))}">${esc(f.naam)}</span>`).join("")}</div>` : ""}`;
    }

    // staven: per dag, week of maand
    let buckets, unit;
    const mk = (key, lab, short, ds) => {
      const set = new Set(ds);
      const rs = list.filter((r) => set.has(r.date));
      const b = { key, label: lab, short, ser: emptySer(), tot: 0, n: rs.length, ds };
      rs.forEach((r) => { b.ser[serOf(r)] += r.km; b.tot += r.km; });
      // geen doelstreepje per dag: dat is overal hetzelfde getal en zegt niets
      if (goalDays && ds.length > 1) { b.goal = sum(ds.map((d) => goalDays[days.indexOf(d)])); b.done = ds[ds.length - 1] < todayISO(); }
      return b;
    };
    if (nDays <= 62) {
      unit = "dag";
      buckets = days.map((d) => ({ ...mk(d, fmtDay(d), String(Number(d.slice(8))), [d]), cur: d === todayISO() }));
    } else if (nDays <= 230) {
      unit = "week";
      buckets = [];
      for (let i = 0; i < nDays;) {
        const mon = mondayOf(days[i]);
        const ds = days.slice(i).filter((d) => d < addD(mon, 7));
        const wk = isoWeek(days[i]);
        buckets.push({ ...mk(mon, `Week ${wk.week} · ${rangeLabel(ds[0], ds[ds.length - 1])}`, `wk ${wk.week}`, ds), cur: ds.includes(todayISO()) });
        i += ds.length;
      }
    } else {
      unit = "maand";
      buckets = [];
      for (let i = 0; i < nDays;) {
        const ym = days[i].slice(0, 7);
        const ds = days.slice(i).filter((d) => d.startsWith(ym));
        buckets.push({ ...mk(ym, `${MAAND[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`, `${KORT[Number(ym.slice(5)) - 1]}${days[0].slice(0, 4) !== days[nDays - 1].slice(0, 4) ? " " + ym.slice(2, 4) : ""}`, ds), cur: ym === todayISO().slice(0, 7) });
        i += ds.length;
      }
    }
    $("period-bars-title").textContent = `Kilometers per ${unit}`;
    $("period-legend").innerHTML = seriesLegend(!!goalDays && unit !== "dag", `Doel per ${unit}`);
    barChart($("period-bars"), buckets, {
      onClick: unit === "dag" ? null : (b) => { K.period = { start: b.ds[0], end: b.ds[b.ds.length - 1] }; render(); window.scrollTo({ top: 0, behavior: "smooth" }); },
    });
    cumChart($("period-cum"), $("period-legend2"), days, list, goalDays);
    activityList($("period-list"), list.slice().reverse(), "Activiteiten", (rideId) => {
      if (window.FG) window.FG.showRange(start, end, label, rideId, { routes: !rideId });
    });
  }

  // ---------------------------------------------- WEKEN
  function weekData(mon) {
    const ds = Array.from({ length: 7 }, (_, i) => addD(mon, i));
    const t = todayISO();
    const cur = ds.includes(t);
    const rs = K.rides.filter((r) => r.date >= ds[0] && r.date <= ds[6] && inMode(K.mode, r));
    const ser = emptySer();
    rs.forEach((r) => { ser[serOf(r)] += r.km; });
    const tot = sum(rs.map((r) => r.km));
    const withGoal = hasGoal(K.mode, ds[0], ds[6]);
    const goal = withGoal ? sum(ds.map((d) => dayTarget(K.mode, d, cur))) : 0;
    const elapsed = ds.filter((d) => d <= t).length;
    const sched = goal ? sum(ds.slice(0, elapsed).map((d) => dayTarget(K.mode, d, cur))) : 0;
    const wk = isoWeek(mon);
    return { mon, ds, cur, rs, ser, tot, n: rs.length, goal, sched, elapsed, wk, done: ds[6] < t, hit: goal > 0 && tot >= goal };
  }

  function renderWeeks() {
    const MD = MODES[K.mode];
    const y = K.year;
    const t = todayISO();
    $("wk-year").textContent = y;
    const years = K.rides.map((r) => Number(r.date.slice(0, 4)));
    $("wk-prev").disabled = y <= Math.min(Number(t.slice(0, 4)), ...years);
    $("wk-next").disabled = y >= Number(t.slice(0, 4));
    // alle weken waarvan de donderdag in dit jaar valt, tot en met de huidige week
    let mon = mondayOf(`${y}-01-04`);
    const weeks = [];
    while (isoWeek(mon).year === y && mon <= t) { weeks.push(weekData(mon)); mon = addD(mon, 7); }
    const withGoal = weeks.some((w) => w.goal > 0);
    $("wk-goalnote").innerHTML = withGoal ? `${esc(MD.name)}: weekdoel afgeleid van je jaardoel` : `Stel bij <b>Jaar</b> een doel in om weekdoelen te zien.`;
    const past = weeks.filter((w) => w.done && w.goal > 0);
    const hits = past.filter((w) => w.hit).length;
    let streak = 0;
    for (let i = past.length - 1; i >= 0 && past[i].hit; i--) streak++;
    const curW = weeks.find((w) => w.cur);
    const best = weeks.reduce((a, b) => (!a || b.tot > a.tot ? b : a), null);
    const avg = weeks.length ? sum(weeks.map((w) => w.tot)) / (weeks.length - (curW ? 1 : 0) || 1) : 0;

    const tiles = [];
    if (curW) {
      const left = Math.max(0, curW.goal - curW.tot);
      const daysLeft = 7 - curW.elapsed + 1;
      tiles.push(`<div class="kpi kpi-week"><div class="kpi-label">Deze week · week ${curW.wk.week} · ${esc(rangeLabel(curW.ds[0], curW.ds[6]))}</div>
        ${curW.goal ? status(curW.tot - curW.sched, "op weekschema van vandaag") : `<div class="kpi-big">${nf.format(curW.tot)} km</div>`}
        ${curW.goal ? `<div class="kpi-main"><b>${nf.format(curW.tot)}</b> van ${nf.format(curW.goal)} km${curW.goal - sum(curW.ds.map((d) => dayTarget(K.mode, d, false))) > 1 ? ' <span class="tag">inhaaldoel</span>' : ""}</div>${meter(curW.tot, curW.goal, curW.sched)}` : ""}
        <div class="kpi-sub">${curW.goal ? (left > 0 ? `Nog <b>${nf.format(left)} km</b> in ${daysLeft} ${daysLeft === 1 ? "dag" : "dagen"}` : "Weekdoel gehaald!") : ""}${curW.n ? `${curW.goal ? " · " : ""}${curW.n} ${MD.noun[curW.n === 1 ? 0 : 1]}` : ""}</div></div>`);
    }
    if (withGoal) {
      tiles.push(`<div class="kpi"><div class="kpi-label">Weekdoelen gehaald in ${y}</div><div class="kpi-big">${hits} <small>van ${past.length}</small></div>
        <div class="kpi-sub">${streak > 1 ? `▲ Reeks: ${streak} weken op rij gehaald` : streak === 1 ? "Vorige week gehaald" : past.length ? "Vorige week niet gehaald" : ""}</div></div>`);
    }
    tiles.push(`<div class="kpi"><div class="kpi-label">Gemiddeld per week</div><div class="kpi-big">${nf.format(avg)} km</div>
      <div class="kpi-sub">${best && best.tot ? `Beste week: week ${best.wk.week} met ${nf.format(best.tot)} km` : ""}</div></div>`);
    $("wk-kpis").innerHTML = tiles.join("");

    $("wk-legend").innerHTML = seriesLegend(withGoal, "Weekdoel");
    const open = (w) => { K.view = "period"; K.period = { start: w.ds[0], end: w.ds[6] }; saveView(); render(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    barChart($("wk-bars"), weeks.map((w) => ({
      key: w.mon, label: `Week ${w.wk.week} · ${rangeLabel(w.ds[0], w.ds[6])}`, short: String(w.wk.week),
      ser: w.ser, tot: w.tot, n: w.n, goal: w.goal, done: w.done, cur: w.cur, goalLabel: w.cur && w.goal ? "Weekdoel (incl. inhaal)" : "Weekdoel", w,
    })), { height: 240, onClick: (b) => open(b.w) });

    $("wk-table").innerHTML = weeks.slice().reverse().map((w) => {
      const pct = w.goal ? Math.min(100, (w.tot / w.goal) * 100) : 0;
      const st = !w.goal ? "" : w.hit ? `<span class="ok">✓ gehaald</span>` : w.done ? `<span class="bad">✗ ${nf.format(w.goal - w.tot)} km tekort</span>` : `<span class="wk-busy">nog ${nf.format(w.goal - w.tot)} km</span>`;
      return `<button type="button" class="wk-row${w.cur ? " cur" : ""}${w.hit ? " hit" : ""}" data-mon="${w.mon}">
        <span class="wk-n">Week ${w.wk.week}</span>
        <span class="wk-d">${esc(rangeLabel(w.ds[0], w.ds[6]))}</span>
        <span class="wk-bar">${w.goal ? `<span class="wk-fill" style="width:${pct}%"></span>` : `<span class="wk-fill nogoal" style="width:${best && best.tot ? Math.min(100, (w.tot / best.tot) * 100) : 0}%"></span>`}</span>
        <span class="wk-km"><b>${nf.format(w.tot)}</b>${w.goal ? ` / ${nf.format(w.goal)}` : ""} km</span>
        <span class="wk-st">${st}</span>
        <span class="wk-c">${w.n || ""}</span>
      </button>`;
    }).join("") || `<div class="empty">Nog geen weken in ${y}.</div>`;
    $("wk-table").querySelectorAll("[data-mon]").forEach((b) => b.addEventListener("click", () => open(weeks.find((w) => w.mon === b.dataset.mon))));
  }

  function saveView() {
    try { localStorage.setItem("fg-km-view", K.view); } catch { /* geen opslag */ }
  }

  // ---------------------------------------------------------- tooltip
  function tip(e, html) {
    const t = $("km-tip");
    t.innerHTML = html;
    t.hidden = false;
    const off = 14;
    let x = e.clientX + off, y = e.clientY + off;
    const r = t.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - off;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - off;
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  }
  function hideTip() { $("km-tip").hidden = true; }

  // ---------------------------------------------------------- bediening
  document.querySelectorAll(".kmode").forEach((b) => b.addEventListener("click", () => {
    K.mode = b.dataset.mode;
    try { localStorage.setItem("fg-km-mode", K.mode); } catch { /* geen opslag */ }
    hideTip();
    render();
  }));
  document.querySelectorAll(".kview").forEach((b) => b.addEventListener("click", () => {
    K.view = b.dataset.kview;
    saveView();
    hideTip();
    render();
  }));
  $("period-form").addEventListener("submit", (e) => {
    e.preventDefault();
    let a = $("period-from").value, b = $("period-to").value;
    if (!a || !b) return;
    if (b < a) [a, b] = [b, a];
    if (diffDays(a, b) > 3650) { alert("Kies een periode van maximaal 10 jaar."); return; }
    K.period = { start: a, end: b };
    render();
  });
  $("period-presets").addEventListener("click", (e) => {
    const c = e.target.closest("[data-a]");
    if (!c) return;
    K.period = { start: c.dataset.a, end: c.dataset.b };
    render();
  });
  $("wk-prev").addEventListener("click", () => { K.year--; render(); });
  $("wk-next").addEventListener("click", () => { K.year++; render(); });
  $("km-prev").addEventListener("click", () => { K.year--; K.sel = null; render(); });
  $("km-next").addEventListener("click", () => { K.year++; K.sel = null; render(); });
  $("goal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const km = Number($("goal-input").value || 0);
    const r = await fetch("/api/goals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: K.year, km, kind: K.mode === "foot" ? "foot" : "bike" }),
    });
    const d = await r.json();
    if (d.ok) {
      if (d.goals) K.goals = d.goals;
      if (d.goals_foot) K.goalsFoot = d.goals_foot;
      $("goal-input").blur();
      checkKmParties();
      render();
    }
  });
  let rt = null;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (!$("km-view").hidden) render(); }, 150);
  });

  /** Samenvatting van het lopende jaar voor het overzicht (zonder het kilometerscherm te veranderen) */
  async function summary(mode = "bike") {
    if (!K.loaded) await load();
    const keep = [K.year, K.mode];
    K.year = new Date().getFullYear();
    K.mode = mode;
    const M = model();
    [K.year, K.mode] = keep;
    return { ...M, rides: K.rides, goalFoot: goalOf("foot", M.y), footYtd: sum(K.rides.filter((r) => r.cat === "foot" && r.date.startsWith(String(M.y))).map((r) => r.km)) };
  }
  /** Kilometerscherm openen op één maand */
  function openMonth(y, m, mode = "bike") {
    K.year = y;
    K.mode = mode === "foot" || mode === "total" ? mode : "bike";
    K.view = "year";
    K.sel = m;
    if (window.FG) window.FG.setView("km");
    setTimeout(() => { const el = $("km-month"); if (el && !el.hidden) el.scrollIntoView({ block: "nearest" }); }, 150);
  }
  function openYear(y) {
    K.year = y;
    K.view = "year";
    K.sel = null;
    if (window.FG) window.FG.setView("km");
  }
  window.addEventListener("fg-theme", () => { if (K.visible && !$("km-view").hidden) render(); });
  $("km-wx").addEventListener("click", (e) => {
    const t = e.target.closest("[data-wxall]");
    if (t) { K.wxAll = t.dataset.wxall === "1"; render(); return; }
    const se = e.target.closest("[data-season]");
    if (se) { K.wxSeason = K.wxSeason === se.dataset.season ? "" : se.dataset.season; render(); return; }
    const r = e.target.closest("[data-ride]");
    if (r && window.FG) window.FG.openRide(Number(r.dataset.ride));
  });

  /** Jaardoel opslaan (ook vanaf het overzicht); kind = "bike" of "foot" */
  async function setGoal(kind, y, km) {
    const r = await fetch("/api/goals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: y, km: Number(km) || 0, kind: kind === "foot" ? "foot" : "bike" }),
    });
    const d = await r.json();
    if (!d.ok) return false;
    if (d.goals) K.goals = d.goals;
    if (d.goals_foot) K.goalsFoot = d.goals_foot;
    checkKmParties();
    if (K.visible && !$("km-view").hidden) render();
    return true;
  }
  window.FGKm = { show, refresh, summary, openMonth, openYear, setGoal, goal: (kind, y) => goalOf(kind, y), loaded: () => K.loaded };
})();
