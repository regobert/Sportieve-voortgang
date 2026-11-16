"""Gegevens van de pc-versie van Fietsgemeenten omzetten naar een back-up voor de website.

Gebruik: python tools/exporteer_pc.py <map 'data' van de pc-versie> [uitvoerbestand]
Zet het bestand daarna terug op de website via Instellingen > Je gegevens > Terugzetten.
Wachtwoorden, sleutels en tokens van Strava worden NIET meegenomen.
"""
import gzip
import json
import os
import sqlite3
import sys
import time

KEEP = ("sport_types", "rondes", "goals", "goals_foot", "bikes", "party", "seen")


def main(src, out=None):
    cfg = {}
    p = os.path.join(src, "config.json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as fh:
            cfg = json.load(fh)
    con = sqlite3.connect(os.path.join(src, "fietsgemeenten.db"))
    con.row_factory = sqlite3.Row
    visits = {}
    for r in con.execute("SELECT activity_id, code FROM visits"):
        visits.setdefault(r[0], []).append(r[1])
    cols = {r[1] for r in con.execute("PRAGMA table_info(activities)")}
    acts = []
    for r in con.execute("SELECT * FROM activities ORDER BY start_local, id"):
        a = {k: r[k] for k in ("id", "name", "sport_type", "start_date", "start_local", "distance", "moving_time",
                                "trainer", "polyline", "track", "no_gps")}
        for k in ("source", "gear", "csv_type", "file_sport"):
            a[k] = r[k] if k in cols else None
        a["trainer"] = int(a["trainer"] or 0)
        a["no_gps"] = int(a["no_gps"] or 0)
        a["g"] = sorted(visits.get(r["id"], []))
        acts.append(a)
    meta = {}
    row = con.execute("SELECT value FROM meta WHERE key='last_import'").fetchone()
    if row:
        meta["last_import"] = int(row[0])
    con.close()
    data = {"app": "sportieve-voortgang", "formaat": 1, "gemaakt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "bron": "pc-versie", "instellingen": {k: cfg[k] for k in KEEP if k in cfg}, "meta": meta, "activiteiten": acts}
    out = out or os.path.join(src, "..", f"fietsgemeenten-backup-{time.strftime('%Y-%m-%d')}.json.gz")
    with gzip.open(out, "wt", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(acts)} activiteiten opgeslagen in {os.path.abspath(out)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data", sys.argv[2] if len(sys.argv) > 2 else None)
