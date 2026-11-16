"""Gemeentegrenzen klaarzetten voor de website.

Invoer (uit de map 'data' van de pc-versie van Fietsgemeenten):
  gemeenten.geojson        officiële grenzen (Kadaster/PDOK, inclusief water) -> tellen
  gemeenten_kaart.geojson  kaartvormen (CBS-land + dijken)                   -> tonen

Uitvoer (in data/ van deze repository):
  grenzen.json  per gemeente de ringen als 'encoded polyline' (ca. 2 m nauwkeurig)
  kaart.json    GeoJSON voor de kaart, coördinaten afgerond op 5 decimalen

Gebruik: python tools/maak_grenzen.py <map-met-invoer>
"""
import json
import os
import sys

import shapely
from shapely.geometry import mapping, shape

TOL = 0.00002  # graden, ongeveer 2 meter


def encode(points):
    """Lijst van (lat, lon) -> Google encoded polyline (5 decimalen)."""
    out, pl, po = [], 0, 0
    for lat, lon in points:
        il, io = round(lat * 1e5), round(lon * 1e5)
        for v in (il - pl, io - po):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        pl, po = il, io
    return "".join(out)


def rnd(obj):
    if isinstance(obj, float):
        return round(obj, 5)
    if isinstance(obj, (list, tuple)):
        return [rnd(x) for x in obj]
    return obj


def main(src):
    full = json.load(open(os.path.join(src, "gemeenten.geojson"), encoding="utf-8"))
    feats = full["features"]
    geoms = [shape(f["geometry"]) for f in feats]
    simple = list(shapely.coverage_simplify(geoms, TOL))
    out = []
    for f, g in zip(feats, simple, strict=True):
        rings = []
        for poly in getattr(g, "geoms", [g]):
            for ring in [poly.exterior, *poly.interiors]:
                rings.append(encode([(y, x) for x, y in ring.coords]))
        p = f["properties"]
        out.append({"code": p["code"], "naam": p["naam"], "provincie": p["provincie"], "rings": rings})
    out.sort(key=lambda r: r["code"])
    meta = {"bron": full.get("source", "Kadaster / PDOK - Bestuurlijke Gebieden (CC BY 4.0)"),
            "gedownload": full.get("downloaded", ""), "nauwkeurigheid_m": 2}
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    with open(os.path.join(here, "grenzen.json"), "w", encoding="utf-8") as fh:
        json.dump({**meta, "gemeenten": out}, fh, ensure_ascii=False, separators=(",", ":"))

    kaart = json.load(open(os.path.join(src, "gemeenten_kaart.geojson"), encoding="utf-8"))
    kf = [{"type": "Feature", "properties": f["properties"], "geometry": rnd(mapping(shape(f["geometry"])))}
          for f in kaart["features"]]
    with open(os.path.join(here, "kaart.json"), "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "bron": "CBS / Kadaster (PDOK), OpenStreetMap-dijken",
                   "features": kf}, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(out)} gemeenten klaargezet")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
