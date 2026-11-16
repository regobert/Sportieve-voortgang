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

  const H = { visible: false, paths: null, pathsKey: "", home: null, seq: 0 };

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
  function miniMap(D) {
    const key = Object.keys(D.features).length;
    if (!H.paths || H.pathsKey !== key) { H.paths = buildPaths(D.features); H.pathsKey = key; }
    const paths = H.paths.map(([c, d]) => `<path class="${D.firsts.has(c) ? "v" : "u"}" d="${d}"/>`).join("");
    return `<button type="button" class="mini-map" data-view="map" aria-label="Open de kaart"><svg viewBox="0 0 560 660" aria-hidden="true">${paths}</svg></button>`;
  }

  // ------------------------------------------------------------ helpers
  function ring(pct, size = 180, stroke = 17, inner = "") {
    const r = (size - stroke) / 2, C = 2 * Math.PI * r, L = C * Math.max(0, Math.min(1, pct));
    return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--chip)" stroke-width="${stroke}"/>
      ${L > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${L.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ""}</svg>
      <div class="ring-c">${inner}</div></div>`;
  }
  function perProvince(D) {
    const per = {};
    for (const [code, f] of Object.entries(D.features)) {
      const p = (per[f.provincie] ||= { t: 0, v: 0 });
      p.t++;
      if (D.firsts.has(code)) p.v++;
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
  }

  function renderHero(D) {
    const el = $("home-hero");
    if (!D.ready) { el.innerHTML = `<p class="eyebrow">Gemeenten</p><p class="hero-p">Kaart laden…</p>`; return; }
    const n = D.firsts.size, total = D.total, pct = total ? n / total : 0;
    const l = D.rounds[D.round] || { name: "Ronde 1", since: "" };
    const thisMonth = isoToday().slice(0, 7);
    const newMonth = [...D.firsts.values()].filter((a) => a.date.startsWith(thisMonth)).length;
    const per = perProvince(D);
    const full = Object.values(per).filter((p) => p.v === p.t).length;
    const lines = [`${nf1.format(Math.round(pct * 1000) / 10)}% van Nederland, ${esc(l.since)}.`];
    if (D.prevFirsts) {
      const pl = D.rounds[D.round - 1];
      lines.push(D.prevFirsts.size === total ? `${esc(pl.name)} voltooid: ${total} van ${total}.` : `${esc(pl.name)}: ${D.prevFirsts.size} van ${total}.`);
    }
    const pills = [];
    pills.push(`<span class="pill acc">+${newMonth} in ${MAAND[Number(thisMonth.slice(5, 7)) - 1]}</span>`);
    if (full) pills.push(`<span class="pill">${full} ${full === 1 ? "provincie" : "provincies"} compleet</span>`);
    if (!D.roundOpen) pills.push(`<span class="pill">Afgesloten ronde</span>`);
    const done = n >= total && total > 0;
    const big = done ? "Alle gemeenten gehad!" : `Nog ${nf.format(total - n)} te gaan`;
    const next = `Ronde ${D.rounds.length + 1}`;
    el.innerHTML = `<div class="hero-wrap">
      <div class="hero-main">
        <p class="eyebrow acc">${esc(l.name)} · ${esc(l.since)}</p>
        <div class="hero-row">
          ${ring(pct, 180, 17, `<span class="ring-n">${nf.format(n)}</span><span class="ring-of">van ${nf.format(total)} gemeenten</span>`)}
          <div class="hero-txt">
            <p class="hero-big">${big}</p>
            <p class="hero-p">${lines.join("<br>")}</p>
            <div class="pills">${pills.join("")}</div>
          </div>
        </div>
        ${window.FG.medalsHtml()}
        ${done ? `<div class="hero-cta"><div><b>${esc(l.name)} voltooid!</b><span>Begin opnieuw: start ${next} vanaf een datum die je zelf kiest.</span></div>
          <button type="button" class="btn primary" data-newround>Start ${next}</button></div>` : ""}
        <div class="actions">
          <button type="button" class="btn ${done ? "" : "primary"}" data-view="map">${IC.map}Open de kaart</button>
          ${done ? "" : `<button type="button" class="btn" id="home-todo">Lijst nog te gaan</button>`}
        </div>
      </div>
      ${miniMap(D)}
    </div>`;
  }

  function renderGoal(M) {
    const el = $("home-goal");
    const y = M.y;
    if (!M.G) {
      el.innerHTML = `<p class="eyebrow">Jaardoel ${y} · fietsen</p>
        <p class="goal-big">${nf.format(M.ytd)} <small>km</small></p>
        <p class="hero-p">Je hebt nog geen fietsdoel voor ${y}. Stel er een in bij Kilometers; dan zie je hier of je op schema ligt.</p>
        <div class="actions"><button type="button" class="btn" data-view="km">Doel instellen</button></div>`;
      return;
    }
    const diff = M.ytd - M.planToday;
    const end = new Date(y, 11, 31), now = new Date();
    const daysLeft = Math.max(1, Math.round((end - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5) + 1);
    const left = Math.max(0, M.G - M.ytd);
    let status;
    if (M.ytd >= M.G) status = `<div class="gstatus ahead"><b>Gehaald!</b><span>Je fietsdoel voor ${y} is binnen.</span></div>`;
    else if (diff >= 0) status = `<div class="gstatus ahead"><b>+${nf.format(diff)} km</b><span>voor op schema. Nog ${nf.format(left)} km te gaan.</span></div>`;
    else status = `<div class="gstatus"><b>−${nf.format(-diff)} km</b><span>achter op schema. Inhalen: ±${nf.format(Math.ceil(left / daysLeft))} km per dag tot 31 december.</span></div>`;
    const foot = M.goalFoot ? `<p class="gfoot">Te voet: <b>${nf.format(M.footYtd)}</b> van ${nf.format(M.goalFoot)} km</p>` : "";
    const prog = M.projected && M.c < 12 ? `<p class="gfoot">Prognose eind ${y}: <b>${nf.format(M.projected)} km</b></p>` : "";
    el.innerHTML = `<p class="eyebrow">Jaardoel ${y} · fietsen</p>
      <p class="goal-big">${nf.format(M.ytd)} <small>/ ${nf.format(M.G)} km</small></p>
      <div class="gbar" role="img" aria-label="${nf.format(M.ytd)} van ${nf.format(M.G)} km; schema vandaag ${nf.format(M.planToday)} km"><span style="width:${Math.min(100, (M.ytd / M.G) * 100).toFixed(1)}%"></span><i style="left:${Math.min(100, (M.planToday / M.G) * 100).toFixed(1)}%"></i></div>
      <div class="gmeta"><span>${nf.format((M.ytd / M.G) * 100)}% gereden</span><span>Schema vandaag: ${nf.format(M.planToday)} km</span></div>
      ${status}${prog}${foot}`;
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
      return `<button type="button" class="mbar${cur ? " cur" : ""}${future ? " future" : ""}" data-m="${i}" ${future ? "disabled" : ""} aria-label="${label}" title="${label}">
        <span class="mv">${v ? (v >= 1000 ? nf1.format(v / 1000) + "k" : nf.format(v)) : ""}</span>
        <span class="mcol">${g ? `<span class="goal" style="bottom:${gh.toFixed(0)}px"></span>` : ""}<span class="fill${g && v < g && !cur ? " low" : ""}" style="height:${Math.max(future ? 0 : 2, h).toFixed(0)}px"></span></span>
        <span class="ml">${k}</span></button>`;
    }).join("");
    el.innerHTML = `<div class="hcard-head"><div><h2>Kilometers per maand ${M.y}</h2><p class="sub">Fietsen${M.G ? " · doel 80% in maart–oktober, 20% in de wintermaanden" : ""}</p></div>
      <div class="mleg"><span><i></i>Gereden</span>${M.G ? '<span><i class="dash"></i>Maanddoel</span>' : ""}<button type="button" class="link" data-view="km">Naar kilometers</button></div></div>
      <div class="mbars">${bars}</div>`;
    el.querySelectorAll(".mbar:not([disabled])").forEach((b) => b.addEventListener("click", () => window.FGKm.openMonth(M.y, Number(b.dataset.m))));
  }

  function renderNext(D) {
    const el = $("home-next");
    if (!D.ready) { el.innerHTML = `<h2>Volgende uitdaging</h2><p class="hero-p">Kaart laden…</p>`; return; }
    const hc = homeCode(D);
    const ever = new Set();
    for (const a of D.acts) if (D.types.has(a.type)) a.g.forEach((c) => ever.add(c));
    const todo = Object.keys(D.features).filter((c) => !D.firsts.has(c));
    if (!todo.length) {
      el.innerHTML = `<h2>Volgende uitdaging</h2><p class="hero-p">Alle gemeenten van deze ronde heb je gehad. Tijd voor een nieuwe ronde!</p>
        <div class="actions"><button type="button" class="btn primary" data-newround>Start Ronde ${D.rounds.length + 1}</button></div>`;
      return;
    }
    const from = (hc && center(D.features[hc])) || [52.2, 5.3];
    const list = todo.filter((c) => center(D.features[c])).map((c) => ({ c, d: distKm(from, center(D.features[c])) })).sort((a, b) => a.d - b.d).slice(0, 4);
    el.innerHTML = `<div><h2>Volgende uitdaging</h2><p class="sub">${hc ? `Dichtstbij ${esc(D.features[hc].naam)}, hemelsbreed` : "Nog niet bezocht in deze ronde"}</p></div>
      <ul class="rows">${list.map(({ c, d }) => {
        const f = D.features[c];
        return `<li><button type="button" class="row-btn" data-code="${esc(c)}"><span class="row-ico blue">${IC.pin}</span>
          <span><span class="row-t">${esc(f.naam)}</span><span class="row-s">${esc(f.provincie)} · ${ever.has(c) ? "al eens geweest" : "nog nooit geweest"}</span></span>
          <span class="row-v">${nf.format(d)} <small>km</small></span></button></li>`;
      }).join("")}</ul>
      <div class="actions"><button type="button" class="btn" data-action="routecheck">${IC.check}Route controleren</button></div>`;
  }

  function renderRecent(D, rides) {
    const el = $("home-recent");
    const byId = new Map(D.acts.map((a) => [a.id, a]));
    const fresh = new Map();
    for (const [, a] of D.firsts) fresh.set(a.id, (fresh.get(a.id) || 0) + 1);
    const list = rides.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 6);
    if (!list.length) { el.innerHTML = `<h2>Laatste activiteiten</h2><p class="hero-p">Nog geen activiteiten.</p>`; return; }
    el.innerHTML = `<div class="hcard-head"><h2>Laatste activiteiten</h2><button type="button" class="link" data-view="rides">Alle ritten</button></div>
      <ul class="rows">${list.map((r) => {
        const a = byId.get(r.id);
        const ng = a ? a.g.filter((c) => D.features[c]).length : 0;
        const nw = fresh.get(r.id) || 0;
        const ico = r.cat === "foot" ? `<span class="row-ico green">${IC.foot}</span>` : r.indoor ? `<span class="row-ico indoor">${IC.indoor}</span>` : `<span class="row-ico">${IC.bike}</span>`;
        const bits = [fmtDay(r.date), TYPE[r.type] || r.type];
        if (ng) bits.push(`${ng} ${ng === 1 ? "gemeente" : "gemeenten"}${nw ? `, <b>${nw} nieuw</b>` : ""}`);
        const target = a ? `data-ride="${r.id}"` : `data-month="${r.date.slice(0, 7)}"`;
        return `<li><button type="button" class="row-btn" ${target}>${ico}
          <span><span class="row-t">${esc(r.name || "Activiteit")}</span><span class="row-s">${bits.join(" · ")}</span></span>
          <span class="row-v">${nf1.format(r.km)} <small>km</small></span></button></li>`;
      }).join("")}</ul>`;
  }

  function renderProv(D) {
    const el = $("home-prov");
    if (!D.ready) { el.innerHTML = `<h2>Per provincie</h2>`; return; }
    const per = perProvince(D);
    const rows = Object.entries(per).sort((a, b) => b[1].v / b[1].t - a[1].v / a[1].t || a[0].localeCompare(b[0]));
    el.innerHTML = `<div><h2>Per provincie</h2><p class="sub">${esc((D.rounds[D.round] || {}).name || "")}</p></div>
      <ul class="plist">${rows.map(([p, c]) => `<li class="${c.v === c.t ? "full" : ""}"><span class="pn">${esc(p)}</span><span class="pc">${c.v}/${c.t}</span><span class="pb"><span style="width:${((c.v / c.t) * 100).toFixed(0)}%"></span></span></li>`).join("")}</ul>`;
  }

  // ------------------------------------------------------------ geheel
  async function render() {
    if (!window.FG) return;
    const seq = ++H.seq;
    const D = window.FG.data();
    renderHead(D);
    const st = D.status;
    const empty = st && !D.acts.length && !(st.rides > 0) && !st.last_import;
    $("home-empty").hidden = !empty;
    $("home-grid").hidden = !!empty;
    if (empty) return;
    renderHero(D);
    renderNext(D);
    renderProv(D);
    if (!window.FGKm) return;
    const M = await window.FGKm.summary("bike");
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
    $("view-home").addEventListener("click", (e) => {
      const g = e.target.closest("[data-code]");
      if (g) { window.FG.focusGemeente(g.dataset.code); return; }
      const r = e.target.closest("[data-ride]");
      if (r) { window.FG.openRide(Number(r.dataset.ride)); return; }
      const m = e.target.closest("[data-month]");
      if (m) { window.FGKm.openMonth(Number(m.dataset.month.slice(0, 4)), Number(m.dataset.month.slice(5, 7)) - 1); return; }
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
