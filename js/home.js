/* Fietsgemeenten - overzicht (startscherm) */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAAND = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const KORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const fmtDay = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
  const isoToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const TYPE = { Ride: "Fiets", GravelRide: "Gravel", MountainBikeRide: "MTB", EBikeRide: "E-bike", EMountainBikeRide: "E-MTB",
    VirtualRide: "Indoor", Velomobile: "Velomobiel", Handcycle: "Handbike", Walk: "Wandeling", Hike: "Hike", Run: "Hardlopen", TrailRun: "Trailrun" };

  const svg = (d, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    bike: svg('<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16 10 8h5l3 8M10 8l4 8M9 5h3"/>'),
    indoor: svg('<circle cx="12" cy="16" r="4"/><path d="M4 21h16M12 16 9 7h5M8 7h2"/>'),
    foot: svg('<path d="M8 3.5c1.7 0 2.5 1.6 2.5 4S9.5 13 8 13s-2.5-2-2.5-5.5S6.3 3.5 8 3.5zM6 15.5h4l-.3 2.6a1.9 1.9 0 0 1-3.4 0zM16 7.5c1.7 0 2.5 1.6 2.5 4S17.5 17 16 17s-2.5-2-2.5-5.5 .8-4 2.5-4zM14 19.5h4"/>'),
    pin: svg('<path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
    map: svg('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>', 18),
    check: svg('<path d="M5 19c3 0 3-6 7-6s4 6 7 6M5 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm14 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 13V5m0 0 3 3m-3-3-3 3"/>', 18),
  };

  const H = { visible: false, paths: null, pathsKey: "", home: null, seq: 0, foot: [], mode: "bike" };
  try { H.mode = localStorage.getItem("fg-home-mode") || "bike"; } catch { /* geen opslag */ }
  if (!["bike", "foot", "all"].includes(H.mode)) H.mode = "bike";
  const KIND = {
    bike: { cls: "", verb: "gefietst", noun: "ritten", eyebrow: "", mapCls: "v" },
    foot: { cls: " walk", verb: "gewandeld", noun: "wandelingen", eyebrow: " · wandelen", mapCls: "w" },
  };

  // Eerste bezoek per gemeente binnen een ronde (voor wandelen; fietsen komt uit de kaart)
  function firstsIn(acts, range, features) {
    const m = new Map();
    if (!range) return m;
    for (const a of acts) {
      if ((range.start && a.date < range.start) || (range.end && a.date > range.end)) continue;
      for (const c of a.g) if (features[c] && !m.has(c)) m.set(c, a);
    }
    return m;
  }
  function milestones(firsts, total) {
    const order = [...firsts.entries()].sort((x, y) => x[1].date.localeCompare(y[1].date));
    return [50, 75, 90, 100].map((pct) => {
      const n = Math.ceil((pct / 100) * total);
      const hit = order.length >= n && total ? order[n - 1] : null;
      return { pct, n, date: hit ? hit[1].date : null, code: hit ? hit[0] : null, act: hit ? hit[1] : null };
    });
  }
  const fmtShort = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });

  /** Gegevens voor één sport: fietsen (uit de kaart) of wandelen (eigen telling, dezelfde rondes) */
  function viewFor(D, kind) {
    if (kind === "bike") {
      return { kind, ...KIND.bike, firsts: D.firsts, prevFirsts: D.prevFirsts, acts: D.acts.filter((a) => D.types.has(a.type)),
        medals: window.FG.medalsHtml() };
    }
    const acts = H.foot;
    const firsts = firstsIn(acts, D.ranges[D.round], D.features);
    const prev = D.round > 0 ? firstsIn(acts, D.ranges[D.round - 1], D.features) : null;
    const ms = milestones(firsts, D.total);
    return { kind, ...KIND.foot, firsts, prevFirsts: prev, acts, ms,
      medals: window.FGParty ? window.FGParty.medals(ms, fmtShort) : "",
      noRoutes: acts.length > 0 && !acts.some((a) => a.track) };
  }

  // Feestjes voor gewandelde gemeenten (per ronde, net als bij fietsen)
  function checkFootParties(D) {
    if (!window.FGParty || !D.ready || !H.foot.some((a) => a.g.length)) return;
    D.ranges.forEach((range, i) => {
      const firsts = firstsIn(H.foot, range, D.features);
      const name = D.rounds[i].name;
      const group = `walk-${range.start || "begin"}${range.end ? `-${range.end}` : ""}`;
      const items = milestones(firsts, D.total).map((m) => ({ pct: m.pct, date: m.date, build: () => {
        const naam = m.code && D.features[m.code] ? D.features[m.code].naam : "";
        const titles = { 50: "Halverwege gewandeld!", 75: "Driekwart gewandeld!", 90: "Bijna alles bewandeld", 100: "Alle gemeenten bewandeld!" };
        return {
          title: titles[m.pct],
          lead: `${esc(name)}: ${m.n} van de ${D.total} gemeenten gewandeld.${naam ? ` Nummer ${m.n} was <b>${esc(naam)}</b>.` : ""}`,
          rows: [["Bereikt op", m.act ? `${fmtShort(m.date)}, met “${esc(m.act.name || "Wandeling")}”` : fmtShort(m.date)]],
          chips: [],
        };
      } }));
      window.FGParty.check(group, `${name}: gewandelde gemeenten`, items, true);
    });
  }

  // ------------------------------------------------------------ minikaart
  // Eenvoudige projectie van Nederland op 560 x 660 (lengtegraden gecorrigeerd voor 52°)
  const BOX = [3.33, 50.73, 7.23, 53.58];
  const KX = Math.cos((52.2 * Math.PI) / 180);
  const SCALE = Math.min(560 / ((BOX[2] - BOX[0]) * KX), 660 / (BOX[3] - BOX[1]));
  const px = (lon, lat) => [(lon - BOX[0]) * KX * SCALE, (BOX[3] - lat) * SCALE];

  function ringPath(coords) {
    let d = "", lx = -99, ly = -99, n = 0;
    for (const [lon, lat] of coords) {
      const [x, y] = px(lon, lat);
      if (Math.abs(x - lx) + Math.abs(y - ly) < 1.2) continue;
      d += (n ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      lx = x; ly = y; n++;
    }
    return n > 2 ? d + "Z" : "";
  }
  function buildPaths(features) {
    const out = [];
    for (const [code, f] of Object.entries(features)) {
      const g = f.layer && f.layer.feature && f.layer.feature.geometry;
      if (!g) continue;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      out.push([code, polys.map((p) => (Array.isArray(p) && Array.isArray(p[0]) ? ringPath(p[0]) : "")).join("")]);
    }
    return out;
  }
  function miniMap(D, cls = (c) => (D.firsts.has(c) ? "v" : "u")) {
    const key = Object.keys(D.features).length;
    if (!H.paths || H.pathsKey !== key) { H.paths = buildPaths(D.features); H.pathsKey = key; }
    const paths = H.paths.map(([c, d]) => `<path class="${cls(c)}" d="${d}"/>`).join("");
    // gestreept patroon voor gemeenten die zowel gefietst als gewandeld zijn
    const defs = `<defs><pattern id="mm-both" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" class="pb-a"/><rect width="4.5" height="9" class="pb-b"/></pattern></defs>`;
    return `<button type="button" class="mini-map" data-view="map" aria-label="Open de kaart"><svg viewBox="0 0 560 660" aria-hidden="true">${defs}${paths}</svg></button>`;
  }

  // ------------------------------------------------------------ helpers
  function ring(pct, size = 180, stroke = 17, inner = "", color = "var(--accent)") {
    const r = (size - stroke) / 2, C = 2 * Math.PI * r, L = C * Math.max(0, Math.min(1, pct));
    return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--chip)" stroke-width="${stroke}"/>
      ${L > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${L.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ""}</svg>
      <div class="ring-c">${inner}</div></div>`;
  }
  function perProvince(D, firsts = D.firsts, firsts2 = null) {
    const per = {};
    for (const [code, f] of Object.entries(D.features)) {
      const p = (per[f.provincie] ||= { t: 0, v: 0, w: 0 });
      p.t++;
      if (firsts.has(code)) p.v++;
      if (firsts2 && firsts2.has(code)) p.w++;
    }
    return per;
  }
  function center(f) {
    if (f.center === undefined) {
      const b = f.layer.getBounds();
      f.center = b.isValid() ? [b.getCenter().lat, b.getCenter().lng] : null;
    }
    return f.center;
  }
  function distKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // "Thuis" = de gemeente waar je het vaakst doorheen fietst
  function homeCode(D) {
    const n = new Map();
    for (const a of D.acts) if (D.types.has(a.type)) for (const c of a.g) if (D.features[c]) n.set(c, (n.get(c) || 0) + 1);
    let best = null;
    for (const [c, k] of n) if (!best || k > best[1]) best = [c, k];
    return best ? best[0] : null;
  }

  // ------------------------------------------------------------ onderdelen
  function renderHead(D) {
    const d = new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    $("home-date").textContent = d.charAt(0).toUpperCase() + d.slice(1);
    const sel = $("home-round");
    const html = D.rounds.map((l, i) => `<option value="${i}">${esc(l.name)} · ${esc(l.short)}</option>`).reverse().join("");
    if (sel.dataset.key !== html) { sel.innerHTML = html; sel.dataset.key = html; }
    sel.value = String(D.round);
    $("home-round-new").classList.toggle("primary", D.ready && D.firsts.size >= D.total);
    document.querySelectorAll("#home-mode [data-hm]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hm === H.mode)));
  }

  function heroLines(D, V) {
    const n = V.firsts.size, total = D.total, pct = total ? n / total : 0;
    const l = D.rounds[D.round] || { name: "Ronde 1", since: "" };
    const lines = [`${nf1.format(Math.round(pct * 1000) / 10)}% van Nederland ${V.verb}, ${esc(l.since)}.`];
    if (V.prevFirsts) {
      const pl = D.rounds[D.round - 1];
      lines.push(V.prevFirsts.size === total ? `${esc(pl.name)} voltooid: ${total} van ${total}.` : `${esc(pl.name)}: ${V.prevFirsts.size} van ${total}.`);
    }
    return lines;
  }

  function renderHero(D) {
    const el = $("home-hero");
    if (!D.ready) { el.innerHTML = `<p class="eyebrow">Gemeenten</p><p class="hero-p">Kaart laden…</p>`; return; }
    if (H.mode === "all") { renderHeroAll(D); return; }
    const V = viewFor(D, H.mode);
    el.classList.toggle("walk", V.kind === "foot");
    const n = V.firsts.size, total = D.total, pct = total ? n / total : 0;
    const l = D.rounds[D.round] || { name: "Ronde 1", since: "" };
    const thisMonth = isoToday().slice(0, 7);
    const newMonth = [...V.firsts.values()].filter((a) => a.date.startsWith(thisMonth)).length;
    const per = perProvince(D, V.firsts);
    const full = Object.values(per).filter((p) => p.v === p.t).length;
    const pills = [];
    pills.push(`<span class="pill acc">+${newMonth} in ${MAAND[Number(thisMonth.slice(5, 7)) - 1]}</span>`);
    if (full) pills.push(`<span class="pill">${full} ${full === 1 ? "provincie" : "provincies"} compleet</span>`);
    if (!D.roundOpen) pills.push(`<span class="pill">Afgesloten ronde</span>`);
    const done = n >= total && total > 0;
    const big = done ? `Alle gemeenten ${V.verb}!` : `Nog ${nf.format(total - n)} te gaan`;
    const next = `Ronde ${D.rounds.length + 1}`;
    const color = V.kind === "foot" ? "var(--walk)" : "var(--accent)";
    const hint = V.kind === "foot" && V.noRoutes
      ? `<div class="hero-cta walk-hint"><div><b>Nog geen gewandelde gemeenten</b><span>Lees je Strava-archief één keer opnieuw in; dan bewaart de app ook de routes van je wandelingen.</span></div>
          <button type="button" class="btn" data-action="pick-archive">Archief inlezen</button></div>` : "";
    el.innerHTML = `<div class="hero-wrap">
      <div class="hero-main">
        <p class="eyebrow acc">${esc(l.name)} · ${esc(l.since)}${V.eyebrow}</p>
        <div class="hero-row">
          ${ring(pct, 180, 17, `<span class="ring-n">${nf.format(n)}</span><span class="ring-of">van ${nf.format(total)} gemeenten</span>`, color)}
          <div class="hero-txt">
            <p class="hero-big">${big}</p>
            <p class="hero-p">${heroLines(D, V).join("<br>")}</p>
            <div class="pills">${pills.join("")}</div>
          </div>
        </div>
        ${V.medals}
        ${hint}
        ${done ? `<div class="hero-cta"><div><b>${esc(l.name)} voltooid!</b><span>Begin opnieuw: start ${next} vanaf een datum die je zelf kiest.</span></div>
          <button type="button" class="btn primary" data-newround>Start ${next}</button></div>` : ""}
        <div class="actions">
          <button type="button" class="btn ${done ? "" : "primary"}" data-view="map">${IC.map}Open de kaart</button>
          ${done || V.kind === "foot" ? "" : `<button type="button" class="btn" id="home-todo">Lijst nog te gaan</button>`}
        </div>
      </div>
      ${miniMap(D, (c) => (V.firsts.has(c) ? V.mapCls : "u"))}
    </div>`;
  }

  // Alles: fietsen en wandelen naast elkaar
  function renderHeroAll(D) {
    H.lastD = D;
    const el = $("home-hero");
    el.classList.remove("walk");
    const B = viewFor(D, "bike"), W = viewFor(D, "foot");
    const l = D.rounds[D.round] || { name: "Ronde 1", since: "" };
    const total = D.total;
    const both = [...B.firsts.keys()].filter((c) => W.firsts.has(c)).length;
    const union = new Set([...B.firsts.keys(), ...W.firsts.keys()]).size;
    // Klik op een cirkel (of in de legenda) om die sport voorop te zetten op het kaartje; nog eens klikken = alles
    const F = H.allFocus || "";
    const col = (V, kind, color, label) => `<button type="button" class="hero-col pick${F && F !== kind ? " dim" : ""}" data-focus="${kind}" aria-pressed="${F === kind}" title="${F === kind ? "Toon weer alles" : `Zet ${label.toLowerCase()} voorop op het kaartje`}">
        ${ring(total ? V.firsts.size / total : 0, 150, 15, `<span class="ring-n">${nf.format(V.firsts.size)}</span><span class="ring-of">van ${nf.format(total)}</span>`, color)}
        <span class="hero-col-l"><span class="dot" style="background:${color}"></span>${label}</span></button>`;
    const cls = (c) => {
      const b = B.firsts.has(c), w = W.firsts.has(c);
      if (!b && !w) return "u";
      if (F === "bike") return b ? "v" : "w dim";
      if (F === "foot") return w ? "w" : "v dim";
      return b && w ? "both" : b ? "v" : "w";
    };
    const leg = F === "bike"
      ? `<span><i class="v"></i>gefietst (${nf.format(B.firsts.size)})</span><span class="faint"><i class="w"></i>alleen gewandeld</span>`
      : F === "foot"
        ? `<span><i class="w"></i>gewandeld (${nf.format(W.firsts.size)})</span><span class="faint"><i class="v"></i>alleen gefietst</span>`
        : `<span><i class="v"></i>alleen gefietst</span><span><i class="both"></i>allebei</span><span><i class="w"></i>alleen gewandeld</span>`;
    el.innerHTML = `<div class="hero-wrap">
      <div class="hero-main">
        <p class="eyebrow acc">${esc(l.name)} · ${esc(l.since)} · fietsen en wandelen</p>
        <div class="hero-row">
          ${col(B, "bike", "var(--accent)", "Gefietst")}
          ${col(W, "foot", "var(--walk)", "Gewandeld")}
          <div class="hero-txt">
            <p class="hero-big">${nf.format(union)} gemeenten bezocht</p>
            <p class="hero-p">${nf.format(both)} gefietst én gewandeld.<br>${nf.format(total - union)} nog helemaal niet.</p>
          </div>
        </div>
        ${W.noRoutes ? `<div class="hero-cta walk-hint"><div><b>Gewandelde gemeenten ontbreken nog</b><span>Lees je Strava-archief één keer opnieuw in.</span></div><button type="button" class="btn" data-action="pick-archive">Archief inlezen</button></div>` : ""}
        <div class="actions"><button type="button" class="btn primary" data-view="map">${IC.map}Open de kaart</button></div>
      </div>
      <div class="mini-wrap">${miniMap(D, cls)}
        <p class="mini-leg">${leg}</p>
        <p class="mini-tip">${F ? "Klik nog eens op de cirkel om alles te tonen." : "Klik op een cirkel om die sport voorop te zetten."}</p></div>
    </div>`;
  }

  const MODE_TXT = { bike: ["fietsen", "fietsdoel", "gereden"], foot: ["wandelen", "wandeldoel", "gelopen"], total: ["totaal", "totaaldoel", "afgelegd"] };
  function renderGoal(M) {
    const el = $("home-goal");
    const y = M.y;
    const [lab, goalWord, verb] = MODE_TXT[M.mode] || MODE_TXT.bike;
    el.classList.toggle("walk", M.mode === "foot");
    H.goalM = M;
    const edit = `<button type="button" class="goal-edit" data-goal-edit aria-label="Jaardoel ${y} aanpassen" title="Jaardoel aanpassen"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>Aanpassen</button>`;
    if (H.goalEdit) { if (el.querySelector("#home-goal-form")) return; el.innerHTML = goalForm(M); const i = el.querySelector("input"); if (i) i.focus(); return; }
    if (!M.G) {
      el.innerHTML = `<p class="eyebrow">Jaardoel ${y} · ${lab}</p>
        <p class="goal-big">${nf.format(M.ytd)} <small>km</small></p>
        <p class="hero-p">Je hebt nog geen ${goalWord} voor ${y}. Stel er een in bij Kilometers; dan zie je hier of je op schema ligt.</p>
        <div class="actions"><button type="button" class="btn primary" data-goal-edit>Doel instellen</button></div>`;
      return;
    }
    const diff = M.ytd - M.planToday;
    const end = new Date(y, 11, 31), now = new Date();
    const daysLeft = Math.max(1, Math.round((end - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5) + 1);
    const left = Math.max(0, M.G - M.ytd);
    let status;
    if (M.ytd >= M.G) status = `<div class="gstatus ahead"><b>Gehaald!</b><span>Je ${goalWord} voor ${y} is binnen.</span></div>`;
    else if (diff >= 0) status = `<div class="gstatus ahead"><b>+${nf.format(diff)} km</b><span>voor op schema. Nog ${nf.format(left)} km te gaan.</span></div>`;
    else status = `<div class="gstatus"><b>−${nf.format(-diff)} km</b><span>achter op schema. Inhalen: ±${nf.format(Math.ceil(left / daysLeft))} km per dag tot 31 december.</span></div>`;
    const foot = M.mode === "bike" && M.goalFoot ? `<p class="gfoot">Wandelen: <b>${nf.format(M.footYtd)}</b> van ${nf.format(M.goalFoot)} km</p>` : "";
    const prog = M.projected && M.c < 12 ? `<p class="gfoot">Prognose eind ${y}: <b>${nf.format(M.projected)} km</b></p>` : "";
    el.innerHTML = `<div class="goal-head"><p class="eyebrow">Jaardoel ${y} · ${lab}</p>${edit}</div>
      <p class="goal-big">${nf.format(M.ytd)} <small>/ ${nf.format(M.G)} km</small></p>
      <div class="gbar" role="img" aria-label="${nf.format(M.ytd)} van ${nf.format(M.G)} km; schema vandaag ${nf.format(M.planToday)} km"><span style="width:${Math.min(100, (M.ytd / M.G) * 100).toFixed(1)}%"></span><i style="left:${Math.min(100, (M.planToday / M.G) * 100).toFixed(1)}%"></i></div>
      <div class="gmeta"><span>${nf.format((M.ytd / M.G) * 100)}% ${verb}</span><span>Schema vandaag: ${nf.format(M.planToday)} km</span></div>
      ${status}${prog}${foot}`;
  }

  // Strava-archief: wanneer kun je weer een nieuw archief aanvragen (1x per week)?
  function renderStrava(D) {
    const el = $("home-strava");
    const st = D.status || {};
    const sw = window.FG.stravaWindow(st);
    const day = (ts, wd) => new Date(ts * 1000).toLocaleDateString("nl-NL", { weekday: wd ? "long" : undefined, day: "numeric", month: "long" });
    const newest = st.newest ? new Date(st.newest).toLocaleDateString("nl-NL", { day: "numeric", month: "long" }) : "";
    const archTxt = sw.arch ? `${sw.estimated ? "Laatst ingelezen" : "Laatste archief"}: ${day(sw.arch)}${newest ? ` · nieuwste activiteit: ${newest}` : ""}.` : "Nog geen archief ingelezen.";
    const ext = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`;
    const read = (primary) => `<button type="button" class="btn${primary ? " primary" : ""}" data-action="pick-archive">Archief inlezen</button>`;
    let state, pill, sub, acts;
    if (sw.pending) {
      state = "pending";
      pill = `Aangevraagd op ${day(sw.req)}`;
      sub = `Strava mailt je een downloadlink, meestal binnen een paar uur. Download de zip en lees hem hier in. ${archTxt}`;
      acts = `${read(true)}<button type="button" class="link" data-strava-undo>Toch niet aangevraagd</button>`;
    } else if (sw.canRequest) {
      state = "open";
      pill = "Nieuw archief aanvragen kan";
      sub = `${archTxt} Vraag bij Strava een nieuw archief aan (Instellingen › Mijn account › Download je account › Aan de slag). Dat kan één keer per week.`;
      acts = `<a class="btn primary" href="${window.FG.stravaUrl}" target="_blank" rel="noopener noreferrer" data-strava-req>Aanvragen bij Strava ${ext}</a>${read(false)}`;
    } else {
      state = "wait";
      const hm = new Date(sw.next * 1000).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
      pill = sw.daysLeft === 0 ? `Weer mogelijk vandaag vanaf ${hm}` : `Weer mogelijk vanaf ${day(sw.next, true)}`;
      sub = `${archTxt} Strava staat één archief per week toe${sw.daysLeft === 0 ? "." : `; nog ${sw.daysLeft === 1 ? "1 dag" : `${sw.daysLeft} dagen`} wachten.`}`;
      acts = read(false);
    }
    el.dataset.state = state;
    el.innerHTML = `<div class="ss-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></div>
      <div class="ss-txt"><p class="ss-title">Strava-archief <span class="ss-pill">${pill}</span></p><p class="ss-sub">${sub}</p></div>
      <div class="ss-act">${acts}</div>`;
  }

  // Jaardoel invullen of aanpassen, direct op het overzicht
  function goalForm(M) {
    const y = M.y;
    const val = (kind) => window.FGKm.goal(kind, y) || "";
    const field = (kind, label) => `<label class="gf-row"><span>${label}</span><input type="number" name="${kind}" min="0" max="200000" step="50" inputmode="numeric" placeholder="bijv. ${kind === "foot" ? "700" : "5000"}" value="${val(kind)}"><span class="gf-u">km</span></label>`;
    const fields = M.mode === "total"
      ? field("bike", "Fietsen") + field("foot", "Wandelen")
      : field(M.mode === "foot" ? "foot" : "bike", M.mode === "foot" ? "Wandeldoel" : "Fietsdoel");
    const hint = M.mode === "total" ? "Het totaaldoel is fietsen en wandelen opgeteld." : M.mode === "foot" ? "Het schema verdeelt dit gelijk over de twaalf maanden." : "Het schema legt 80% in maart t/m oktober.";
    return `<form class="goal-edit-form" id="home-goal-form">
        <p class="eyebrow">Jaardoel ${y} instellen</p>
        ${fields}
        <p class="hint">${hint} Leeg of 0 = geen doel.</p>
        <div class="actions"><button type="submit" class="btn primary">Opslaan</button><button type="button" class="btn" data-goal-cancel>Annuleren</button></div>
      </form>`;
  }

  function renderMonths(M) {
    const el = $("home-months");
    const max = Math.max(1, ...M.tot, ...(M.G ? M.T : [0])) * 1.08;
    const bars = KORT.map((k, i) => {
      const v = M.tot[i], g = M.G ? M.T[i] : 0;
      const future = M.c >= 0 && i > M.c;
      const cur = i === M.c;
      const h = (v / max) * 170, gh = (g / max) * 170;
      const label = `${MAAND[i]}: ${nf.format(v)} km${g ? ` van ${nf.format(g)} km doel` : ""}`;
      const low = g && v < g && !cur ? " low" : "";
      let fill;
      if (M.mode === "total") {
        const fb = M.ser.out[i] + M.ser.ind[i], ff = M.ser.walk[i] + M.ser.run[i];
        fill = `<span class="fill stack${low}" style="height:${Math.max(future ? 0 : 2, h).toFixed(0)}px"><span class="sf" style="height:${v ? ((ff / v) * 100).toFixed(1) : 0}%"></span><span class="sb" style="height:${v ? ((fb / v) * 100).toFixed(1) : 100}%"></span></span>`;
      } else fill = `<span class="fill${low}" style="height:${Math.max(future ? 0 : 2, h).toFixed(0)}px"></span>`;
      return `<button type="button" class="mbar${cur ? " cur" : ""}${future ? " future" : ""}" data-m="${i}" ${future ? "disabled" : ""} aria-label="${label}" title="${label}">
        <span class="mv">${v ? (v >= 1000 ? nf1.format(v / 1000) + "k" : nf.format(v)) : ""}</span>
        <span class="mcol">${g ? `<span class="goal" style="bottom:${gh.toFixed(0)}px"></span>` : ""}${fill}</span>
        <span class="ml">${k}</span></button>`;
    }).join("");
    el.classList.toggle("walk", M.mode === "foot");
    const sub = { bike: "Fietsen", foot: "Wandelen en hardlopen", total: "Fietsen en wandelen samen" }[M.mode] || "Fietsen";
    const leg = M.mode === "total" ? '<span><i></i>Fietsen</span><span><i class="w"></i>Wandelen</span>' : `<span><i></i>${MODE_TXT[M.mode][2].charAt(0).toUpperCase() + MODE_TXT[M.mode][2].slice(1)}</span>`;
    el.innerHTML = `<div class="hcard-head"><div><h2>Kilometers per maand ${M.y}</h2><p class="sub">${sub}${M.G && M.mode === "bike" ? " · doel 80% in maart–oktober, 20% in de wintermaanden" : ""}</p></div>
      <div class="mleg">${leg}${M.G ? '<span><i class="dash"></i>Maanddoel</span>' : ""}<button type="button" class="link" data-view="km">Naar kilometers</button></div></div>
      <div class="mbars">${bars}</div>`;
    el.querySelectorAll(".mbar:not([disabled])").forEach((b) => b.addEventListener("click", () => window.FGKm.openMonth(M.y, Number(b.dataset.m), M.mode)));
  }

  function renderNext(D) {
    const el = $("home-next");
    if (!D.ready) { el.innerHTML = `<h2>Volgende uitdaging</h2><p class="hero-p">Kaart laden…</p>`; return; }
    const hc = homeCode(D);
    const V = viewFor(D, H.mode === "foot" ? "foot" : "bike");
    const ever = new Set();
    for (const a of V.acts) a.g.forEach((c) => ever.add(c));
    const todo = Object.keys(D.features).filter((c) => !V.firsts.has(c));
    if (!todo.length) {
      el.innerHTML = `<h2>Volgende uitdaging</h2><p class="hero-p">Alle gemeenten van deze ronde heb je gehad. Tijd voor een nieuwe ronde!</p>
        <div class="actions"><button type="button" class="btn primary" data-newround>Start Ronde ${D.rounds.length + 1}</button></div>`;
      return;
    }
    const from = (hc && center(D.features[hc])) || [52.2, 5.3];
    const list = todo.filter((c) => center(D.features[c])).map((c) => ({ c, d: distKm(from, center(D.features[c])) })).sort((a, b) => a.d - b.d).slice(0, 4);
    const what = V.kind === "foot" ? "Nog niet gewandeld" : "Nog niet gefietst";
    el.innerHTML = `<div><h2>Volgende ${V.kind === "foot" ? "wandeluitdaging" : "uitdaging"}</h2><p class="sub">${what} in deze ronde${hc ? `, dichtstbij ${esc(D.features[hc].naam)}` : ""}</p></div>
      <ul class="rows">${list.map(({ c, d }) => {
        const f = D.features[c];
        return `<li><button type="button" class="row-btn" data-code="${esc(c)}"><span class="row-ico blue">${IC.pin}</span>
          <span><span class="row-t">${esc(f.naam)}</span><span class="row-s">${esc(f.provincie)} · ${ever.has(c) ? `al eens ${V.verb}` : `nog nooit ${V.verb}`}</span></span>
          <span class="row-v">${nf.format(d)} <small>km</small></span></button></li>`;
      }).join("")}</ul>
      <div class="actions"><button type="button" class="btn" data-action="routecheck">${IC.check}Route controleren</button></div>`;
  }

  function renderRecent(D, rides) {
    const el = $("home-recent");
    const byId = new Map(D.acts.map((a) => [a.id, a]));
    const footById = new Map(H.foot.map((a) => [a.id, a]));
    const fresh = new Map();
    for (const [, a] of D.firsts) fresh.set(a.id, (fresh.get(a.id) || 0) + 1);
    for (const [, a] of viewFor(D, "foot").firsts) fresh.set(a.id, (fresh.get(a.id) || 0) + 1);
    const pick = H.mode === "bike" ? (r) => r.cat === "bike" : H.mode === "foot" ? (r) => r.cat === "foot" : () => true;
    const list = rides.filter(pick).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 6);
    const title = { bike: "Laatste ritten", foot: "Laatste wandelingen", all: "Laatste activiteiten" }[H.mode];
    if (!list.length) { el.innerHTML = `<h2>${title}</h2><p class="hero-p">Nog geen activiteiten.</p>`; return; }
    el.innerHTML = `<div class="hcard-head"><h2>${title}</h2>${H.mode === "foot" ? "" : '<button type="button" class="link" data-view="rides">Alle ritten</button>'}</div>
      <ul class="rows">${list.map((r) => {
        const a = byId.get(r.id);
        const fa = footById.get(r.id);
        const ng = (a || fa) ? (a || fa).g.filter((c) => D.features[c]).length : 0;
        const nw = fresh.get(r.id) || 0;
        const ico = r.cat === "foot" ? `<span class="row-ico green">${IC.foot}</span>` : r.indoor ? `<span class="row-ico indoor">${IC.indoor}</span>` : `<span class="row-ico">${IC.bike}</span>`;
        const bits = [fmtDay(r.date), TYPE[r.type] || r.type];
        if (ng) bits.push(`${ng} ${ng === 1 ? "gemeente" : "gemeenten"}${nw ? `, <b>${nw} nieuw</b>` : ""}`);
        const target = a ? `data-ride="${r.id}"` : `data-month="${r.date.slice(0, 7)}" data-km="${r.cat === "foot" ? "foot" : "bike"}"`;
        return `<li><button type="button" class="row-btn" ${target}>${ico}
          <span><span class="row-t">${esc(r.name || "Activiteit")}</span><span class="row-s">${bits.join(" · ")}</span></span>
          <span class="row-v">${nf1.format(r.km)} <small>km</small></span></button></li>`;
      }).join("")}</ul>`;
  }

  function renderProv(D) {
    const el = $("home-prov");
    if (!D.ready) { el.innerHTML = `<h2>Per provincie</h2>`; return; }
    const rn = esc((D.rounds[D.round] || {}).name || "");
    if (H.mode === "all") {
      const per = perProvince(D, viewFor(D, "bike").firsts, viewFor(D, "foot").firsts);
      const rows = Object.entries(per).sort((a, b) => b[1].v / b[1].t - a[1].v / a[1].t || a[0].localeCompare(b[0]));
      el.innerHTML = `<div><h2>Per provincie</h2><p class="sub">${rn} · <span class="dot" style="background:var(--accent)"></span> gefietst <span class="dot" style="background:var(--walk)"></span> gewandeld</p></div>
        <ul class="plist two">${rows.map(([p, c]) => `<li data-prov="${esc(p)}" role="button" tabindex="0" title="Bekijk ${esc(p)}"><span class="pn">${esc(p)}</span><span class="pc">${c.v} · ${c.w} / ${c.t}</span><span class="pb"><span style="width:${((c.v / c.t) * 100).toFixed(0)}%"></span></span><span class="pb w"><span style="width:${((c.w / c.t) * 100).toFixed(0)}%"></span></span></li>`).join("")}</ul>`;
      return;
    }
    const V = viewFor(D, H.mode);
    el.classList.toggle("walk", V.kind === "foot");
    const per = perProvince(D, V.firsts);
    const rows = Object.entries(per).sort((a, b) => b[1].v / b[1].t - a[1].v / a[1].t || a[0].localeCompare(b[0]));
    el.innerHTML = `<div><h2>Per provincie</h2><p class="sub">${rn}${V.kind === "foot" ? " · gewandeld" : ""}</p></div>
      <ul class="plist">${rows.map(([p, c]) => `<li class="${c.v === c.t ? "full" : ""}" data-prov="${esc(p)}" role="button" tabindex="0" title="Bekijk ${esc(p)}"><span class="pn">${c.v === c.t ? `<span class="pmedal" aria-label="compleet">✓</span>` : ""}${esc(p)}</span><span class="pc">${c.v}/${c.t}</span><span class="pb"><span style="width:${((c.v / c.t) * 100).toFixed(0)}%"></span></span></li>`).join("")}</ul>`;
  }

  // ------------------------------------------------------------ geheel
  async function render() {
    if (!window.FG) return;
    const seq = ++H.seq;
    if (window.FG.sport) H.mode = window.FG.sport();
    const D = window.FG.data();
    renderHead(D);
    const st = D.status;
    const empty = st && !D.acts.length && !(st.rides > 0) && !st.last_import;
    $("home-empty").hidden = !empty;
    $("home-grid").hidden = !!empty;
    if (empty) return;
    try { H.foot = (await (await fetch("/api/foot")).json()).activities || []; } catch { H.foot = []; }
    if (seq !== H.seq) return;
    checkFootParties(D);
    if (window.FGProv) { window.FGProv.checkParties(D); if (!$("view-prov").hidden) window.FGProv.render(); }
    renderStrava(D);
    renderHero(D);
    renderNext(D);
    renderProv(D);
    if (!window.FGKm) return;
    const M = await window.FGKm.summary(H.mode === "all" ? "total" : H.mode);
    if (seq !== H.seq) return;
    renderGoal(M);
    renderMonths(M);
    renderRecent(D, M.rides);
  }

  let timer = null;
  function refresh() {
    if (!H.visible || $("view-home").hidden) return;
    clearTimeout(timer);
    timer = setTimeout(render, 30);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("home-round").addEventListener("change", (e) => window.FG.setRound(e.target.value));
    $("home-mode").addEventListener("click", (e) => {
      const b = e.target.closest("[data-hm]");
      if (!b) return;
      H.mode = b.dataset.hm;
      if (window.FG && window.FG.setSport) window.FG.setSport(H.mode);
      else try { localStorage.setItem("fg-home-mode", H.mode); } catch { /* geen opslag */ }
      render();
    });
    $("view-home").addEventListener("submit", async (e) => {
      if (e.target.id !== "home-goal-form") return;
      e.preventDefault();
      const y = H.goalM ? H.goalM.y : new Date().getFullYear();
      for (const inp of e.target.querySelectorAll("input[name]")) {
        if (Number(inp.value || 0) !== window.FGKm.goal(inp.name, y)) await window.FGKm.setGoal(inp.name, y, inp.value);
      }
      H.goalEdit = false;
      render();
    });
    $("view-home").addEventListener("click", (e) => {
      const fo = e.target.closest("[data-focus]");
      if (fo) { H.allFocus = H.allFocus === fo.dataset.focus ? "" : fo.dataset.focus; if (H.lastD) renderHeroAll(H.lastD); return; }
      if (e.target.closest("[data-strava-req]")) { window.FG.stravaRequested(true).then(render); return; }
      if (e.target.closest("[data-strava-undo]")) { window.FG.stravaRequested(false).then(render); return; }
      if (e.target.closest("[data-goal-edit]")) { H.goalEdit = true; renderGoal(H.goalM); return; }
      if (e.target.closest("[data-goal-cancel]")) { H.goalEdit = false; renderGoal(H.goalM); return; }
      const g = e.target.closest("[data-code]");
      if (g) { window.FG.focusGemeente(g.dataset.code); return; }
      const r = e.target.closest("[data-ride]");
      if (r) { window.FG.openRide(Number(r.dataset.ride)); return; }
      const m = e.target.closest("[data-month]");
      if (m) { window.FGKm.openMonth(Number(m.dataset.month.slice(0, 4)), Number(m.dataset.month.slice(5, 7)) - 1, m.dataset.km); return; }
      if (e.target.closest("[data-newround]")) { openRoundDialog(); return; }
      if (e.target.closest("#home-todo")) {
        window.FG.openTodo();
      }
    });
  });
  window.addEventListener("fg-theme", refresh);

  // ------------------------------------------------------------ nieuwe ronde
  function previewRound() {
    const a = $("dr-from").value, z = $("dr-to").value;
    const D = window.FG.data();
    $("dr-ok").textContent = `Start Ronde ${D.rounds.length + 1}`;
    if (!a) { $("dr-preview").textContent = ""; return; }
    const p = window.FG.roundPreview(a, z);
    const when = new Date(a + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
    $("dr-preview").innerHTML = a > isoToday()
      ? `Deze ronde begint op ${esc(when)}; je start dan met 0 van ${p.total}.`
      : `Met ritten vanaf ${esc(when)} sta je meteen op <b>${nf.format(p.n)}</b> van ${nf.format(p.total)} gemeenten.`;
  }
  function renderRoundList() {
    const list = window.FG.roundsInfo();
    const total = window.FG.data().total;
    $("dr-list").innerHTML = list.map((r, i) => `
      <div class="dr-row${r.cur ? " cur" : ""}">
        <div class="dr-name"><b>${esc(r.name)}</b><span>${nf.format(r.n)} van ${nf.format(total)}${r.cur ? " · gekozen" : ""}</span></div>
        <label><span>Van${i === 0 ? " (leeg = begin)" : ""}</span><input type="date" data-ri="${i}" data-f="start" value="${esc(r.start)}" ${i === 0 ? 'title="Leeg = vanaf je eerste rit"' : "required"}></label>
        <label><span>Tot en met</span><input type="date" data-ri="${i}" data-f="end" value="${esc(r.end)}" title="Leeg = loopt door"></label>
        ${i === 0 ? `<span class="dr-base">basis</span>` : `<button type="button" class="dr-del" data-del="${i}" aria-label="${esc(r.name)} verwijderen" title="Verwijderen"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>`}
      </div>`).join("");
  }
  function openRoundDialog(focusNew = true) {
    $("dr-from").value = isoToday();
    $("dr-to").value = "";
    $("dr-err").hidden = true;
    renderRoundList();
    previewRound();
    $("dlg-round").showModal();
    if (focusNew) $("dr-from").focus(); else $("dr-x").focus();
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("home-round-new").addEventListener("click", () => openRoundDialog(true));
    $("home-round-edit").addEventListener("click", () => openRoundDialog(false));
    $("dr-x").addEventListener("click", () => $("dlg-round").close());
    $("dr-list").addEventListener("change", async (e) => {
      const inp = e.target.closest("[data-ri]");
      if (!inp) return;
      const err = await window.FG.updateRound(Number(inp.dataset.ri), inp.dataset.f, inp.value);
      $("dr-err").textContent = err || "";
      $("dr-err").hidden = !err;
      renderRoundList();
      previewRound();
    });
    $("dr-list").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-del]");
      if (!b) return;
      const i = Number(b.dataset.del);
      const r = window.FG.roundsInfo()[i];
      if (!confirm(`${r.name} (${r.since}) verwijderen? Je ritten blijven bewaard.`)) return;
      await window.FG.deleteRound(i);
      renderRoundList();
      previewRound();
    });
    $("dr-from").addEventListener("input", previewRound);
    $("dr-to").addEventListener("input", previewRound);
    $("dr-cancel").addEventListener("click", () => $("dlg-round").close());
    $("form-round").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = await window.FG.newRound($("dr-from").value, $("dr-to").value);
      if (err) { $("dr-err").textContent = err; $("dr-err").hidden = false; return; }
      $("dlg-round").close();
      window.FG.setView("home");
    });
  });

  window.FGHome = {
    show() { H.visible = true; render(); },
    refresh,
  };
  // De app kan het overzicht al gekozen hebben voordat dit bestand geladen was
  if (window.FG && window.FG.view() === "home") window.FGHome.show();
})();
