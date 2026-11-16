/* Fietsgemeenten - detailscherm van één activiteit */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAAND = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const TYPE = { Ride: "Fiets", GravelRide: "Gravel", MountainBikeRide: "Mountainbike", EBikeRide: "E-bike", EMountainBikeRide: "E-MTB",
    VirtualRide: "Indoor", Velomobile: "Velomobiel", Handcycle: "Handbike", Walk: "Wandeling", Hike: "Hike", Run: "Hardlopen", TrailRun: "Trailrun" };
  const ROUTE = "#e6007e";

  const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    down: svg('<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'),
    map: svg('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
    ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  };

  const R = { id: null, back: "rides", map: null, geo: null, route: null, tiles: null, data: null, ctx: null, seq: 0 };

  function decode(str) {
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
  const dur = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`; };
  const tile = (label, value, unit = "", cls = "") => `<div class="rtile ${cls}"><p>${label}</p><p class="rv">${value}${unit ? ` <small>${unit}</small>` : ""}</p></div>`;

  // ------------------------------------------------------------ kaart
  function ensureMap() {
    if (R.map) return;
    R.map = L.map("ride-map", { zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 6, maxZoom: 16, scrollWheelZoom: true });
    R.map.attributionControl.setPrefix(false);
    R.tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers',
      maxZoom: 19, referrerPolicy: "strict-origin-when-cross-origin",
    });
    R.map.createPane("rroute");
    R.map.getPane("rroute").style.zIndex = 450;
    R.map.getPane("rroute").style.pointerEvents = "none";
  }

  function gemStyle(code) {
    const { ctx } = R;
    const C = ctx.colors;
    const touched = R.touched.has(code);
    const isNew = R.fresh.has(code);
    const fill = isNew ? C.visited : touched ? C.soft : C.unvisited;
    const osm = ctx.osm;
    if (!touched) return { color: osm ? "#8a8984" : C.border, weight: osm ? 0.6 : 0.8, opacity: osm ? 0.5 : 1, fillColor: fill, fillOpacity: osm ? 0 : 1 };
    return { color: C.border, weight: 1, opacity: 1, fillColor: fill, fillOpacity: osm ? (isNew ? 0.55 : 0.4) : 0.95 };
  }

  function drawMap() {
    ensureMap();
    const { ctx, data } = R;
    const m = R.map;
    if (ctx.osm) { if (!m.hasLayer(R.tiles)) R.tiles.addTo(m); } else if (m.hasLayer(R.tiles)) m.removeLayer(R.tiles);
    if (R.geo) { m.removeLayer(R.geo); R.geo = null; }
    if (R.route) { m.removeLayer(R.route); R.route = null; }
    if (ctx.gj) {
      R.geo = L.geoJSON(ctx.gj, {
        style: (f) => gemStyle(f.properties.code),
        onEachFeature: (f, layer) => {
          layer.bindTooltip(f.properties.naam, { sticky: true, className: "gtip", direction: "top", offset: [0, -6] });
          layer.on("click", () => window.FG.focusGemeente(f.properties.code));
        },
      }).addTo(m);
    }
    const pts = data.polyline ? decode(data.polyline) : [];
    if (pts.length) {
      R.route = L.layerGroup([
        L.polyline(pts, { pane: "rroute", color: ctx.colors.border, weight: 7, opacity: 0.95, interactive: false }),
        L.polyline(pts, { pane: "rroute", color: ROUTE, weight: 3.5, opacity: 1, interactive: false }),
        L.circleMarker(pts[0], { pane: "rroute", radius: 6, color: ctx.colors.border, weight: 2, fillColor: "#1a7f37", fillOpacity: 1 }),
        L.circleMarker(pts[pts.length - 1], { pane: "rroute", radius: 6, color: ctx.colors.border, weight: 2, fillColor: ctx.colors.ink, fillOpacity: 1 }),
      ]).addTo(m);
    }
    setTimeout(() => {
      m.invalidateSize();
      if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 13 });
      else m.setView([52.2, 5.3], 7);
    }, 30);
    $("ride-legend").innerHTML = pts.length
      ? `<span><i style="background:${ROUTE};height:4px;width:18px"></i>Route</span>
         <span><i></i>Nieuw in ${esc(ctx.round.name)} (${R.fresh.size})</span>
         <span><i style="background:var(--accent-faint)"></i>Al gehad (${R.touched.size - R.fresh.size})</span>
         <span><i style="background:#1a7f37;border-radius:50%"></i>Start</span><span><i style="background:var(--ink);border-radius:50%"></i>Finish</span>`
      : `<span>Van deze activiteit is geen route bekend.</span>`;
  }

  // ------------------------------------------------------------ inhoud
  function render() {
    const { ctx, data } = R;
    const d = new Date(data.date + "T12:00:00");
    const day = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const act = ctx.act;
    const kick = [day.charAt(0).toUpperCase() + day.slice(1) + (data.time ? `, ${data.time}` : ""), TYPE[data.type] || data.type];
    if (act && act.bike) kick.push(act.bike);
    $("ride-kicker").textContent = kick.join(" · ");
    $("ride-title").textContent = data.name || "Activiteit";
    $("ride-actions").innerHTML = `
      ${data.polyline ? `<a class="btn" href="/api/gpx/${data.id}" download>${IC.down}GPX</a>` : ""}
      ${act && data.polyline ? `<button type="button" class="btn" id="ride-onmap">${IC.map}Op de kaart</button>` : ""}
      <a class="btn" href="https://www.strava.com/activities/${data.id}" target="_blank" rel="noopener">${IC.ext}Strava</a>`;

    // tegels
    const t = [tile("Afstand", nf1.format(data.km), "km")];
    t.push(tile("Gemeenten", nf.format(R.touched.size), R.touched.size === 1 ? "gemeente" : "geraakt"));
    if (ctx.inRound) {
      t.push(tile(`Nieuw in ${esc(ctx.round.name)}`, nf.format(R.fresh.size), R.fresh.size === 1 ? "gemeente" : "gemeenten", R.fresh.size ? "acc" : ""));
      t.push(tile(esc(ctx.round.name), `${nf.format(ctx.before)} → ${nf.format(ctx.after)}`, `van ${nf.format(ctx.total)}`));
    } else {
      t.push(tile(esc(ctx.round.name), "–", ctx.counts ? "buiten deze ronde" : "telt niet mee"));
    }
    if (data.moving_time > 0) {
      t.push(tile("Tijd", dur(data.moving_time), data.moving_time >= 3600 ? "uur" : "min"));
      t.push(tile("Gemiddeld", nf1.format(data.km / (data.moving_time / 3600)), "km/u"));
    }
    $("ride-tiles").innerHTML = t.join("");

    // gemeenten in volgorde
    const F = ctx.features;
    const rows = data.visits.filter((v) => F[v.code]).map((v, i) => {
      const isNew = R.fresh.has(v.code);
      const ever = !ctx.everBefore(v.code);
      const badge = isNew ? `<span class="pill acc">${ever ? "Voor het eerst" : "Nieuw"}</span>` : "";
      return `<li><button type="button" class="rg-row" data-code="${esc(v.code)}">
        <span class="rg-dot${isNew ? " new" : ""}">${i + 1}</span>
        <span class="rg-t"><span class="rg-n">${esc(F[v.code].naam)}</span><span class="rg-p">${esc(F[v.code].provincie)} · ${v.m >= 1000 ? nf1.format(v.m / 1000) + " km" : nf.format(v.m) + " m"} erin</span></span>
        ${badge}</button></li>`;
    }).join("");
    $("ride-gems").innerHTML = `<div><h2>Gemeenten onderweg</h2><p class="sub">In de volgorde van de route${ctx.inRound ? `; "nieuw" = voor het eerst in ${esc(ctx.round.name)}` : ""}</p></div>
      ${rows ? `<ol class="rg-list">${rows}</ol>` : `<p class="hero-p">${data.indoor ? "Indoor-rit: telt niet mee voor gemeenten." : "Geen Nederlandse gemeenten op deze route."}</p>`}`;
    renderContrib();
  }

  async function renderContrib() {
    const { ctx, data } = R;
    const el = $("ride-contrib");
    const y = Number(data.date.slice(0, 4)), mo = Number(data.date.slice(5, 7)) - 1;
    const bits = [];
    if (ctx.inRound && R.fresh.size) {
      const names = [...R.fresh].map((c) => ctx.features[c].naam);
      bits.push(`<p class="hero-p">Deze rit leverde <b>${R.fresh.size} nieuwe ${R.fresh.size === 1 ? "gemeente" : "gemeenten"}</b> op voor ${esc(ctx.round.name)}: ${esc(names.join(", "))}.</p>`);
    }
    const pills = [];
    try {
      const M = await window.FGKm.summary("bike");
      const monthKm = (M.rides || []).filter((r) => r.cat === "bike" && r.date.startsWith(data.date.slice(0, 7))).reduce((s, r) => s + r.km, 0);
      if (monthKm > 0) pills.push(`<span class="pill">${MAAND[mo].charAt(0).toUpperCase() + MAAND[mo].slice(1)} ${y}: ${nf.format(monthKm)} km, deze rit ${nf.format((data.km / monthKm) * 100)}%</span>`);
      if (M.G && M.y === y && data.type !== "Walk") pills.push(`<span class="pill acc">${nf1.format((data.km / M.G) * 100)}% van je jaardoel ${y}</span>`);
    } catch { /* geen kilometers beschikbaar */ }
    // provincies die door deze rit compleet werden
    if (ctx.inRound && R.fresh.size) {
      const provs = new Set([...R.fresh].map((c) => ctx.features[c].provincie));
      for (const p of provs) {
        const all = Object.entries(ctx.features).filter(([, f]) => f.provincie === p);
        if (all.every(([c]) => ctx.firsts.has(c)) && all.every(([c]) => ctx.firsts.get(c).date <= data.date)) {
          const last = all.map(([c]) => ctx.firsts.get(c)).sort((a, b) => b.date.localeCompare(a.date))[0];
          if (last && last.id === data.id) pills.push(`<span class="pill acc">${esc(p)} compleet!</span>`);
        }
      }
    }
    if (!bits.length && !pills.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<p class="eyebrow">Wat deze rit opleverde</p>${bits.join("")}${pills.length ? `<div class="pills">${pills.join("")}</div>` : ""}`;
  }

  // ------------------------------------------------------------ openen
  async function open(id) {
    if (!window.FG) return;
    const cur = window.FG.view();
    if (cur && cur !== "ride") R.back = cur;
    window.FG.setView("ride");
    const seq = ++R.seq;
    R.id = id;
    $("ride-title").textContent = "Laden…";
    $("ride-kicker").textContent = "";
    let data;
    try {
      const r = await fetch(`/api/activity/${id}`);
      data = await r.json();
      if (!r.ok) throw new Error(data.error || "Fout");
    } catch (e) {
      if (seq !== R.seq) return;
      $("ride-title").textContent = "Activiteit niet gevonden";
      $("ride-tiles").innerHTML = `<p class="hero-p">${esc(e.message)}</p>`;
      return;
    }
    if (seq !== R.seq) return;
    R.data = data;
    R.ctx = window.FG.rideCtx(id);
    R.touched = new Set(data.visits.map((v) => v.code).filter((c) => R.ctx.features[c]));
    R.fresh = new Set([...R.touched].filter((c) => { const a = R.ctx.firsts.get(c); return a && a.id === id; }));
    render();
    drawMap();
    document.querySelector(".views").scrollTop = 0;
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("ride-back").addEventListener("click", () => window.FG.setView(R.back || "rides"));
    $("view-ride").addEventListener("click", (e) => {
      if (e.target.closest("#ride-onmap")) { window.FG.showRide(R.id); return; }
      const g = e.target.closest("[data-code]");
      if (g) window.FG.focusGemeente(g.dataset.code);
    });
  });
  window.addEventListener("fg-theme", () => {
    if (R.data && !$("view-ride").hidden) { R.ctx = window.FG.rideCtx(R.id); drawMap(); }
  });

  window.FGRide = { open };
})();
