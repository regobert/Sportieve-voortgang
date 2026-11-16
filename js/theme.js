/* Fietsgemeenten - licht of donker (wordt in <head> geladen, zodat er niets knippert) */
(function () {
  "use strict";
  const root = document.documentElement;
  let theme = "light";
  try { theme = localStorage.getItem("fg-theme") || "light"; } catch { /* geen opslag */ }
  root.dataset.theme = theme === "dark" ? "dark" : "light";

  function sync() {
    const b = document.getElementById("btn-theme");
    if (!b) return;
    const dark = root.dataset.theme === "dark";
    b.setAttribute("aria-pressed", String(dark));
    b.querySelector("span").textContent = dark ? "Lichte modus" : "Donkere modus";
  }

  window.FGTheme = {
    get: () => root.dataset.theme,
    set(t) {
      root.dataset.theme = t === "dark" ? "dark" : "light";
      try { localStorage.setItem("fg-theme", root.dataset.theme); } catch { /* geen opslag */ }
      sync();
      window.dispatchEvent(new CustomEvent("fg-theme"));
    },
    toggle() { this.set(root.dataset.theme === "dark" ? "light" : "dark"); },
    /** Kleur uit de stylesheet, bv. css("--ink") */
    css: (name) => getComputedStyle(root).getPropertyValue(name).trim(),
  };

  document.addEventListener("DOMContentLoaded", () => {
    sync();
    const b = document.getElementById("btn-theme");
    if (b) b.addEventListener("click", () => window.FGTheme.toggle());
  });
})();
