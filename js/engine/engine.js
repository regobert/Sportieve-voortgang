/* Fietsgemeenten - de 'server' in je eigen browser.
 *
 * De schermen vragen gegevens op via adressen als /api/data. Op de website is er
 * geen server: dit bestand vangt die verzoeken op en beantwoordt ze met gegevens
 * uit de opslag van je browser (IndexedDB). Er gaat niets naar het internet.
 */
/* global FGCore, fflate */
(function () {
  "use strict";
  const F = FGCore;
  const DB_NAME = "sportieve-voortgang";
  const FOOT = F.FOOT_TYPES;

  const fetchReal = window.fetch.bind(window);
  const E = {
    acts: new Map(),      // id -> activiteit
    cfg: {},              // instellingen
    meta: {},             // last_import e.d.
    imp: { running: false, message: "", done: 0, total: 0, added: 0, skipped: 0, error: null, finished_at: null },
  };
  window.FGEngine = E;

  // ------------------------------------------------------------ IndexedDB
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const rq = indexedDB.open(DB_NAME, 1);
        rq.onupgradeneeded = () => {
          const d = rq.result;
          if (!d.objectStoreNames.contains("activities")) d.createObjectStore("activities", { keyPath: "id" });
          if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
        };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      });
    }
    return dbp;
  }
  async function tx(stores, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(stores, mode);
      const out = fn(t);
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error("Opslaan afgebroken"));
    });
  }
  const reqP = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });

  async function loadAll() {
    const d = await db();
    const t = d.transaction(["activities", "kv"], "readonly");
    const acts = await reqP(t.objectStore("activities").getAll());
    const cfg = await reqP(t.objectStore("kv").get("config"));
    const meta = await reqP(t.objectStore("kv").get("meta"));
    E.acts = new Map(acts.map((a) => [a.id, a]));
    E.cfg = cfg || {};
    E.meta = meta || {};
  }
  function saveActs(list) {
    if (!list.length) return Promise.resolve();
    return tx(["activities"], "readwrite", (t) => { const s = t.objectStore("activities"); for (const a of list) s.put(a); });
  }
  function saveCfg() { return tx(["kv"], "readwrite", (t) => { t.objectStore("kv").put(E.cfg, "config"); t.objectStore("kv").put(E.meta, "meta"); }); }

  E.ready = loadAll().then(() => { reclassify(); }).catch((e) => {
    console.error(e);
    E.storageError = "Je browser staat geen opslag toe (bijvoorbeeld in een privévenster). Je gegevens kunnen niet worden bewaard.";
  });

  // ------------------------------------------------------------ worker
  let worker = null, wseq = 0;
  const pending = new Map();
  function getWorker() {
    if (!worker) {
      worker = new Worker("js/engine/worker.js");
      worker.onmessage = (e) => onWorker(e.data);
    }
    return worker;
  }
  function ask(cmd, data, transfer) {
    const id = ++wseq;
    return new Promise((res, rej) => {
      pending.set(id, { res, rej });
      getWorker().postMessage({ cmd, id, ...data }, transfer || []);
    });
  }
  function onWorker(m) {
    if (m.type === "result") {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error)); else p.res(m.result);
    } else if (m.type === "progress") {
      Object.assign(E.imp, { message: m.message, done: m.done, total: m.total, added: m.added || E.imp.added, skipped: m.skipped || E.imp.skipped });
    } else if (m.type === "batch") {
      applyBatch(m.items);
    } else if (m.type === "done") {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) p.res(m);
    }
  }

  // ------------------------------------------------------------ helpers
  const sportTypes = () => (E.cfg.sport_types && E.cfg.sport_types.length ? E.cfg.sport_types : F.DEFAULT_SPORT_TYPES.slice());
  const sorted = () => [...E.acts.values()].sort((a, b) => (a.start_local || "").localeCompare(b.start_local || "") || a.id - b.id);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  function reclassify() {
    const bikes = E.cfg.bikes || {};
    const changed = [];
    for (const a of E.acts.values()) {
      if (a.source !== "archive" || a.trainer || FOOT[a.sport_type]) continue;
      const t = F.classify(a.csv_type, a.file_sport, a.name, a.gear, bikes);
      if (t !== a.sport_type) { a.sport_type = t; changed.push(a); }
    }
    saveActs(changed).catch(() => {});
    return changed.length;
  }

  /** Rondes als [{van, tot}]; ronde 1 (van leeg = vanaf je eerste rit) staat altijd voorop */
  function cleanRounds(raw) {
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach((r, i) => {
      if (typeof r === "string") r = { van: r, tot: "" };
      if (!r || typeof r !== "object") return;
      let van = DATE.test(String(r.van || "")) ? String(r.van) : "";
      let tot = DATE.test(String(r.tot || "")) ? String(r.tot) : "";
      if (tot && van && tot < van) [van, tot] = [tot, van];
      if (!van && i > 0 && out.length) return;
      out.push({ van, tot });
    });
    if (!out.some((r) => !r.van)) out.unshift({ van: "", tot: "" });
    const first = out.filter((r) => !r.van).slice(0, 1);
    const rest = out.filter((r) => r.van).sort((a, b) => a.van.localeCompare(b.van) || (a.tot || "9999").localeCompare(b.tot || "9999"));
    const seen = new Set(), uniq = [];
    for (const r of [...first, ...rest]) { const k = r.van + "|" + r.tot; if (!seen.has(k)) { seen.add(k); uniq.push(r); } }
    return uniq.slice(0, 50);
  }

  // ------------------------------------------------------------ import
  function applyBatch(items) {
    const changed = [];
    for (const it of items) {
      if (it.op === "update") {
        const a = E.acts.get(it.id);
        if (!a) continue;
        a.gear = it.gear; a.csv_type = it.csv_type; a.file_sport = it.file_sport;
        if (a.source === "archive") { a.name = it.name; if (it.cdist > 0) a.distance = it.cdist; }
        changed.push(a);
      } else {
        const r = it.rec, old = E.acts.get(r.id);
        if (old) {
          if (old.polyline) r.polyline = old.polyline;
          if (old.start_date) r.start_date = old.start_date;
          if (old.start_local) r.start_local = old.start_local;
          if (old.distance > 0) r.distance = old.distance;
          r.name = old.name || r.name;
          r.source = old.source || r.source;
          r.moving_time = old.moving_time || 0;
        }
        E.acts.set(r.id, r);
        changed.push(r);
      }
    }
    saveActs(changed).catch((e) => { E.imp.error = "Opslaan mislukt: " + e.message; });
  }

  E.importArchive = async function (file) {
    if (E.imp.running) return { ok: false, error: "Er wordt al een archief ingelezen." };
    await E.ready;
    Object.assign(E.imp, { running: true, message: "Archief openen…", done: 0, total: 0, added: 0, skipped: 0, error: null, finished_at: null });
    const known = {};
    // Al compleet binnen = met route of zonder GPS. Wandelingen zonder opgeslagen route
    // (uit de pc-versie) worden opnieuw gelezen, zodat ze ook gemeenten krijgen.
    for (const a of E.acts.values()) if (a.track || a.no_gps) known[a.id] = a.file_sport == null ? null : a.file_sport;
    try {
      const res = await ask("import", { file, known, bikes: E.cfg.bikes || {} });
      if (res.error) throw new Error(res.error);
      E.meta.last_import = Math.floor(Date.now() / 1000);
      reclassify();
      await saveCfg();
      let msg = res.stopped ? "Inlezen gestopt." : `Archief ingelezen: ${res.added} activiteiten toegevoegd`;
      if (!res.stopped && res.skipped) msg += `, ${res.skipped} bijgewerkt`;
      E.imp.message = res.stopped ? msg : msg + ".";
      E.persist();
    } catch (e) {
      E.imp.error = e.message || "Inlezen mislukt.";
    } finally {
      E.imp.running = false;
      E.imp.finished_at = Math.floor(Date.now() / 1000);
    }
    return { ok: !E.imp.error };
  };
  E.stopImport = () => { if (worker) worker.postMessage({ cmd: "stop" }); };

  /** Vraag de browser om de gegevens niet zelf op te ruimen bij ruimtegebrek */
  E.persist = async function () {
    try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* niet ondersteund */ }
    return false;
  };

  // ------------------------------------------------------------ back-up
  E.backupBlob = async function () {
    await E.ready;
    const data = {
      app: "sportieve-voortgang", formaat: 1, gemaakt: new Date().toISOString(),
      instellingen: E.cfg, meta: E.meta, activiteiten: sorted(),
    };
    const gz = fflate.gzipSync(fflate.strToU8(JSON.stringify(data)), { level: 6 });
    return new Blob([gz], { type: "application/gzip" });
  };
  E.readBackup = async function (file) {
    let bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = fflate.gunzipSync(bytes);
    let data;
    try { data = JSON.parse(fflate.strFromU8(bytes)); } catch { throw new Error("Dit is geen back-up van Fietsgemeenten."); }
    if (!data || data.app !== "sportieve-voortgang" || !Array.isArray(data.activiteiten)) throw new Error("Dit is geen back-up van Fietsgemeenten.");
    return data;
  };
  E.restoreBackup = async function (data) {
    await tx(["activities", "kv"], "readwrite", (t) => {
      const s = t.objectStore("activities");
      s.clear();
      for (const a of data.activiteiten) if (a && Number.isFinite(a.id)) s.put(a);
      t.objectStore("kv").put(data.instellingen || {}, "config");
      t.objectStore("kv").put(data.meta || {}, "meta");
    });
    await loadAll();
    reclassify();
    E.persist();
  };
  E.wipe = async function () {
    await tx(["activities", "kv"], "readwrite", (t) => { t.objectStore("activities").clear(); t.objectStore("kv").clear(); });
    await loadAll();
  };
  E.stats = () => ({ activities: E.acts.size, last_import: E.meta.last_import || null });

  // ------------------------------------------------------------ GPX
  const xmlEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  const safeName = (t) => (String(t || "").replace(/[^\p{L}\p{N}_\- ]+/gu, "").trim().replace(/\s+/g, " ").slice(0, 60)) || "rit";
  function gpxFor(a) {
    const pts = F.decodePolyline(a.track || a.polyline || "");
    if (!pts.length) return null;
    const name = xmlEsc(a.name || "Rit");
    const seg = pts.map(([la, lo]) => `      <trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"/>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Fietsgemeenten" xmlns="http://www.topografix.com/GPX/1/1">\n` +
      `  <metadata><name>${name}</name>${a.start_date ? `<time>${xmlEsc(a.start_date)}</time>` : ""}<link href="https://www.strava.com/activities/${a.id}"/></metadata>\n` +
      `  <trk><name>${name}</name><type>${xmlEsc(a.sport_type || "")}</type>\n    <trkseg>\n${seg}\n    </trkseg>\n  </trk>\n</gpx>\n`;
  }
  const gpxFile = (a) => `${(a.start_local || "").slice(0, 10)} ${safeName(a.name)}.gpx`.trim();
  E.download = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = filename;
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  // Links naar /api/gpx/<id> in de schermen: hier in de browser maken en downloaden
  document.addEventListener("click", (e) => {
    const link = e.target.closest && e.target.closest('a[href^="/api/gpx/"]');
    if (!link) return;
    e.preventDefault();
    const a = E.acts.get(Number(link.getAttribute("href").split("/").pop()));
    const gpx = a && gpxFor(a);
    if (!gpx) { alert("Van deze rit is geen route bekend."); return; }
    E.download(new Blob([gpx], { type: "application/gpx+xml" }), gpxFile(a));
  }, true);

  // ------------------------------------------------------------ API
  async function readBody(init) {
    const b = init && init.body;
    if (!b) return {};
    if (typeof b === "string") { try { return JSON.parse(b); } catch { return {}; } }
    return b;
  }
  const header = (init, name) => {
    const h = (init && init.headers) || {};
    if (h instanceof Headers) return h.get(name);
    const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
    return k ? h[k] : null;
  };

  const R = {};
  R["GET /api/status"] = () => {
    const types = new Set(sportTypes());
    let rides = 0, noGps = 0;
    for (const a of E.acts.values()) if (!a.trainer && types.has(a.sport_type)) { rides++; if (a.no_gps) noGps++; }
    return json({
      configured: false, connected: false, api_blocked: false, client_id: "", athlete: "",
      web: true, storage_error: E.storageError || null,
      sport_types: [...types], rondes: cleanRounds(E.cfg.rondes || []), seen: E.cfg.seen || [],
      party: E.cfg.party !== false, all_types: Object.entries(F.ALL_BIKE_TYPES),
      rides, processed: rides, no_gps: noGps, last_sync: null, last_import: E.meta.last_import || null,
      sync: { running: false, error: null, message: "", done: 0, total: 0 },
      import: { ...E.imp }, now: Math.floor(Date.now() / 1000),
    });
  };
  R["POST /api/settings"] = (b) => {
    if ("rondes" in b) E.cfg.rondes = cleanRounds(b.rondes);
    if ("party" in b) E.cfg.party = !!b.party;
    if ("sport_types" in b) {
      const t = (b.sport_types || []).filter((x) => F.ALL_BIKE_TYPES[x]);
      E.cfg.sport_types = t.length ? t : F.DEFAULT_SPORT_TYPES.slice();
    }
    return saveCfg().then(() => json({ ok: true }));
  };
  R["GET /api/gemeenten"] = () => fetchReal("data/kaart.json");
  R["GET /api/bikes"] = () => {
    const out = {};
    const map = E.cfg.bikes || {};
    for (const a of E.acts.values()) {
      if (a.source !== "archive" || !a.gear) continue;
      const b = out[a.gear] || (out[a.gear] = { name: a.gear, rides: 0, types: {}, choice: map[a.gear] || "auto" });
      b.rides++;
      b.types[a.sport_type] = (b.types[a.sport_type] || 0) + 1;
    }
    return json(Object.values(out).sort((x, y) => y.rides - x.rides));
  };
  R["POST /api/bikes"] = (b) => {
    const allowed = new Set([...Object.keys(F.ALL_BIKE_TYPES), "auto", "Other"]);
    const m = {};
    for (const [k, v] of Object.entries(b.bikes || {})) if (allowed.has(v) && v !== "auto") m[String(k)] = v;
    E.cfg.bikes = m;
    const changed = reclassify();
    return saveCfg().then(() => json({ ok: true, changed }));
  };
  R["POST /api/route-check"] = async (body, init) => {
    let name = header(init, "X-Filename") || "route.gpx";
    try { name = decodeURIComponent(name); } catch { /* laat zo */ }
    name = name.slice(0, 120);
    const buf = await new Response(body).arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 40 * 1024 * 1024) return json({ error: "Het bestand is leeg of te groot (max. 40 MB)." }, 400);
    let r;
    try { r = await ask("readRoute", { buffer: buf, name }, [buf]); } catch { return json({ error: "Dit bestand kan ik niet lezen. Is het een geldig GPX-, TCX- of FIT-bestand?" }, 400); }
    const pts = r.trk.length ? r.trk : r.rte;
    if (pts.length < 2) return json({ error: "Geen route gevonden in dit bestand." }, 400);
    const km = F.lengthM(pts) / 1000;
    const sparse = !r.trk.length && km / Math.max(1, pts.length) > 0.5;
    const visits = await ask("routeVisits", { pts: F.simplify(pts, 0.00002) });
    return json({
      name: r.title || name.replace(/\.(gz)$/i, "").replace(/\.(gpx|tcx|fit)$/i, ""),
      km: Math.round(km * 10) / 10, visits, polyline: F.encodePolyline(F.simplify(pts, 0.00008)), sparse,
    });
  };
  R["GET /api/activity/:id"] = async (b, init, id) => {
    const a = E.acts.get(id);
    if (!a) return json({ error: "Deze activiteit bestaat niet (meer)." }, 404);
    const pts = F.decodePolyline(a.track || a.polyline || "");
    let visits = [], line = "";
    if (pts.length > 1) {
      visits = await ask("routeVisits", { pts: F.simplify(pts, 0.00002) });
      line = F.encodePolyline(F.simplify(pts, 0.00004));
    }
    return json({
      id: a.id, name: a.name, type: a.sport_type, date: (a.start_local || "").slice(0, 10), time: (a.start_local || "").slice(11, 16),
      km: Math.round((a.distance || 0) / 100) / 10, moving_time: a.moving_time || 0, indoor: !!a.trainer, gear: a.gear || "",
      visits, polyline: line,
    });
  };
  R["GET /api/gpx/:id"] = (b, init, id) => {
    const a = E.acts.get(id), g = a && gpxFor(a);
    if (!g) return json({ error: "Van deze rit is geen route bekend." }, 404);
    return new Response(g, { headers: { "Content-Type": "application/gpx+xml" } });
  };
  R["POST /api/gpx"] = (b) => {
    const ids = (b.ids || []).map(Number).filter(Number.isFinite).slice(0, 5000);
    if (!ids.length) return json({ error: "Geen ritten gekozen." }, 400);
    const files = {}, used = new Set();
    for (const id of ids) {
      const a = E.acts.get(id), g = a && gpxFor(a);
      if (!g) continue;
      let fn = gpxFile(a);
      if (used.has(fn)) fn = fn.slice(0, -4) + ` (${a.id}).gpx`;
      used.add(fn);
      files[fn] = fflate.strToU8(g);
    }
    return new Response(fflate.zipSync(files, { level: 6 }), { headers: { "Content-Type": "application/zip" } });
  };
  R["GET /api/km"] = () => {
    const types = new Set(sportTypes());
    const out = [];
    for (const a of sorted()) {
      const t = a.sport_type;
      if (!a.start_local || !(a.distance > 0)) continue;
      const foot = !!FOOT[t];
      const ok = types.has(t) || t === "VirtualRide" || (foot && !a.trainer && (a.polyline || a.track));
      if (!ok) continue;
      const indoor = !foot && (a.trainer || t === "VirtualRide" || a.no_gps);
      out.push({
        id: a.id, name: a.name, type: t, date: a.start_local.slice(0, 10), km: Math.round((a.distance || 0) / 100) / 10,
        cat: foot ? "foot" : "bike", sub: foot ? (t === "Run" || t === "TrailRun" ? "run" : "walk") : indoor ? "ind" : "out",
        indoor: indoor ? 1 : 0, map: a.g && a.g.length ? 1 : 0,
      });
    }
    return json({ rides: out, goals: E.cfg.goals || {}, goals_foot: E.cfg.goals_foot || {} });
  };
  R["POST /api/seen"] = (b) => {
    const add = (b.add || []).filter((k) => typeof k === "string" || typeof k === "number").map((k) => String(k).slice(0, 80));
    E.cfg.seen = [...new Set([...(E.cfg.seen || []), ...add])].slice(-2000);
    return saveCfg().then(() => json({ ok: true }));
  };
  R["POST /api/goals"] = (b) => {
    const year = String(b.year || "");
    if (!/^\d{4}$/.test(year)) return json({ ok: false, error: "Ongeldig jaar." }, 400);
    const key = b.kind === "foot" ? "goals_foot" : "goals";
    const goals = { ...(E.cfg[key] || {}) };
    const km = Number(b.km) || 0;
    if (km > 0) goals[year] = Math.round(Math.min(km, 200000)); else delete goals[year];
    E.cfg[key] = goals;
    return saveCfg().then(() => json({ ok: true, [key]: goals }));
  };
  R["GET /api/data"] = () => {
    const types = new Set(sportTypes());
    const acts = sorted().filter((a) => !a.trainer && types.has(a.sport_type)).map((a) => ({
      id: a.id, name: a.name, type: a.sport_type, date: (a.start_local || "").slice(0, 10),
      km: Math.round((a.distance || 0) / 100) / 10, bike: a.gear || "", ng: a.no_gps ? 1 : 0, g: a.g || [],
    }));
    return json({ activities: acts });
  };
  R["GET /api/foot"] = () => {
    const acts = sorted().filter((a) => FOOT[a.sport_type] && !a.trainer).map((a) => ({
      id: a.id, name: a.name, type: a.sport_type, date: (a.start_local || "").slice(0, 10),
      km: Math.round((a.distance || 0) / 100) / 10, g: a.g || [], track: a.track ? 1 : 0,
    }));
    return json({ activities: acts });
  };
  R["GET /api/routes"] = () => {
    const types = new Set(sportTypes());
    const out = {};
    for (const a of E.acts.values()) if (!a.trainer && types.has(a.sport_type) && a.polyline && a.g && a.g.length) out[a.id] = a.polyline;
    return json(out);
  };
  R["POST /api/import/stop"] = () => { E.stopImport(); return json({ ok: true }); };
  for (const k of ["POST /api/sync", "POST /api/stop", "POST /api/disconnect"]) R[k] = () => json({ ok: true });

  async function handle(url, init) {
    await E.ready;
    const method = ((init && init.method) || "GET").toUpperCase();
    const path = url.split("?")[0];
    let key = `${method} ${path}`, id = null;
    if (!R[key]) {
      const m = path.match(/^(\/api\/[a-z-]+)\/(\d+)$/);
      if (m) { key = `${method} ${m[1]}/:id`; id = Number(m[2]); }
    }
    const fn = R[key];
    if (!fn) return json({ error: "Onbekend verzoek" }, 404);
    try {
      const body = method === "POST" ? (path === "/api/route-check" ? init.body : await readBody(init)) : {};
      return await fn(body, init, id);
    } catch (e) {
      console.error(e);
      return json({ error: e.message || "Fout" }, 500);
    }
  }

  // Verzoeken naar /api/... opvangen; al het andere gaat gewoon naar het internet
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    if (typeof url === "string" && url.startsWith("/api/")) return handle(url, init);
    return fetchReal(input, init);
  };
})();
