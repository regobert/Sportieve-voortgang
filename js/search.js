/* Fietsgemeenten - zoeken (Ctrl K): gemeenten, ritten, maanden en datums */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const nf1 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const MAAND = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const pad = (n) => String(n).padStart(2, "0");
  const TYPE = { Ride: "Fiets", GravelRide: "Gravel", MountainBikeRide: "MTB", EBikeRide: "E-bike", EMountainBikeRide: "E-MTB",
    VirtualRide: "Indoor", Velomobile: "Velomobiel", Handcycle: "Handbike", Walk: "Wandeling", Hike: "Hike", Run: "Hardlopen", TrailRun: "Trailrun" };

  const svg = (d) => `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    pin: svg('<path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
    bike: svg('<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16 10 8h5l3 8M10 8l4 8M9 5h3"/>'),
    cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    go: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  };

  const P = { items: [], sel: 0, rides: [] };
  const dlg = () => $("dlg-search");

  // ------------------------------------------------------------ datums herkennen
  function parseDate(q) {
    const t = q.trim().toLowerCase();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };
    m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) return { y: +m[3], m: +m[2], d: +m[1] };
    m = t.match(/^(\d{1,2})\s+([a-z]+)\.?\s*(\d{4})?$/);
    if (m) { const mi = monthIndex(m[2]); if (mi >= 0) return { y: m[3] ? +m[3] : new Date().getFullYear(), m: mi + 1, d: +m[1] }; }
    return null;
  }
  function monthIndex(w) {
    if (w.length < 3) return -1;
    return MAAND.findIndex((n) => n.startsWith(w) || (w === "mrt" && n === "maart"));
  }
  function parseMonth(q) {
    const t = q.trim().toLowerCase();
    let m = t.match(/^([a-z]+)\.?\s*(\d{4})?$/);
    if (m) { const mi = monthIndex(m[1]); if (mi >= 0) return { y: m[2] ? +m[2] : new Date().getFullYear(), m: mi + 1 }; }
    m = t.match(/^(\d{4})-(\d{1,2})$/) || null;
    if (m) return { y: +m[1], m: +m[2] };
    m = t.match(/^(\d{1,2})[-/](\d{4})$/);
    if (m) return { y: +m[2], m: +m[1] };
    return null;
  }
  const validYMD = (o) => o && o.m >= 1 && o.m <= 12 && (!o.d || (o.d >= 1 && o.d <= 31)) && o.y > 1990 && o.y < 2100;

  // ------------------------------------------------------------ resultaten
  function actions() {
    const dark = window.FGTheme && window.FGTheme.get() === "dark";
    return [
      { t: "Overzicht", s: "Startscherm", run: () => window.FG.setView("home") },
      { t: "Kaart", s: "Kaart van Nederland", run: () => window.FG.setView("map") },
      { t: "Activiteiten", s: "Alle ritten op de kaart", run: () => window.FG.setView("rides") },
      { t: "Kilometers", s: "Jaardoel, periodes en weken", run: () => window.FG.setView("km") },
      { t: "Routecheck", s: "GPX van een geplande route controleren", run: () => window.FG.routeCheck() },
      { t: dark ? "Lichte modus" : "Donkere modus", s: "Thema wisselen", run: () => window.FGTheme.toggle() },
      { t: "Instellingen", s: "Rondes, fietsen, feestjes", run: () => $("btn-settings").click() },
    ].map((a) => ({ ...a, g: "Snel naar", ico: IC.go }));
  }

  function rideItem(r, D, fresh) {
    const a = D.byId.get(r.id);
    const ng = a ? a.g.filter((c) => D.features[c]).length : 0;
    const nw = fresh.get(r.id) || 0;
    const s = [fmtDate(r.date), TYPE[r.type] || r.type];
    if (ng) s.push(`${ng} gemeenten${nw ? `, ${nw} nieuw` : ""}`);
    return {
      g: "Activiteiten", ico: IC.bike, t: r.name || "Activiteit", s: s.join(" · "), r: `${nf1.format(r.km)} km`,
      run: () => (a ? window.FG.openRide(r.id) : window.FGKm.openMonth(Number(r.date.slice(0, 4)), Number(r.date.slice(5, 7)) - 1)),
    };
  }

  function search(q) {
    const D = window.FG.data();
    D.byId = new Map(D.acts.map((a) => [a.id, a]));
    const fresh = new Map();
    for (const [, a] of D.firsts) fresh.set(a.id, (fresh.get(a.id) || 0) + 1);
    const rides = P.rides.slice().sort((a, b) => b.date.localeCompare(a.date));
    const nq = norm(q);
    const out = [];
    if (!nq) {
      out.push(...actions());
      rides.slice(0, 4).forEach((r) => out.push({ ...rideItem(r, D, fresh), g: "Laatste activiteiten" }));
      return out;
    }
    // Datum of maand
    const dt = parseDate(q);
    if (validYMD(dt)) {
      const iso = `${dt.y}-${pad(dt.m)}-${pad(dt.d)}`;
      const label = new Date(iso + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
      const day = rides.filter((r) => r.date === iso);
      day.forEach((r) => out.push({ ...rideItem(r, D, fresh), g: `Op ${label}` }));
      if (!day.length) out.push({ g: `Op ${label}`, ico: IC.cal, t: "Geen activiteiten op deze dag", s: "Kies een andere datum", run: null });
      out.push({ g: "Datum", ico: IC.cal, t: `Kaart van ${label}`, s: "Gemeenten en routes van die dag", run: () => window.FG.showRange(iso, iso, label, null, { routes: true }) });
    }
    const mo = !dt && parseMonth(q);
    if (validYMD(mo)) {
      const ym = `${mo.y}-${pad(mo.m)}`;
      const label = `${MAAND[mo.m - 1]} ${mo.y}`;
      const n = rides.filter((r) => r.date.startsWith(ym));
      const km = n.reduce((t, r) => t + r.km, 0);
      out.push({ g: "Maand", ico: IC.cal, t: `Kilometers in ${label}`, s: `${n.length} activiteiten`, r: `${nf1.format(km)} km`, run: () => window.FGKm.openMonth(mo.y, mo.m - 1) });
      out.push({ g: "Maand", ico: IC.cal, t: `Kaart van ${label}`, s: "Gemeenten en routes van die maand", run: () => window.FG.showMonth(ym) });
    }
    if (/^\d{4}$/.test(q.trim())) {
      const y = Number(q.trim());
      const n = rides.filter((r) => r.date.startsWith(String(y)));
      if (n.length) out.push({ g: "Jaar", ico: IC.cal, t: `Kilometers in ${y}`, s: `${n.length} activiteiten`, r: `${nf1.format(n.reduce((t, r) => t + r.km, 0))} km`, run: () => window.FGKm.openYear(y) });
    }
    // Gemeenten
    const gem = Object.entries(D.features).map(([code, f]) => ({ code, f, n: norm(f.naam) }))
      .filter((x) => x.n.includes(nq) || norm(x.f.naam.replace(/^'s-/, "")).startsWith(nq))
      .sort((a, b) => (b.n.startsWith(nq) - a.n.startsWith(nq)) || a.f.naam.localeCompare(b.f.naam)).slice(0, 6);
    const rl = (D.rounds[D.round] || {}).name || "";
    for (const x of gem) {
      const a = D.firsts.get(x.code);
      out.push({
        g: "Gemeenten", ico: IC.pin, icoCls: a ? "v" : "u", t: x.f.naam,
        s: `${x.f.provincie} · ${a ? `${rl}: sinds ${new Date(a.date + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}` : `${rl}: nog te gaan`}`,
        run: () => window.FG.focusGemeente(x.code),
      });
    }
    // Ritten op naam
    if (nq.length >= 2) rides.filter((r) => norm(r.name).includes(nq)).slice(0, 7).forEach((r) => out.push(rideItem(r, D, fresh)));
    // Acties
    out.push(...actions().filter((a) => norm(a.t).includes(nq)));
    return out;
  }

  function draw() {
    const box = $("search-results");
    if (!P.items.length) { box.innerHTML = `<div class="pal-empty">Niets gevonden. Probeer een gemeente, een ritnaam of een datum.</div>`; return; }
    let g = "", html = "";
    P.items.forEach((it, i) => {
      if (it.g !== g) { g = it.g; html += `<div class="pal-group" role="presentation">${esc(g)}</div>`; }
      html += `<button type="button" class="pal-item" role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === P.sel}" ${it.run ? "" : "disabled"}>
        <span class="pal-ico ${it.icoCls || ""}">${it.ico}</span>
        <span><span class="pal-t">${esc(it.t)}</span>${it.s ? `<span class="pal-s">${esc(it.s)}</span>` : ""}</span>
        <span class="pal-r">${esc(it.r || "")}</span></button>`;
    });
    box.innerHTML = html;
    $("search-input").setAttribute("aria-activedescendant", `pal-${P.sel}`);
  }

  function update() {
    P.items = search($("search-input").value);
    P.sel = Math.max(0, P.items.findIndex((x) => x.run));
    draw();
  }

  function move(d) {
    if (!P.items.length) return;
    let i = P.sel;
    for (let k = 0; k < P.items.length; k++) {
      i = (i + d + P.items.length) % P.items.length;
      if (P.items[i].run) break;
    }
    P.sel = i;
    $("search-results").querySelectorAll(".pal-item").forEach((b) => b.setAttribute("aria-selected", String(Number(b.dataset.i) === i)));
    $("search-input").setAttribute("aria-activedescendant", `pal-${i}`);
    const el = $(`pal-${i}`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function choose(i) {
    const it = P.items[i];
    if (!it || !it.run) return;
    dlg().close();
    it.run();
  }

  async function open() {
    if (!window.FG) return;
    const d = dlg();
    if (d.open) { $("search-input").select(); return; }
    $("search-input").value = "";
    d.showModal();
    try { P.rides = (await window.FGKm.summary("bike")).rides || []; } catch { P.rides = []; }
    update();
    $("search-input").focus();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("search-input").addEventListener("input", update);
    $("search-input").addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); choose(P.sel); }
    });
    $("search-results").addEventListener("click", (e) => {
      const b = e.target.closest(".pal-item");
      if (b) choose(Number(b.dataset.i));
    });
    dlg().addEventListener("click", (e) => { if (e.target === dlg()) dlg().close(); });
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest('[data-action="search"]')) open();
  });
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open(); }
    else if (e.key === "/" && !typing && !document.querySelector("dialog[open]")) { e.preventDefault(); open(); }
  });

  window.FGSearch = { open };
})();
