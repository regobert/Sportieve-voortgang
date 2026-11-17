/* Provinciepagina: één provincie uitgelicht, met voortgang, weetjes, nog te gaan, tijdlijn en medailles */
(function () {
  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("nl-NL");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
  const today = () => new Date().toISOString().slice(0, 10);

  const P = { prov: "", back: "home", sel: "", showAll: false, cache: null };
  const WORD = {
    bike: { verb: "gefietst", acts: "ritten", none: "Nog geen rit door deze provincie in deze ronde.", done: "compleet" },
    foot: { verb: "gewandeld", acts: "wandelingen", none: "Nog geen wandeling door deze provincie in deze ronde.", done: "helemaal bewandeld" },
    all: { verb: "bezocht", acts: "activiteiten", none: "Nog geen activiteit door deze provincie in deze ronde.", done: "compleet" },
  };
  const PMS = [50, 100];

  // ------------------------------------------------------------ gegevens
  function byProvince(D) {
    const m = new Map();
    for (const [code, f] of Object.entries(D.features)) {
      if (!m.has(f.provincie)) m.set(f.provincie, []);
      m.get(f.provincie).push(code);
    }
    return m;
  }
  /** Mijlpalen 50% en 100% binnen een provincie */
  function provMilestones(codes, firsts) {
    const order = codes.filter((c) => firsts.has(c)).map((c) => [c, firsts.get(c)]).sort((x, y) => x[1].date.localeCompare(y[1].date));
    return PMS.map((pct) => {
      const n = Math.ceil((pct / 100) * codes.length);
      const hit = order.length >= n ? order[n - 1] : null;
      return { pct, n, date: hit ? hit[1].date : null, code: hit ? hit[0] : null, act: hit ? hit[1] : null };
    });
  }
  function centerOf(f) {
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

  // ------------------------------------------------------------ feestjes en medailles (fietsen en wandelen apart)
  function checkParties(D) {
    if (!window.FGParty || !D.ready) return;
    const provs = byProvince(D);
    D.ranges.forEach((range, i) => {
      for (const kind of ["bike", "foot"]) {
        const firsts = window.FG.firsts(i, kind);
        if (kind === "foot" && !firsts.size) continue;
        const rname = D.rounds[i].name;
        for (const [prov, codes] of provs) {
          const group = `prov-${kind}-${range.start || "begin"}${range.end ? `-${range.end}` : ""}-${prov}`;
          const items = provMilestones(codes, firsts).map((m) => ({ pct: m.pct, date: m.date, build: () => {
            const naam = m.code && D.features[m.code] ? D.features[m.code].naam : "";
            const walk = kind === "foot";
            const title = m.pct === 100 ? (walk ? `${prov} helemaal bewandeld!` : `${prov} compleet!`) : `Halverwege ${prov}`;
            return {
              title,
              lead: `${esc(rname)}: ${m.n} van de ${codes.length} gemeenten in ${esc(prov)} ${walk ? "gewandeld" : "bezocht"}.${naam ? ` Nummer ${m.n} was <b>${esc(naam)}</b>.` : ""}`,
              rows: [["Bereikt op", m.act ? `${fmt(m.date)}, met “${esc(m.act.name || (walk ? "Wandeling" : "Rit"))}”` : fmt(m.date)]],
              chips: [],
            };
          } }));
          window.FGParty.check(group, `${rname}: ${prov}${kind === "foot" ? " (gewandeld)" : ""}`, items, true);
        }
      }
    });
  }

  // ------------------------------------------------------------ kaart
  function provMap(D, prov, codes, cls) {
    const inProv = new Set(codes);
    let s = 90, w = 180, n = -90, e = -180;
    for (const c of codes) {
      const b = D.features[c].layer.getBounds();
      if (!b.isValid()) continue;
      s = Math.min(s, b.getSouth()); n = Math.max(n, b.getNorth());
      w = Math.min(w, b.getWest()); e = Math.max(e, b.getEast());
    }
    const lat0 = (s + n) / 2, kx = Math.cos((lat0 * Math.PI) / 180);
    const padX = (e - w) * 0.06, padY = (n - s) * 0.06;
    s -= padY; n += padY; w -= padX; e += padX;
    const W = 640, scale = W / ((e - w) * kx), H = Math.round((n - s) * scale);
    const pt = (lon, lat) => [(lon - w) * kx * scale, (n - lat) * scale];
    const ring = (coords) => {
      let d = "", lx = -1e9, ly = -1e9, k = 0;
      for (const [lon, lat] of coords) {
        const [x, y] = pt(lon, lat);
        if (Math.abs(x - lx) + Math.abs(y - ly) < 0.9) continue;
        d += (k ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
        lx = x; ly = y; k++;
      }
      return k > 2 ? d + "Z" : "";
    };
    const pathOf = (f) => {
      const g = f.layer.feature && f.layer.feature.geometry;
      if (!g) return "";
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      return polys.map((p) => ring(p[0])).join("");
    };
    const nb = [], own = [];
    for (const [code, f] of Object.entries(D.features)) {
      if (inProv.has(code)) { own.push(`<path class="${cls(code)}${P.sel === code ? " sel" : ""}" data-pcode="${esc(code)}" d="${pathOf(f)}"><title>${esc(f.naam)}</title></path>`); continue; }
      const b = f.layer.getBounds();
      if (!b.isValid() || b.getSouth() > n || b.getNorth() < s || b.getWest() > e || b.getEast() < w) continue;
      nb.push(`<path class="nb" d="${pathOf(f)}"/>`);
    }
    const defs = `<defs><pattern id="pv-both" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" class="pb-a"/><rect width="5" height="10" class="pb-b"/></pattern></defs>`;
    return `<svg class="prov-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kaart van ${esc(prov)}">${defs}<g>${nb.join("")}</g><g>${own.join("")}</g></svg>`;
  }

  // ------------------------------------------------------------ render
  function render() {
    if (!window.FG) return;
    const D = window.FG.data();
    if (!D.ready || !P.prov) return;
    const sport = window.FG.sport();
    const Wd = WORD[sport];
    const provs = byProvince(D);
    if (!provs.has(P.prov)) P.prov = [...provs.keys()].sort()[0];
    const prov = P.prov, codes = provs.get(prov);
    const total = codes.length;
    const firsts = window.FG.firsts(D.round, sport);
    const fB = sport === "all" ? window.FG.firsts(D.round, "bike") : null;
    const fF = sport === "all" ? window.FG.firsts(D.round, "foot") : null;
    const visited = codes.filter((c) => firsts.has(c));
    const rl = D.rounds[D.round] || { name: "Ronde 1", since: "" };
    const range = D.ranges[D.round] || { start: "", end: "" };
    const types = window.FG.sportTypes(sport);
    const acts = D.acts.filter((a) => types.has(a.type) && (!range.start || a.date >= range.start) && (!range.end || a.date <= range.end));
    const inProv = new Set(codes);

    // kop
    const names = [...provs.keys()].sort();
    const idx = names.indexOf(prov);
    const prev = names[(idx + names.length - 1) % names.length], next = names[(idx + 1) % names.length];
    $("prov-title").textContent = prov;
    $("prov-kicker").textContent = `Provincie · ${rl.name}${rl.since ? ` · ${rl.since}` : ""}`;
    $("prov-prev").textContent = `‹ ${prev}`; $("prov-prev").dataset.go = prev;
    $("prov-next").textContent = `${next} ›`; $("prov-next").dataset.go = next;
    $("prov-pick").innerHTML = names.map((p) => `<option${p === prov ? " selected" : ""}>${esc(p)}</option>`).join("");
    document.querySelectorAll("#prov-mode [data-pm]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pm === sport)));
    $("view-prov").dataset.sport = sport;

    // kaart
    const cls = (c) => {
      if (sport === "all") {
        const b = fB.has(c), w = fF.has(c);
        return b && w ? "both" : b ? "v" : w ? "w" : "u";
      }
      return firsts.has(c) ? (sport === "foot" ? "w" : "v") : "u";
    };
    const legend = sport === "all"
      ? `<span><i class="v"></i>alleen gefietst</span><span><i class="both"></i>allebei</span><span><i class="w"></i>alleen gewandeld</span><span><i class="u"></i>nog niet</span>`
      : `<span><i class="${sport === "foot" ? "w" : "v"}"></i>${Wd.verb}</span><span><i class="u"></i>nog niet</span>`;
    $("prov-map").innerHTML = `${provMap(D, prov, codes, cls)}
      <div class="prov-map-foot"><p class="mini-leg">${legend}</p><p class="mini-tip">Klik op een gemeente voor details.</p></div>
      <div id="prov-gem">${gemInfo(D, P.sel, firsts, acts)}</div>`;

    // voortgang + rangorde + medailles
    const ranks = [...provs.entries()].map(([p, cs]) => [p, cs.filter((c) => firsts.has(c)).length / cs.length]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const pct = total ? visited.length / total : 0;
    const rank = ranks.filter(([, v]) => v > pct + 1e-9).length + 1;
    const tied = ranks.filter(([p, v]) => p !== prov && Math.abs(v - pct) < 1e-9).length;
    const ms = provMilestones(codes, firsts);
    const medal = (m) => `<div class="medal pmed${m.date ? " got" : ""}" title="${m.date ? `${m.pct}% gehaald op ${fmt(m.date)}` : `${m.pct}% nog niet gehaald`}">
        <span class="mdisc">${m.pct === 100 ? "100%" : "50%"}</span><span class="mlab">${m.pct === 100 ? "Compleet" : "Halverwege"}</span>
        <span class="mdate">${m.date ? fmt(m.date) : "nog niet"}</span></div>`;
    $("prov-score").innerHTML = `<p class="eyebrow acc">${Wd.verb === "bezocht" ? "Bezocht" : Wd.verb[0].toUpperCase() + Wd.verb.slice(1)}</p>
      <p class="prov-big">${nf.format(visited.length)} <small>van ${nf.format(total)} gemeenten</small></p>
      <div class="pbar"><span style="width:${(pct * 100).toFixed(1)}%"></span></div>
      <p class="sub">${Math.round(pct * 100)}% · ${tied ? `gedeeld ${rank}e` : `nummer ${rank}`} van ${ranks.length} provincies${tied && pct === 1 ? ` (${tied + 1} provincies compleet)` : ""}</p>
      <div class="medals two">${ms.map(medal).join("")}</div>`;

    // weetjes
    const count = new Map();
    let nActs = 0;
    for (const a of acts) {
      let hit = false;
      for (const c of new Set(a.g)) if (inProv.has(c)) { count.set(c, (count.get(c) || 0) + 1); hit = true; }
      if (hit) nActs++;
    }
    const order = visited.map((c) => [c, firsts.get(c)]).sort((x, y) => x[1].date.localeCompare(y[1].date));
    const most = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    const nm = (c) => esc(D.features[c].naam);
    const tile = (k, v, s, code) => `<button type="button" class="ftile"${code ? ` data-pcode="${esc(code)}"` : " disabled"}><span class="fk">${k}</span><span class="fv">${v}</span>${s ? `<span class="fs">${s}</span>` : ""}</button>`;
    const tiles = [];
    if (order.length) {
      tiles.push(tile("Eerste gemeente", nm(order[0][0]), fmt(order[0][1].date), order[0][0]));
      tiles.push(tile("Laatst nieuw", nm(order[order.length - 1][0]), fmt(order[order.length - 1][1].date), order[order.length - 1][0]));
    }
    if (most) tiles.push(tile("Vaakst", nm(most[0]), `${nf.format(most[1])}× in deze ronde`, most[0]));
    tiles.push(tile(Wd.acts[0].toUpperCase() + Wd.acts.slice(1), nf.format(nActs), "die de provincie in gingen"));
    if (sport === "all") {
      const both = codes.filter((c) => fB.has(c) && fF.has(c)).length;
      tiles.push(tile("Gefietst én gewandeld", nf.format(both), "gemeenten"));
    } else {
      const other = window.FG.firsts(D.round, sport === "foot" ? "bike" : "foot");
      const n = codes.filter((c) => other.has(c)).length;
      tiles.push(tile(sport === "foot" ? "Gefietst" : "Gewandeld", nf.format(n), `gemeenten ${sport === "foot" ? "gefietst" : "gewandeld"}`));
    }
    if (ms[1].date) tiles.push(tile("Compleet op", fmt(ms[1].date), `met ${nm(ms[1].code)}`, ms[1].code));
    $("prov-facts").innerHTML = `<h2>Weetjes</h2>${order.length ? `<div class="ftiles">${tiles.join("")}</div>` : `<p class="sub">${Wd.none}</p>`}`;

    // nog te gaan
    const allFirsts = firsts;
    const seenCenters = [...allFirsts.keys()].map((c) => [c, centerOf(D.features[c])]).filter((x) => x[1]);
    const todo = codes.filter((c) => !firsts.has(c)).map((c) => {
      const cc = centerOf(D.features[c]);
      let best = null;
      if (cc) for (const [v, vc] of seenCenters) { const d = distKm(cc, vc); if (!best || d < best.d) best = { d, v }; }
      return { c, best };
    }).sort((a, b) => (a.best ? a.best.d : 1e9) - (b.best ? b.best.d : 1e9));
    const shown = P.showAll ? todo : todo.slice(0, 8);
    $("prov-todo").innerHTML = `<div><h2>Nog te gaan${todo.length ? ` (${todo.length})` : ""}</h2>${todo.length ? `<p class="sub">Dichtstbij eerst: afstand tot de dichtstbijzijnde gemeente waar je al was.</p>` : ""}</div>
      ${todo.length ? `<ul class="todo-l">${shown.map((t) => `<li><button type="button" class="todo-i" data-pcode="${esc(t.c)}"><span class="tn">${nm(t.c)}</span><span class="td">${t.best ? `± ${nf.format(Math.round(t.best.d))} km van ${nm(t.best.v)}` : ""}</span></button></li>`).join("")}</ul>
        ${todo.length > 8 ? `<button type="button" class="link" id="prov-more">${P.showAll ? "Toon minder" : `Toon alle ${todo.length}`}</button>` : ""}
        <div class="actions"><button type="button" class="btn primary" data-action="routecheck">Route controleren</button></div>`
      : `<p class="prov-done">Alle ${total} gemeenten ${Wd.verb}. Chapeau!</p>`}`;

    // tijdlijn
    $("prov-time").innerHTML = timeline(D, order, total, ms, range, Wd);
  }

  function gemInfo(D, code, firsts, acts) {
    if (!code || !D.features[code]) return "";
    const f = D.features[code];
    const a = firsts.get(code);
    const n = acts.filter((x) => x.g.includes(code)).length;
    return `<div class="prov-gem"><div><b>${esc(f.naam)}</b><span>${a ? `Eerste keer ${fmt(a.date)} · ${nf.format(n)}× in deze ronde` : "Nog niet bezocht in deze ronde"}</span></div>
      <button type="button" class="btn" data-gem-map="${esc(code)}">Op de kaart</button></div>`;
  }

  function timeline(D, order, total, ms, range, Wd) {
    if (!order.length) return `<h2>Tijdlijn</h2><p class="sub">${Wd.none}</p>`;
    const t0 = new Date((range.start || order[0][1].date) + "T12:00:00").getTime();
    const t1 = new Date(((range.end && range.end < today()) ? range.end : today()) + "T12:00:00").getTime();
    const span = Math.max(1, t1 - t0);
    const W = 760, H = 180, L = 34, R = 12, T = 12, B = 26;
    const x = (d) => L + ((new Date(d + "T12:00:00").getTime() - t0) / span) * (W - L - R);
    const y = (k) => T + (1 - k / total) * (H - T - B);
    let d = `M${L} ${y(0).toFixed(1)}`;
    order.forEach(([, a], i) => { const xx = x(a.date).toFixed(1); d += `H${xx}V${y(i + 1).toFixed(1)}`; });
    d += `H${W - R}`;
    const area = `${d}V${y(0)}H${L}Z`;
    const y0 = new Date(t0).getFullYear(), y1 = new Date(t1).getFullYear();
    const stepY = Math.max(1, Math.ceil((y1 - y0 + 1) / 8));
    const ticks = [];
    for (let yy = y0 + 1; yy <= y1; yy += stepY) ticks.push(`<g><line x1="${x(`${yy}-01-01`).toFixed(1)}" x2="${x(`${yy}-01-01`).toFixed(1)}" y1="${T}" y2="${H - B}" class="tg"/><text x="${x(`${yy}-01-01`).toFixed(1)}" y="${H - 8}" class="tt" text-anchor="middle">${yy}</text></g>`);
    const marks = ms.filter((m) => m.date).map((m) => `<g><line x1="${L}" x2="${W - R}" y1="${y(m.n).toFixed(1)}" y2="${y(m.n).toFixed(1)}" class="tm"/><circle cx="${x(m.date).toFixed(1)}" cy="${y(m.n).toFixed(1)}" r="5" class="tc"/></g>`).join("");
    const list = [...ms].map((m) => `<li><span class="tl-k">${m.pct === 100 ? "Compleet" : "Halverwege"}</span>${m.date ? `${fmt(m.date)}${m.code ? ` · ${esc(D.features[m.code].naam)}` : ""}` : `nog ${m.n - order.length > 0 ? m.n - order.length : 0} te gaan`}</li>`).join("");
    return `<div><h2>Zo veroverde je deze provincie</h2><p class="sub">Aantal ${Wd.verb === "bezocht" ? "bezochte" : Wd.verb + "e"} gemeenten door de tijd</p></div>
      <svg class="prov-tl" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tijdlijn van ${order.length} gemeenten">
        <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="tg"/><line x1="${L}" x2="${W - R}" y1="${y(total)}" y2="${y(total)}" class="tg dash"/>
        <text x="${L - 6}" y="${y(total) + 4}" class="tt" text-anchor="end">${total}</text><text x="${L - 6}" y="${y(0) + 4}" class="tt" text-anchor="end">0</text>
        ${ticks.join("")}<path d="${area}" class="ta"/><path d="${d}" class="tl"/>${marks}
      </svg>
      <ul class="tl-list">${list}</ul>`;
  }

  // ------------------------------------------------------------ openen en bediening
  function open(prov) {
    const cur = window.FG.current ? window.FG.current() : "home";
    if (cur !== "prov") P.back = cur || "home";
    if (prov !== P.prov) { P.sel = ""; P.showAll = false; }
    P.prov = prov;
    window.FG.setView("prov");
  }
  function show() { render(); }

  document.addEventListener("click", (e) => {
    const p = e.target.closest("[data-prov]");
    if (p) { e.preventDefault(); open(p.dataset.prov); return; }
    if (!e.target.closest("#view-prov")) return;
    const pm = e.target.closest("[data-pm]");
    if (pm) { window.FG.setSport(pm.dataset.pm); render(); return; }
    const go = e.target.closest("[data-go]");
    if (go) { P.prov = go.dataset.go; P.sel = ""; P.showAll = false; render(); return; }
    const gm = e.target.closest("[data-gem-map]");
    if (gm) { window.FG.focusGemeente(gm.dataset.gemMap); return; }
    const pc = e.target.closest("[data-pcode]");
    if (pc) {
      P.sel = P.sel === pc.dataset.pcode ? "" : pc.dataset.pcode;
      render();
      if (!pc.closest("#prov-map")) $("prov-map").scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (e.target.closest("#prov-more")) { P.showAll = !P.showAll; render(); }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-prov][role=button]")) { e.preventDefault(); open(e.target.dataset.prov); }
  });
  $("prov-pick").addEventListener("change", (e) => { P.prov = e.target.value; P.sel = ""; P.showAll = false; render(); });
  $("prov-back").addEventListener("click", () => window.FG.setView(P.back || "home"));

  window.FGProv = { open, show, render, checkParties };
})();
