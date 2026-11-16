/* Fietsgemeenten - mijlpalen en feestjes (50/75/90/100%) */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COLORS = ["#eb6834", "#3987e5", "#f2b134", "#1a7f37", "#d0459c", "#0b0b0b"];
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const P = {
    seen: new Set(),
    on: true,
    ready: false,
    queue: [],
    showing: false,
    registry: new Map(), // groep -> {label, items}
  };

  // ------------------------------------------------------------ opslag
  function init(status) {
    for (const k of status.seen || []) P.seen.add(k);
    P.on = status.party !== false;
    P.ready = true;
  }

  async function persist(keys) {
    if (!keys.length) return;
    try {
      await fetch("/api/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ add: keys }) });
    } catch { /* niet erg: dan komt hij later nog eens */ }
  }

  /**
   * Controleer mijlpalen van één groep (bijv. 'gem-begin' of 'km-2026-6000').
   * items: [{pct, date, build: () => kaart}] met date = null als nog niet gehaald.
   * De eerste keer dat een groep langskomt, wordt alles wat al gehaald is stil als
   * 'gezien' gemarkeerd: geschiedenis krijgt een medaille, geen feest.
   */
  function check(group, label, items, allowParty) {
    P.registry.set(group, { label, items });
    if (!P.ready) return;
    const reached = items.filter((i) => i.date);
    const marker = `g:${group}`;
    if (!P.seen.has(marker)) {
      const keys = [marker, ...reached.map((i) => `${group}:${i.pct}`)];
      keys.forEach((k) => P.seen.add(k));
      persist(keys);
      return;
    }
    const fresh = reached.filter((i) => !P.seen.has(`${group}:${i.pct}`));
    if (!fresh.length) return;
    const keys = fresh.map((i) => `${group}:${i.pct}`);
    keys.forEach((k) => P.seen.add(k));
    persist(keys);
    if (!allowParty || !P.on) return;
    const top = fresh.reduce((a, b) => (b.pct > a.pct ? b : a)); // alleen de hoogste vieren
    enqueue(top);
  }

  function enqueue(item) {
    P.queue.push(item);
    if (!P.showing) next();
  }

  function next() {
    const item = P.queue.shift();
    if (!item) { P.showing = false; return; }
    P.showing = true;
    show(item);
  }

  // ------------------------------------------------------------ tonen
  function show(item) {
    const card = item.build();
    const el = $("party");
    const big = item.pct === 100;
    el.hidden = false;
    el.className = `party p${item.pct}`;
    $("party-card").innerHTML = `
      <div class="party-badge" aria-hidden="true">${item.pct}%</div>
      <h2 id="party-title">${esc(card.title)}</h2>
      ${card.lead ? `<p class="party-lead">${card.lead}</p>` : ""}
      ${card.rows && card.rows.length ? `<div class="party-rows">${card.rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join("")}</div>` : ""}
      ${card.chips && card.chips.length ? `<div class="party-chips">${card.chips.map((c) => `<span>${esc(c)}</span>`).join("")}</div>` : ""}
      ${card.note ? `<p class="party-note">${card.note}</p>` : ""}
      <button class="btn primary" type="button" id="party-close">${big ? "Geweldig!" : "Doorfietsen"}</button>`;
    $("party-close").focus();
    $("party-close").addEventListener("click", close);
    if (!reduceMotion()) animate(item.pct);
  }

  function close() {
    stopAnim();
    $("party").hidden = true;
    setTimeout(next, 250);
  }

  // ------------------------------------------------------------ animatie
  let raf = null, parts = [], stopAt = 0, lastBurst = 0;

  function animate(pct) {
    const cv = $("party-canvas");
    const ctx = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const resize = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    parts = [];
    const now = performance.now();
    const fireworks = pct === 100;
    stopAt = now + (fireworks ? 6500 : pct === 90 ? 1800 : 3500);
    const amount = { 50: 140, 75: 240, 90: 50, 100: 200 }[pct] || 120;
    for (let i = 0; i < amount; i++) parts.push(confetto(true));
    lastBurst = 0;
    const tick = (t) => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      if (fireworks && t < stopAt - 1500 && t - lastBurst > 420) { burst(); lastBurst = t; }
      parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 40);
      for (const p of parts) {
        p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= p.decay;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.translate(p.x, p.y);
        if (p.spark) {
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(0, 0, p.s, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.rotate(p.rot);
          ctx.fillStyle = p.c;
          ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        }
        ctx.restore();
      }
      if (t < stopAt || parts.length) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    raf = requestAnimationFrame(tick);
  }

  function confetto(initial) {
    return {
      x: Math.random() * innerWidth, y: initial ? -20 - Math.random() * innerHeight * 0.6 : -20,
      vx: (Math.random() - 0.5) * 2.4, vy: 1.5 + Math.random() * 2.5, g: 0.035, drag: 0.995,
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.2, s: 7 + Math.random() * 6,
      c: COLORS[(Math.random() * COLORS.length) | 0], life: 1.6, decay: 0.0035, spark: false,
    };
  }

  function burst() {
    const cx = innerWidth * (0.15 + Math.random() * 0.7), cy = innerHeight * (0.12 + Math.random() * 0.35);
    const c = COLORS[(Math.random() * 5) | 0];
    const n = 70;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n, sp = 2.5 + Math.random() * 3.2;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0.04, drag: 0.985,
        rot: 0, vr: 0, s: 2 + Math.random() * 1.6, c, life: 1, decay: 0.012 + Math.random() * 0.008, spark: true });
    }
  }

  function stopAnim() {
    if (raf) cancelAnimationFrame(raf);
    raf = null; parts = [];
    const cv = $("party-canvas");
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  }

  // ------------------------------------------------------------ medailles
  /** Medaille-rij voor 50/75/90/100% (items met date of null). */
  function medals(items, fmt) {
    return `<div class="medals">${items.map((i) => `
      <div class="medal${i.date ? " got" : ""}" title="${i.date ? `${i.pct}% gehaald op ${esc(fmt(i.date))}` : `${i.pct}% nog niet gehaald`}">
        <span class="mdisc">${i.pct}%</span>
        <span class="mdate">${i.date ? esc(fmt(i.date)) : "nog niet"}</span>
      </div>`).join("")}</div>`;
  }

  // ------------------------------------------------------------ instellingen
  function renderSettings(box, fmt) {
    const groups = [...P.registry.entries()].filter(([, g]) => g.items.some((i) => i.date));
    box.innerHTML = `
      <label class="check-row"><input type="checkbox" id="party-on" ${P.on ? "checked" : ""}> Feestjes tonen bij 50, 75, 90 en 100%</label>
      ${groups.length ? `<div class="replay">${groups.map(([g, grp]) => `
        <div class="replay-row"><span>${esc(grp.label)}</span><span class="replay-btns">${grp.items.filter((i) => i.date)
          .map((i) => `<button type="button" class="chip small" data-g="${esc(g)}" data-p="${i.pct}" title="Gehaald op ${esc(fmt(i.date))}">${i.pct}%</button>`).join("")}</span></div>`).join("")}</div>
        <p class="hint">Klik op een percentage om dat feestje opnieuw te bekijken.</p>` : ""}`;
    box.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => {
      const grp = P.registry.get(b.dataset.g);
      const item = grp && grp.items.find((i) => i.pct === Number(b.dataset.p));
      if (item) { const d = $("dlg-settings"); if (d.open) d.close(); enqueue(item); }
    }));
    $("party-on").addEventListener("change", async (e) => {
      P.on = e.target.checked;
      await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ party: P.on }) });
    });
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("party").hidden) close(); });

  window.FGParty = { init, check, medals, renderSettings };
})();
