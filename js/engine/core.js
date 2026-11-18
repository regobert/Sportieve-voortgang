/* Fietsgemeenten - rekenkern die zowel in de pagina als in de worker draait.
 *
 * Bevat: polylines, vereenvoudigen, afstanden, gemeenten bepalen (FG.Geo),
 * ritsoort bepalen, datums, CSV, zip lezen, GPX/TCX/FIT lezen.
 * Er gaat niets over het internet: alles gebeurt in je eigen browser.
 */
(function (root) {
  "use strict";
  const FG = root.FGCore = {};

  // ------------------------------------------------------------- polyline
  FG.decodePolyline = function (s) {
    const out = [];
    let i = 0, lat = 0, lon = 0;
    const n = (s || "").length;
    while (i < n) {
      for (let k = 0; k < 2; k++) {
        let shift = 0, result = 0, b;
        do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const d = result & 1 ? ~(result >> 1) : result >> 1;
        if (k === 0) lat += d; else lon += d;
      }
      out.push([lat / 1e5, lon / 1e5]);
    }
    return out;
  };

  FG.encodePolyline = function (pts) {
    let out = "", pl = 0, po = 0;
    const enc = (v) => {
      v = v < 0 ? ~(v << 1) : v << 1;
      let s = "";
      while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
      return s + String.fromCharCode(v + 63);
    };
    for (const [lat, lon] of pts) {
      const il = Math.round(lat * 1e5), io = Math.round(lon * 1e5);
      out += enc(il - pl) + enc(io - po);
      pl = il; po = io;
    }
    return out;
  };

  // ------------------------------------------------- vereenvoudigen (DP)
  /** Douglas-Peucker op (lat, lon) met tolerantie in graden (zoals shapely op lon/lat). */
  FG.simplify = function (pts, tol = 0.00004) {
    const n = pts.length;
    if (n < 3) return pts.slice();
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    const t2 = tol * tol;
    while (stack.length) {
      const [a, b] = stack.pop();
      const ax = pts[a][1], ay = pts[a][0], bx = pts[b][1], by = pts[b][0];
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let best = -1, bi = -1;
      for (let i = a + 1; i < b; i++) {
        const px = pts[i][1], py = pts[i][0];
        let d;
        if (L === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
        else {
          let t = ((px - ax) * dx + (py - ay) * dy) / L;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
        }
        if (d > best) { best = d; bi = i; }
      }
      if (best > t2) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
    return out;
  };

  /** Lengte in meter (haversine) */
  FG.lengthM = function (pts) {
    let t = 0;
    for (let i = 1; i < pts.length; i++) t += FG.distM(pts[i - 1], pts[i]);
    return t;
  };
  FG.distM = function (a, b) {
    const r = Math.PI / 180;
    const p1 = a[0] * r, p2 = b[0] * r, dp = p2 - p1, dl = (b[1] - a[1]) * r;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  // ------------------------------------------------------------- gemeenten
  /**
   * Officiële gemeentegrenzen (Kadaster, incl. water, ca. 2 m nauwkeurig).
   * Elke aanraking telt: we kijken in welke gemeente de route begint en welke
   * grenzen hij daarna kruist of raakt. Dat is precies en snel.
   */
  class Geo {
    constructor(json) {
      const G = json.gemeenten;
      this.codes = G.map((g) => g.code);
      this.names = G.map((g) => g.naam);
      this.rings = []; // per gemeente: lijst van Float64Array [x0,y0,x1,y1,...] (x = lon)
      this.bbox = new Float64Array(G.length * 4);
      let edges = 0;
      G.forEach((g, gi) => {
        let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
        const rs = g.rings.map((enc) => {
          const p = FG.decodePolyline(enc);
          const a = new Float64Array(p.length * 2);
          p.forEach(([la, lo], i) => {
            a[i * 2] = lo; a[i * 2 + 1] = la;
            if (lo < x0) x0 = lo; if (lo > x1) x1 = lo; if (la < y0) y0 = la; if (la > y1) y1 = la;
          });
          edges += p.length - 1;
          return a;
        });
        this.rings.push(rs);
        this.bbox.set([x0, y0, x1, y1], gi * 4);
      });
      // Raster met grenslijnstukken
      this.gx0 = 3.0; this.gy0 = 50.5; this.cell = 0.01;
      this.nx = Math.ceil((7.6 - this.gx0) / this.cell); this.ny = Math.ceil((53.8 - this.gy0) / this.cell);
      const E = this.E = new Float64Array(edges * 4);
      const EG = this.EG = new Int32Array(edges);
      let k = 0;
      this.rings.forEach((rs, gi) => rs.forEach((a) => {
        for (let i = 0; i + 3 < a.length; i += 2) {
          E[k * 4] = a[i]; E[k * 4 + 1] = a[i + 1]; E[k * 4 + 2] = a[i + 2]; E[k * 4 + 3] = a[i + 3];
          EG[k] = gi; k++;
        }
      }));
      const ncell = this.nx * this.ny;
      const count = new Int32Array(ncell + 1);
      const each = (e, fn) => {
        const [cx0, cy0, cx1, cy1] = this._cells(Math.min(E[e * 4], E[e * 4 + 2]), Math.min(E[e * 4 + 1], E[e * 4 + 3]),
          Math.max(E[e * 4], E[e * 4 + 2]), Math.max(E[e * 4 + 1], E[e * 4 + 3]));
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) fn(cy * this.nx + cx);
      };
      for (let e = 0; e < edges; e++) each(e, (c) => { count[c + 1]++; });
      for (let c = 0; c < ncell; c++) count[c + 1] += count[c];
      const items = new Int32Array(count[ncell]);
      const fill = count.slice(0, ncell);
      for (let e = 0; e < edges; e++) each(e, (c) => { items[fill[c]++] = e; });
      this.cellStart = count; this.cellItems = items;
      this.stamp = new Int32Array(edges); this.stampN = 0;
    }

    _cells(x0, y0, x1, y1) {
      const c = (v, o, n) => Math.max(0, Math.min(n - 1, Math.floor((v - o) / this.cell)));
      return [c(x0, this.gx0, this.nx), c(y0, this.gy0, this.ny), c(x1, this.gx0, this.nx), c(y1, this.gy0, this.ny)];
    }

    _inBox(gi, x, y) {
      const b = this.bbox;
      return x >= b[gi * 4] && x <= b[gi * 4 + 2] && y >= b[gi * 4 + 1] && y <= b[gi * 4 + 3];
    }

    /** Ligt (x=lon, y=lat) in gemeente gi? (even-oneven over alle ringen) */
    _inside(gi, x, y) {
      if (!this._inBox(gi, x, y)) return false;
      let c = false;
      for (const a of this.rings[gi]) {
        for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) {
          const xi = a[i], yi = a[i + 1], xj = a[j], yj = a[j + 1];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
        }
      }
      return c;
    }

    /** Index van de gemeente waarin een punt ligt (of -1); 'hint' wordt eerst geprobeerd. */
    locate(x, y, hint = -1) {
      if (hint >= 0 && this._inside(hint, x, y)) return hint;
      for (let gi = 0; gi < this.codes.length; gi++) if (gi !== hint && this._inside(gi, x, y)) return gi;
      return -1;
    }

    /** Alle grenskruisingen van lijnstuk a-b: [{gi, t}] (t = plek op het lijnstuk, 0..1) */
    _cross(ax, ay, bx, by, out) {
      if (Math.max(ax, bx) < this.gx0 || Math.min(ax, bx) > this.gx0 + this.nx * this.cell ||
          Math.max(ay, by) < this.gy0 || Math.min(ay, by) > this.gy0 + this.ny * this.cell) return;
      const [cx0, cy0, cx1, cy1] = this._cells(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
      const st = ++this.stampN;
      const E = this.E;
      const rx = bx - ax, ry = by - ay;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = cy * this.nx + cx;
          for (let p = this.cellStart[c]; p < this.cellStart[c + 1]; p++) {
            const e = this.cellItems[p];
            if (this.stamp[e] === st) continue;
            this.stamp[e] = st;
            const qx = E[e * 4], qy = E[e * 4 + 1], sx = E[e * 4 + 2] - qx, sy = E[e * 4 + 3] - qy;
            const den = rx * sy - ry * sx;
            const wx = qx - ax, wy = qy - ay;
            if (den === 0) {
              // evenwijdig: raken ze elkaar (op één lijn en overlappend)?
              if (wx * ry - wy * rx !== 0) continue;
              const rr = rx * rx + ry * ry;
              if (rr === 0) { if (wx === 0 && wy === 0) out.push({ gi: this.EG[e], t: 0 }); continue; }
              const t0 = (wx * rx + wy * ry) / rr, t1 = t0 + (sx * rx + sy * ry) / rr;
              if (Math.max(t0, t1) >= 0 && Math.min(t0, t1) <= 1) out.push({ gi: this.EG[e], t: Math.max(0, Math.min(t0, t1)) });
              continue;
            }
            const t = (wx * sy - wy * sx) / den, u = (wx * ry - wy * rx) / den;
            const eps = 1e-12;
            if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) out.push({ gi: this.EG[e], t });
          }
        }
      }
    }

    /** Codes van alle gemeenten die de route (lijst [lat, lon]) raakt */
    visited(pts) {
      const set = new Set();
      if (!pts || !pts.length) return set;
      const g0 = this.locate(pts[0][1], pts[0][0]);
      if (g0 >= 0) set.add(this.codes[g0]);
      const hits = [];
      for (let i = 1; i < pts.length; i++) {
        hits.length = 0;
        this._cross(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0], hits);
        for (const h of hits) set.add(this.codes[h.gi]);
      }
      return set;
    }

    /** Gemeenten in de volgorde van de route, met per gemeente het aantal meter erin */
    routeVisits(pts) {
      const order = [], seen = new Map();
      const add = (gi) => { if (gi >= 0 && !seen.has(gi)) { seen.set(gi, 0); order.push(gi); } };
      if (!pts.length) return [];
      let cur = this.locate(pts[0][1], pts[0][0]);
      add(cur);
      const hits = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        hits.length = 0;
        this._cross(a[1], a[0], b[1], b[0], hits);
        hits.sort((p, q) => p.t - q.t);
        for (const h of hits) add(h.gi);
        // Meters toekennen: het lijnstuk in stukken knippen bij elke grenskruising;
        // elk stuk ligt helemaal in één gemeente (die van zijn midden).
        const len = FG.distM(a, b);
        const ts = [0, ...hits.map((h) => Math.min(1, Math.max(0, h.t))), 1];
        for (let k = 1; k < ts.length; k++) {
          const t0 = ts[k - 1], t1 = ts[k];
          if (t1 - t0 <= 0) continue;
          const tm = (t0 + t1) / 2;
          const mx = a[1] + (b[1] - a[1]) * tm, my = a[0] + (b[0] - a[0]) * tm;
          cur = cur >= 0 && this._inside(cur, mx, my) ? cur : this.locate(mx, my, cur);
          if (cur >= 0) { add(cur); seen.set(cur, seen.get(cur) + len * (t1 - t0)); }
        }
      }
      return order.map((gi) => ({ code: this.codes[gi], m: Math.round(seen.get(gi)) }));
    }
  }
  FG.Geo = Geo;

  // --------------------------------------------------------------- ritsoort
  FG.FOOT_TYPES = { Walk: "Wandeling", Hike: "Hike", Run: "Hardlopen", TrailRun: "Trailrun" };
  FG.ALL_BIKE_TYPES = {
    Ride: "Racefiets / wegrit", GravelRide: "Gravel", MountainBikeRide: "Mountainbike", EBikeRide: "E-bike",
    EMountainBikeRide: "E-mountainbike", Velomobile: "Velomobiel", Handcycle: "Handbike",
  };
  FG.DEFAULT_SPORT_TYPES = ["Ride", "GravelRide", "MountainBikeRide"];
  const FIT_SPORT = {
    mountain: "MountainBikeRide", downhill: "MountainBikeRide", gravel_cycling: "GravelRide", cyclocross: "GravelRide",
    e_bike_mountain: "EMountainBikeRide", e_bike_fitness: "EBikeRide", e_biking: "EBikeRide",
    virtual_activity: "VirtualRide", indoor_cycling: "VirtualRide", spin: "VirtualRide", hand_cycling: "Handcycle",
  };

  FG.nameType = function (name) {
    const n = (name || "").toLowerCase();
    if (/(^|[^\p{L}\p{N}_])e[- ]?mtb($|[^\p{L}\p{N}_])/u.test(n)) return "EMountainBikeRide";
    if (/(^|[^\p{L}\p{N}_])(mtb|atb|mountainbike\p{L}*|mountain bike|singletrack\p{L}*)($|[^\p{L}\p{N}_])/u.test(n)) return "MountainBikeRide";
    if (/(^|[^\p{L}\p{N}_])(gravel\p{L}*|cx|veldrit\p{L}*|cyclocross)($|[^\p{L}\p{N}_])/u.test(n)) return "GravelRide";
    return null;
  };

  /** Volgorde: instelling per fiets > fietscomputer (FIT) > ritnaam > archief */
  FG.classify = function (csvType, fileSport, name, gear, bikes) {
    if (csvType === "VirtualRide" || FG.FOOT_TYPES[csvType]) return csvType;
    const choice = (bikes || {})[gear || ""];
    if (choice && choice !== "auto") return choice;
    if (fileSport && FIT_SPORT[fileSport]) return FIT_SPORT[fileSport];
    return FG.nameType(name) || csvType || "Ride";
  };

  /** Ritsoort uit activities.csv (Engels of Nederlands) -> Strava sport_type */
  FG.mapType = function (raw) {
    const s = (raw || "").toLowerCase().replace(/[\s\-_]/g, "");
    if (!s) return null;
    if (s.includes("virtu")) return /run|loop|walk|wandel/.test(s) ? null : "VirtualRide";
    if (s.includes("trail") && (s.includes("run") || s.includes("loop"))) return "TrailRun";
    if (["run", "running", "hardlopen", "hardloopsessie", "hardloop", "loop", "lopen"].includes(s) || s.startsWith("hardloop")) return "Run";
    if (s.includes("hike") || s.includes("hiking") || s.includes("wandeltocht") || s.includes("bergwandel")) return "Hike";
    if (["walk", "walking", "wandeling", "wandelen"].includes(s) || s.startsWith("wandel")) return "Walk";
    if (s.includes("emountain") || s.includes("emtb")) return "EMountainBikeRide";
    if (s.includes("ebike") || s.startsWith("elektrische")) return "EBikeRide";
    if (s.includes("gravel")) return "GravelRide";
    if (s.includes("mountain") || s.includes("mtb")) return "MountainBikeRide";
    if (s.includes("velomobi")) return "Velomobile";
    if (s.includes("handcycle") || s.includes("handbike")) return "Handcycle";
    if (["ride", "rit", "fietsrit", "fietstocht", "fietsen", "cycling", "biking"].includes(s) || s.endsWith("ride") || s.endsWith("rit")) return "Ride";
    return null;
  };

  // ------------------------------------------------------------- tijd
  const AMS = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  /** Date -> "YYYY-MM-DDTHH:MM:SSZ" in Nederlandse tijd (zoals de pc-versie het opsloeg) */
  FG.localISO = function (d) {
    const p = {};
    for (const x of AMS.formatToParts(d)) p[x.type] = x.value;
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`;
  };
  FG.utcISO = (d) => d.toISOString().slice(0, 19) + "Z";

  const MONTHS = { jan: 1, feb: 2, mar: 3, mrt: 3, maa: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12 };
  /** Datum uit activities.csv (Engels of Nederlands, tijd in UTC) -> Date of null */
  FG.parseCsvDate = function (text) {
    let t = (text || "").trim().toLowerCase();
    if (!t) return null;
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    let hh = 0, mm = 0, ss = 0;
    const tm = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/);
    if (tm) {
      hh = +tm[1]; mm = +tm[2]; ss = +(tm[3] || 0);
      const ap = (tm[4] || "").replace(/\./g, "");
      if (ap === "pm" && hh < 12) hh += 12; else if (ap === "am" && hh === 12) hh = 0;
      t = t.slice(0, tm.index);
    }
    let mon = null;
    for (const w of t.match(/[a-z]+/g) || []) if (MONTHS[w.slice(0, 3)]) { mon = MONTHS[w.slice(0, 3)]; break; }
    const nums = (t.match(/\d+/g) || []).map(Number);
    const year = nums.find((n) => n > 1900), day = nums.find((n) => n >= 1 && n <= 31);
    if (!(mon && year && day)) return null;
    const d = new Date(Date.UTC(year, mon - 1, day, hh, mm, ss));
    return d.getUTCDate() === day ? d : null;
  };

  function num(text) {
    let t = (text || "").trim().replace(/ | /g, "");
    if (!t) return null;
    if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(".") > t.lastIndexOf(",") ? t.replace(/,/g, "") : t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(",", ".");
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  }
  /** Officiële afstand van Strava in meter. Laatste kolom is in meter, de eerste in km. */
  FG.parseCsvDistance = function (row, idxs) {
    const vals = idxs.map((i) => (i < row.length ? num(row[i]) : null));
    if (vals.length >= 2 && vals[vals.length - 1] != null && vals[vals.length - 1] > 0) {
      const first = vals[0];
      if (first == null || vals[vals.length - 1] > first * 50) return vals[vals.length - 1];
    }
    if (vals.length && vals[0] != null && vals[0] > 0) return vals[0] < 2000 ? vals[0] * 1000 : vals[0];
    return null;
  };

  // ------------------------------------------------------------------ CSV
  FG.parseCSV = function (text) {
    const rows = [];
    let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); rows.push(row); row = []; f = "";
      } else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  };

  /** Tijdsduur uit de csv: seconden ("3600" of "3600.0") of uu:mm:ss */
  FG.parseDuration = function (r, i) {
    if (i < 0 || i >= r.length) return 0;
    const v = String(r[i]).trim();
    if (!v) return 0;
    if (v.includes(":")) return v.split(":").reduce((s, x) => s * 60 + (parseFloat(x) || 0), 0);
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  FG.csvColumns = function (header) {
    const h = header.map((c) => c.trim().toLowerCase());
    const find = (keys, def) => { const i = h.findIndex((c) => keys.some((k) => c.includes(k))); return i >= 0 ? i : def; };
    return {
      id: find(["activity id", "activiteits-id", "activiteit-id", "activiteitsid"], 0),
      name: find(["activity name", "naam", "activiteitsnaam"], 2),
      type: find(["activity type", "activiteitstype", "type activiteit", "soort"], 3),
      file: find(["filename", "bestandsnaam", "bestand"], 12),
      date: find(["activity date", "datum"], 1),
      gear: find(["activity gear", "uitrusting", "gear"], 11),
      elapsed: find(["elapsed time", "verstreken tijd", "totale tijd"], -1),
      moving: find(["moving time", "bewegingstijd", "beweegtijd", "tijd in beweging"], -1),
      dist: h.map((c, i) => (c === "distance" || c === "afstand" || c.startsWith("distance") || c.startsWith("afstand") ? i : -1)).filter((i) => i >= 0),
    };
  };

  // ------------------------------------------------------------------ zip
  /** Zip lezen zonder het hele bestand in het geheugen te laden (werkt ook voor archieven > 4 GB). */
  FG.Zip = class Zip {
    constructor(file) { this.file = file; }
    async _bytes(start, end) { return new Uint8Array(await this.file.slice(start, end).arrayBuffer()); }
    async open() {
      const size = this.file.size;
      const tail = await this._bytes(Math.max(0, size - 65557), size);
      const dv = new DataView(tail.buffer);
      let p = -1;
      for (let i = tail.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { p = i; break; }
      if (p < 0) throw new Error("ZIP");
      let count = dv.getUint16(p + 10, true), cdSize = dv.getUint32(p + 12, true), cdOff = dv.getUint32(p + 16, true);
      if (cdOff === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) {
        // zip64
        const lp = p - 20;
        if (lp >= 0 && dv.getUint32(lp, true) === 0x07064b50) {
          const off = Number(dv.getBigUint64(lp + 8, true));
          const rec = await this._bytes(off, off + 56);
          const rv = new DataView(rec.buffer);
          count = Number(rv.getBigUint64(32, true)); cdSize = Number(rv.getBigUint64(40, true)); cdOff = Number(rv.getBigUint64(48, true));
        }
      }
      const cd = await this._bytes(cdOff, cdOff + cdSize);
      const v = new DataView(cd.buffer);
      const dec = new TextDecoder();
      this.entries = new Map();
      let q = 0;
      for (let n = 0; n < count && q + 46 <= cd.length; n++) {
        if (v.getUint32(q, true) !== 0x02014b50) break;
        const method = v.getUint16(q + 10, true);
        let csize = v.getUint32(q + 20, true), usize = v.getUint32(q + 24, true);
        const nl = v.getUint16(q + 28, true), el = v.getUint16(q + 30, true), cl = v.getUint16(q + 32, true);
        let off = v.getUint32(q + 42, true);
        const name = dec.decode(cd.subarray(q + 46, q + 46 + nl));
        // zip64-velden in 'extra'
        let e = q + 46 + nl;
        const eend = e + el;
        while (e + 4 <= eend) {
          const id = v.getUint16(e, true), len = v.getUint16(e + 2, true);
          if (id === 0x0001) {
            let r = e + 4;
            if (usize === 0xffffffff) { usize = Number(v.getBigUint64(r, true)); r += 8; }
            if (csize === 0xffffffff) { csize = Number(v.getBigUint64(r, true)); r += 8; }
            if (off === 0xffffffff) { off = Number(v.getBigUint64(r, true)); }
          }
          e += 4 + len;
        }
        // tijdstip van het bestand in de zip (DOS-formaat): zo weten we wanneer Strava het archief maakte
        const dt = v.getUint16(q + 12, true), dd = v.getUint16(q + 14, true);
        const mtime = dd ? new Date(((dd >> 9) & 0x7f) + 1980, ((dd >> 5) & 0xf) - 1, dd & 0x1f, dt >> 11, (dt >> 5) & 0x3f, (dt & 0x1f) * 2).getTime() : 0;
        if (!name.endsWith("/")) this.entries.set(name, { name, method, csize, usize, off, mtime });
        q += 46 + nl + el + cl;
      }
      return this;
    }
    names() { return [...this.entries.keys()]; }
    async read(name) {
      const en = this.entries.get(name);
      if (!en) return null;
      const h = await this._bytes(en.off, en.off + 30);
      const hv = new DataView(h.buffer);
      const start = en.off + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
      const data = await this._bytes(start, start + en.csize);
      if (en.method === 0) return data;
      if (en.method === 8) return root.fflate.inflateSync(data, en.usize ? { out: new Uint8Array(en.usize) } : undefined);
      throw new Error(`Onbekende inpakmethode ${en.method}`);
    }
  };

  // -------------------------------------------------------- GPS-bestanden
  const TXT = new TextDecoder("utf-8");
  const attr = (s, n) => { const m = s.match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']+)`)); return m ? parseFloat(m[1]) : NaN; };
  function parseTime(s) { const d = new Date((s || "").trim()); return isNaN(d) ? null : d; }

  /** GPX: track- en routepunten, naam en eerste tijd */
  FG.parseGPX = function (bytes) {
    const t = typeof bytes === "string" ? bytes : TXT.decode(bytes);
    const trk = [], rte = [];
    let first = null;
    const re = /<(?:[\w-]+:)?(trkpt|rtept)\b([^>]*?)(\/?)>/g;
    let m = null;
    while ((m = re.exec(t))) {
      const la = attr(m[2], "lat"), lo = attr(m[2], "lon");
      if (Number.isFinite(la) && Number.isFinite(lo)) (m[1] === "trkpt" ? trk : rte).push([la, lo]);
      if (!first && m[1] === "trkpt" && !m[3]) {
        const end = t.indexOf("trkpt>", re.lastIndex);
        const inner = t.slice(re.lastIndex, end < 0 ? re.lastIndex + 400 : end);
        const tm = inner.match(/<(?:[\w-]+:)?time>([^<]+)</);
        if (tm) first = parseTime(tm[1]);
      }
    }
    const nm = t.match(/<(?:[\w-]+:)?name>\s*(?:<!\[CDATA\[)?([^<\]]*)/);
    return { pts: trk, rte, time: first, name: nm ? nm[1].trim().slice(0, 120) : "" };
  };

  /** TCX: trackpoints en eerste tijd */
  FG.parseTCX = function (bytes) {
    const t = (typeof bytes === "string" ? bytes : TXT.decode(bytes)).trimStart();
    const pts = [];
    let first = null;
    const re = /<(?:[\w-]+:)?Trackpoint\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Trackpoint>/g;
    let m;
    while ((m = re.exec(t))) {
      const b = m[1];
      if (!first) { const tm = b.match(/<(?:[\w-]+:)?Time>([^<]+)</); if (tm) first = parseTime(tm[1]); }
      const la = b.match(/<(?:[\w-]+:)?LatitudeDegrees>([^<]+)</), lo = b.match(/<(?:[\w-]+:)?LongitudeDegrees>([^<]+)</);
      if (la && lo) { const a = parseFloat(la[1]), o = parseFloat(lo[1]); if (Number.isFinite(a) && Number.isFinite(o)) pts.push([a, o]); }
    }
    return { pts, time: first };
  };

  // FIT: alleen wat we nodig hebben (posities, starttijd, sport/sub_sport)
  const SUB_SPORT = { 0: "generic", 1: "treadmill", 2: "street", 3: "trail", 4: "track", 5: "spin", 6: "indoor_cycling", 7: "road",
    8: "mountain", 9: "downhill", 10: "recumbent", 11: "cyclocross", 12: "hand_cycling", 13: "track_cycling", 27: "indoor_walking",
    28: "e_bike_fitness", 29: "bmx", 30: "casual_walking", 31: "speed_walking", 45: "indoor_running", 46: "gravel_cycling",
    47: "e_bike_mountain", 48: "commuting", 49: "mixed_surface", 58: "virtual_activity", 254: "all",
    14: "indoor_rowing", 15: "elliptical", 16: "stair_climbing", 17: "lap_swimming", 18: "open_water", 19: "flexibility_training",
    20: "strength_training", 21: "warm_up", 22: "match", 23: "exercise", 24: "challenge", 25: "indoor_skiing", 26: "cardio_training",
    32: "bike_to_run_transition", 33: "run_to_bike_transition", 34: "swim_to_bike_transition", 35: "atv", 36: "motocross",
    37: "backcountry", 38: "resort", 39: "rc_drone", 40: "wingsuit", 41: "whitewater", 42: "skate_skiing", 43: "yoga", 44: "pilates",
    50: "navigate", 51: "track_me", 52: "map", 59: "obstacle", 67: "ultra", 68: "indoor_climbing", 69: "bouldering" };
  const SPORT = { 0: "generic", 1: "running", 2: "cycling", 3: "transition", 4: "fitness_equipment", 5: "swimming", 10: "training",
    11: "walking", 16: "mountaineering", 17: "hiking", 21: "e_biking", 254: "all" };
  const FIT_EPOCH = 631065600;

  FG.parseFIT = function (bytes, sportOnly = false) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pts = [];
    let first = null, sport = null, pos = 0;
    const K = 180 / 2 ** 31;
    const pickSport = (sp, sub) => {
      for (const v of [SUB_SPORT[sub], SPORT[sp]]) {
        if (v && !["generic", "road", "cycling", "all"].includes(v)) { if (!sport) sport = v; return; }
      }
    };
    while (pos + 12 <= bytes.length) {
      const hs = bytes[pos];
      if (hs < 12) break;
      const dataSize = dv.getUint32(pos + 4, true);
      if (bytes[pos + 8] !== 0x2e || bytes[pos + 9] !== 0x46) break; // ".F"
      let p = pos + hs;
      const end = Math.min(bytes.length, p + dataSize);
      const defs = {};
      let lastTs = null;
      let stop = false;
      while (p < end && !stop) {
        const h = bytes[p++];
        let local, compressed = false, toff = 0;
        if (h & 0x80) { compressed = true; local = (h >> 5) & 3; toff = h & 0x1f; }
        else local = h & 0x0f;
        if (!compressed && h & 0x40) {
          const le = bytes[p + 1] === 0;
          const glob = le ? dv.getUint16(p + 2, true) : dv.getUint16(p + 2, false);
          const nf = bytes[p + 4];
          p += 5;
          const fields = [];
          for (let i = 0; i < nf; i++) { fields.push([bytes[p], bytes[p + 1], bytes[p + 2]]); p += 3; }
          let devSize = 0;
          if (h & 0x20) { const nd = bytes[p++]; for (let i = 0; i < nd; i++) { devSize += bytes[p + 1]; p += 3; } }
          defs[local] = { le, glob, fields, devSize };
          continue;
        }
        const d = defs[local];
        if (!d) break;
        const vals = {};
        for (const [fnum, size, base] of d.fields) {
          if (p + size > end) { p = end; break; }
          const bt = base & 0x1f;
          let v = null;
          if (size === 1) v = bytes[p];
          else if (size === 2) v = bt === 0x03 ? dv.getInt16(p, d.le) : dv.getUint16(p, d.le);
          else if (size === 4) v = bt === 0x05 ? dv.getInt32(p, d.le) : dv.getUint32(p, d.le);
          vals[fnum] = v;
          p += size;
        }
        p += d.devSize;
        if (vals[253] != null && vals[253] !== 0xffffffff) lastTs = vals[253];
        else if (compressed && lastTs != null) {
          let ts = (lastTs & ~0x1f) + toff;
          if (toff < (lastTs & 0x1f)) ts += 0x20;
          lastTs = ts;
        }
        if (d.glob === 12 || d.glob === 18) {
          const sp = d.glob === 12 ? vals[0] : vals[5], sub = d.glob === 12 ? vals[1] : vals[6];
          pickSport(sp, sub);
          if (sportOnly && d.glob === 18) stop = true;
          if (!first && d.glob === 18 && vals[2] != null && vals[2] !== 0xffffffff) first = new Date((vals[2] + FIT_EPOCH) * 1000);
        } else if (d.glob === 20 && !sportOnly) {
          if (lastTs != null && (!first || pts.length === 0)) { if (!first) first = new Date((lastTs + FIT_EPOCH) * 1000); }
          const la = vals[0], lo = vals[1];
          if (la != null && lo != null && la !== 0x7fffffff && lo !== 0x7fffffff) {
            const a = la * K, o = lo * K;
            if (a >= -90 && a <= 90 && o >= -180 && o <= 180 && !(a === 0 && o === 0)) pts.push([a, o]);
          }
        }
      }
      if (stop) break;
      pos = pos + hs + dataSize + 2; // volgende FIT-bestand in dezelfde reeks
    }
    return { pts, time: first, sport };
  };

  /** Eén GPS-bestand (eventueel .gz) lezen -> {pts, time, sport} */
  FG.readTrack = function (bytes, name, sportOnly = false) {
    let n = name.toLowerCase();
    if (n.endsWith(".gz")) { bytes = root.fflate.gunzipSync(bytes); n = n.slice(0, -3); }
    if (n.endsWith(".fit")) return FG.parseFIT(bytes, sportOnly);
    if (sportOnly) return { pts: [], time: null, sport: null };
    if (n.endsWith(".gpx")) { const g = FG.parseGPX(bytes); return { pts: g.pts, time: g.time, sport: null }; }
    if (n.endsWith(".tcx")) { const g = FG.parseTCX(bytes); return { pts: g.pts, time: g.time, sport: null }; }
    return { pts: [], time: null, sport: null };
  };
})(typeof self !== "undefined" ? self : this);
