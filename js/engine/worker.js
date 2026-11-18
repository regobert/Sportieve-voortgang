/* Fietsgemeenten - zwaar rekenwerk in de achtergrond: archief inlezen en gemeenten bepalen.
 * Het archief blijft op je eigen computer; deze worker leest het alleen. */
/* global FGCore */
(function () {
"use strict";
self.importScripts("../../vendor/fflate/fflate.min.js" + self.location.search, "core.js" + self.location.search);

const F = FGCore;
let geo = null;
let stopFlag = false;

async function getGeo() {
  if (!geo) {
    const r = await fetch("../../data/grenzen.json");
    if (!r.ok) throw new Error("De gemeentegrenzen konden niet worden geladen.");
    geo = new F.Geo(await r.json());
  }
  return geo;
}

const post = (m) => self.postMessage(m);

// ------------------------------------------------------------------ import
async function importArchive(file, known, bikes) {
  stopFlag = false;
  post({ type: "progress", message: "Archief openen…", done: 0, total: 0 });
  let zip;
  try {
    zip = await new F.Zip(file).open();
  } catch {
    throw new Error("Het bestand is geen geldig zip-bestand. Kies het zip-bestand van Strava zoals je het hebt gedownload.");
  }
  const names = zip.names();
  const csvs = names.filter((n) => n.toLowerCase().endsWith("activities.csv"));
  if (!csvs.length) throw new Error("Dit lijkt geen Strava-archief: activities.csv ontbreekt in de zip.");
  const csvName = csvs.sort((a, b) => a.length - b.length)[0];
  const base = csvName.slice(0, -"activities.csv".length);
  const csvEntry = zip.entries.get(csvName);
  const exported = csvEntry && csvEntry.mtime > 0 ? csvEntry.mtime : (file.lastModified || 0);
  let text = new TextDecoder("utf-8").decode(await zip.read(csvName));
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = F.parseCSV(text).filter((r) => r.length > 1 || (r[0] || "").trim());
  if (rows.length < 2) throw new Error("activities.csv bevat geen ritten.");
  const col = F.csvColumns(rows[0]);
  const members = new Map(names.map((n) => [n.toLowerCase(), n]));

  const todo = [];
  for (const r of rows.slice(1)) {
    if (r.length <= Math.max(col.id, col.type)) continue;
    const st = F.mapType(r[col.type]);
    if (!st) continue;
    const id = parseInt(r[col.id], 10);
    if (!Number.isFinite(id)) continue;
    todo.push({
      id, st,
      name: col.name < r.length ? r[col.name] : "",
      fname: col.file < r.length ? r[col.file].trim() : "",
      gear: col.gear < r.length ? r[col.gear].trim() : "",
      cdist: F.parseCsvDistance(r, col.dist),
      cdate: col.date < r.length ? F.parseCsvDate(r[col.date]) : null,
      elapsed: F.parseDuration(r, col.elapsed),
      moving: F.parseDuration(r, col.moving),
    });
  }
  await getGeo();
  const total = todo.length;
  post({ type: "progress", message: `${total} activiteiten gevonden in het archief…`, done: 0, total });
  let added = 0, skipped = 0, batch = [];
  const flush = () => { if (batch.length) { post({ type: "batch", items: batch }); batch = []; } };

  for (let i = 0; i < todo.length; i++) {
    if (stopFlag) break;
    const t = todo[i];
    const indoor = t.st === "VirtualRide";
    const foot = !!F.FOOT_TYPES[t.st];
    const member = t.fname ? (members.get((base + t.fname).toLowerCase()) || members.get(t.fname.toLowerCase())) : null;

    if (known[t.id] !== undefined) {
      // Al binnen: alleen naam, fiets, ritsoort en afstand bijwerken
      let fsport = known[t.id];
      if (fsport == null) {
        fsport = "";
        if (member && member.toLowerCase().replace(/\.gz$/, "").endsWith(".fit")) {
          try { fsport = F.readTrack(await zip.read(member), member, true).sport || ""; } catch { /* onleesbaar */ }
        }
      }
      batch.push({ op: "update", id: t.id, gear: t.gear, csv_type: t.st, file_sport: fsport, name: t.name, cdist: t.cdist || 0, elapsed: t.elapsed, moving: t.moving });
      skipped++;
    } else {
      let pts = [], t0 = null, fsport = null;
      if (member && !indoor) {
        try {
          const r = F.readTrack(await zip.read(member), member);
          pts = r.pts; t0 = r.time; fsport = r.sport;
        } catch { /* bestand niet leesbaar: rit zonder route */ }
      }
      if (foot && pts.length < 2) {
        skipped++; // wandelen/hardlopen zonder GPS (loopband): telt niet mee
      } else {
        if (!t0 && t.cdate) t0 = t.cdate;
        const track = pts.length ? F.simplify(pts, 0.00004) : [];
        const dist = t.cdist || (pts.length ? F.lengthM(pts) : 0);
        const summary = track.length ? F.encodePolyline(F.simplify(track, 0.0004)) : "";
        const fs = fsport || "";
        const sport = indoor || foot ? t.st : F.classify(t.st, fs, t.name, t.gear, bikes);
        // ook wandelingen en hardlopen krijgen gemeenten (aparte telling op het Overzicht)
        const g = track.length && !indoor ? [...geo.visited(track)] : [];
        batch.push({
          op: "insert",
          rec: {
            id: t.id, name: t.name, sport_type: sport,
            start_date: t0 ? F.utcISO(t0) : "", start_local: t0 ? F.localISO(t0) : "",
            distance: dist, moving_time: t.moving || 0, elapsed_time: t.elapsed || 0, trainer: indoor ? 1 : 0,
            polyline: summary, track: track.length ? F.encodePolyline(track) : null,
            no_gps: track.length ? 0 : 1, source: "archive", gear: t.gear, csv_type: t.st, file_sport: fs, g,
          },
        });
        added++;
      }
    }
    if (batch.length >= 25) flush();
    if (i % 5 === 0 || i === todo.length - 1) post({ type: "progress", message: `Archief inlezen: ${i + 1} van ${total}`, done: i + 1, total, added, skipped });
  }
  flush();
  return { added, skipped, stopped: stopFlag, exported };
}

// ------------------------------------------------------------------ berichten
self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.cmd === "stop") { stopFlag = true; return; }
    if (m.cmd === "import") {
      const res = await importArchive(m.file, m.known || {}, m.bikes || {});
      post({ type: "done", id: m.id, ...res });
      return;
    }
    if (m.cmd === "visits") {
      const g = await getGeo();
      post({ type: "result", id: m.id, result: [...g.visited(m.pts)] });
      return;
    }
    if (m.cmd === "routeVisits") {
      const g = await getGeo();
      post({ type: "result", id: m.id, result: g.routeVisits(m.pts) });
      return;
    }
    if (m.cmd === "readRoute") {
      // Geplande route: GPX/TCX/FIT (eventueel .gz) lezen
      let bytes = new Uint8Array(m.buffer);
      let low = (m.name || "").toLowerCase();
      if (low.endsWith(".gz")) { bytes = self.fflate.gunzipSync(bytes); low = low.slice(0, -3); }
      let trk = [], rte = [], title = "";
      if (low.endsWith(".fit")) trk = F.parseFIT(bytes).pts;
      else if (low.endsWith(".tcx")) trk = F.parseTCX(bytes).pts;
      else { const g = F.parseGPX(bytes); trk = g.pts; rte = g.rte; title = g.name; }
      post({ type: "result", id: m.id, result: { trk, rte, title } });
      return;
    }
  } catch (err) {
    post({ type: m.cmd === "import" ? "done" : "result", id: m.id, error: err.message || String(err) });
  }
};
})();
