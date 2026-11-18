/* Weer: iconen, teksten en kaartjes (gegevens van Open-Meteo, zie engine.js) */
(function () {
  const nf1 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });

  // WMO-weercodes -> soort + omschrijving
  function kind(c) {
    if (c <= 1) return "sun";
    if (c === 2) return "part";
    if (c === 3) return "cloud";
    if (c === 45 || c === 48) return "fog";
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
    if (c >= 95) return "storm";
    if (c >= 51 && c <= 57) return "drizzle";
    return "rain";
  }
  const LABEL = {
    0: "Helder", 1: "Overwegend helder", 2: "Half bewolkt", 3: "Bewolkt", 45: "Mist", 48: "Rijpmist",
    51: "Lichte motregen", 53: "Motregen", 55: "Dichte motregen", 56: "IJzel (motregen)", 57: "IJzel (motregen)",
    61: "Lichte regen", 63: "Regen", 65: "Zware regen", 66: "IJzel", 67: "Zware ijzel",
    71: "Lichte sneeuw", 73: "Sneeuw", 75: "Zware sneeuw", 77: "Sneeuwkorrels",
    80: "Lichte buien", 81: "Buien", 82: "Zware buien", 85: "Sneeuwbuien", 86: "Zware sneeuwbuien",
    95: "Onweer", 96: "Onweer met hagel", 99: "Zwaar onweer met hagel",
  };
  const label = (c) => LABEL[c] || "Onbekend";

  const P = {
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    part: '<path d="M8.5 4.5v1.4M3.8 9.2h1.4M5.2 5.9l1 1M11.8 5.9l-1 1"/><path d="M5.6 11.6a3.2 3.2 0 0 1 5.6-2.9"/><path d="M8 19.5h9.2a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6 1.2A3 3 0 0 0 8 19.5z"/>',
    cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4A3.3 3.3 0 0 0 7 18.5z"/>',
    fog: '<path d="M7 13.5h10.5a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4A3.3 3.3 0 0 0 7 13.5z"/><path d="M4 17h16M6 20.5h12"/>',
    drizzle: '<path d="M7 14.5h10.5a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4A3.3 3.3 0 0 0 7 14.5z"/><path d="M8.5 18v.5M12 19v.5M15.5 18v.5M10.2 21.3v.2M13.8 21.3v.2"/>',
    rain: '<path d="M7 14.5h10.5a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4A3.3 3.3 0 0 0 7 14.5z"/><path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/>',
    snow: '<path d="M7 14.5h10.5a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4A3.3 3.3 0 0 0 7 14.5z"/><path d="M8.5 18.2v.1M12 20.3v.1M15.5 18.2v.1M10 21.8v.1M14 21.8v.1"/>',
    storm: '<path d="M7 14.5h10.5a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4A3.3 3.3 0 0 0 7 14.5z"/><path d="M12.5 15.5l-2 3.2h3l-2 3.3"/>',
  };
  function icon(c, size = 18) {
    const k = kind(c);
    return `<svg class="wx-ico wx-${k}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[k]}</svg>`;
  }
  const DIRS = ["N", "NNO", "NO", "ONO", "O", "OZO", "ZO", "ZZO", "Z", "ZZW", "ZW", "WZW", "W", "WNW", "NW", "NNW"];
  const dir = (deg) => DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  const BFT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  const bft = (kmh) => { let b = 0; while (b < BFT.length && kmh >= BFT[b]) b++; return b; };
  const deg = (t) => `${nf0.format(Math.round(t) || 0)}°`;

  /** Klein label voor in lijsten: icoon + temperatuur */
  function chip(w) {
    if (!w) return "";
    const rain = w.p >= 0.5 ? ` · ${nf1.format(w.p)} mm` : "";
    return `<span class="wx-chip" title="${label(w.c)}, ${nf1.format(w.t)} °C, wind ${dir(w.wd)} ${w.ws} km/u${rain}">${icon(w.c, 16)}${deg(w.t)}</span>`;
  }
  /** Windpijl: wijst waar de wind naartoe waait */
  function arrow(wd, size = 22) {
    return `<svg class="wx-arrow" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" style="transform:rotate(${(wd + 180) % 360}deg)"><path d="M12 3l5 9h-3.5v9h-3v-9H7z" fill="currentColor"/></svg>`;
  }

  /** Kaartje voor de detailpagina van een rit */
  function card(w, opts = {}) {
    const foot = !!opts.foot;
    if (!w) return "";
    const items = [
      ["Gevoelstemperatuur", deg(w.fl)],
      ["Laagste – hoogste", `${deg(w.lo)} – ${deg(w.hi)}`],
      ["Wind", `${arrow(w.wd, 16)}${dir(w.wd)} ${w.ws} km/u · ${bft(w.ws)} Bft`],
      ["Windstoten", `${w.gu} km/u`],
      ["Neerslag", w.p > 0 ? `${nf1.format(w.p)} mm` : "droog"],
      ["Bewolking", `${w.cc}%`],
    ];
    let along = "";
    if (w.hw != null) {
      const side = Math.max(0, 100 - w.hw - w.tw);
      along = `<div class="wx-along"><p class="wx-al-h">Wind langs de route</p>
        <div class="wx-bar" role="img" aria-label="${w.hw}% tegenwind, ${side}% zijwind, ${w.tw}% meewind">
          <span class="hw" style="width:${w.hw}%"></span><span class="sw" style="width:${side}%"></span><span class="tw" style="width:${w.tw}%"></span></div>
        <p class="wx-al-l"><span><i class="hw"></i>tegenwind ${w.hw}%</span><span><i class="sw"></i>zijwind ${side}%</span><span><i class="tw"></i>meewind ${w.tw}%</span></p></div>`;
    }
    return `<div class="wx-card">
      <div class="wx-main">${icon(w.c, 44)}<div><p class="wx-t">${nf1.format(w.t)}<small> °C</small></p><p class="wx-l">${label(w.c)}</p></div></div>
      <dl class="wx-list">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      ${along}
      <p class="wx-src">Gemiddeld over de ${foot ? "wandeling" : "rit"}${w.est ? " (duur geschat)" : ""}, rond het startpunt (±10 km). Weer: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.</p>
    </div>`;
  }

  window.FGWx = { kind, label, icon, chip, card, dir, bft, arrow };
})();
