// Languages in the browser.
//
// The words live in static/i18n/<lang>.json. The server draws the page in the
// reader's language to begin with and puts both tables in the page, so this
// module only has to switch between them, without a reload.
//
// Which language: the one the user picked with the switch (remembered here
// and in a cookie the server reads too), otherwise the browser's own, and
// English for a browser in a language we do not speak yet.

const TABLES = JSON.parse(document.getElementById("i18n-data").textContent);
export const LANGS = Object.keys(TABLES);          // ["es", "en"]
const FALLBACK = "en";
const listeners = new Set();

function remembered() {
  try { return localStorage.getItem("lang"); } catch { return null; }
}

function detect() {
  const saved = remembered();
  if (LANGS.includes(saved)) return saved;
  const cookie = document.cookie.match(/(?:^|;\s*)lang=([a-z]{2})/);
  if (cookie && LANGS.includes(cookie[1])) return cookie[1];
  for (const tag of navigator.languages || [navigator.language || ""]) {
    const code = String(tag).slice(0, 2).toLowerCase();
    if (LANGS.includes(code)) return code;
  }
  return FALLBACK;
}

let current = detect();

export function lang() {
  return current;
}

// The text for `key` in the current language, with {name} filled from
// `params`. For counts, a key may come in two forms, "key.one" and
// "key.other", chosen by params.n.
export function t(key, params = {}) {
  let k = key;
  if (typeof params.n === "number") {
    const form = `${key}.${params.n === 1 ? "one" : "other"}`;
    if (form in TABLES[current] || form in TABLES[FALLBACK]) k = form;
  }
  const text = TABLES[current][k] ?? TABLES[FALLBACK][k] ?? TABLES.es?.[k] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

// Everything in the page that carries a key: text, text with markup, and
// attributes ("title:key;aria-label:key").
export function applyStatic(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":").map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
  document.documentElement.lang = current;
  document.querySelectorAll(".lang-btn[data-lang]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.lang === current));
  });
}

// Called when the language changes, so parts of the page written by code
// (the step card, the graphs, the review message...) can be written again.
export function onLanguageChange(fn) {
  listeners.add(fn);
}

export function setLang(code) {
  if (!LANGS.includes(code) || code === current) return;
  current = code;
  try { localStorage.setItem("lang", code); } catch { /* private window: the cookie still works */ }
  // the server reads it too: the tutor answers, and errors are written, in this language
  document.cookie = `lang=${code}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  applyStatic();
  listeners.forEach((fn) => { try { fn(code); } catch (err) { console.error(err); } });
}

export function wireSwitch() {
  document.querySelectorAll(".lang-btn[data-lang]").forEach((b) => {
    b.addEventListener("click", () => setLang(b.dataset.lang));
  });
  // The page was drawn by the server from the cookie or Accept-Language; if
  // this browser remembers another choice, honour it now, and tell the server.
  if (remembered() === current && !document.cookie.includes(`lang=${current}`)) {
    document.cookie = `lang=${current}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }
  if (document.documentElement.lang !== current) applyStatic();
}
