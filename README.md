# Fietsgemeenten

Zie op een kaart van Nederland door welke gemeenten je hebt gefietst, met rondes,
jaardoelen, een kilometeroverzicht en een routecheck voor geplande routes.

**De app draait helemaal in je browser.** Je leest je eigen Strava-archief in; dat
bestand wordt niet geüpload. Je ritten en instellingen worden opgeslagen in de
opslag van je browser (IndexedDB) op het apparaat dat je gebruikt. Er is geen
server en geen database met gegevens van gebruikers.

## Gebruiken

1. Vraag op Strava je archief aan: *Mijn account › Account downloaden › Archief aanvragen*.
2. Open de website en kies het zip-bestand (niet uitpakken).
3. Op een ander apparaat verder? Maak bij *Instellingen › Je gegevens* een back-up
   en zet die op het andere apparaat terug.

Wis je je browsergegevens, dan zijn je ritten uit de app weg. Maak dus af en toe een back-up.

## Inhoud van deze repository

| Map / bestand | Wat |
| --- | --- |
| `index.html`, `css/`, `js/` | de app |
| `js/engine/` | rekenkern in de browser: opslag, archief inlezen (zip, GPX, TCX, FIT), gemeenten bepalen |
| `data/grenzen.json` | officiële gemeentegrenzen om mee te tellen (ca. 2 m nauwkeurig) |
| `data/kaart.json` | gemeentevormen voor de kaart (land, met dijken en dammen) |
| `tools/maak_grenzen.py` | maakt de twee databestanden opnieuw (bijv. na een gemeentelijke herindeling) |
| `tools/exporteer_pc.py` | zet gegevens van de oude pc-versie om naar een back-up voor deze website |
| `vendor/` | Leaflet, fflate en lettertypes (met hun eigen licenties) |

## Bronnen en licenties

- Gemeentegrenzen: Kadaster / PDOK – Bestuurlijke Gebieden (CC BY 4.0)
- Kaartvormen: CBS / PDOK – Gebiedsindelingen (CC BY 4.0); dijken en dammen: © OpenStreetMap-bijdragers (ODbL)
- Achtergrondkaart: © OpenStreetMap-bijdragers
- [Leaflet](https://leafletjs.com) (BSD-2), [fflate](https://github.com/101arrowz/fflate) (MIT),
  Inter en Bricolage Grotesque (SIL Open Font License)

Deze app is niet verbonden aan of goedgekeurd door Strava.

© regobert. Alle rechten voorbehouden.
