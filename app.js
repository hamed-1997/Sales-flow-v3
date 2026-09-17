"use strict";
/* =========================================================
   SalesFlow — app.js
   Single-file application logic: IndexedDB layer, business
   rules, and UI rendering. No build step, no framework.
   ========================================================= */

/* ---------------------------------------------------------
   0. Small utilities
   --------------------------------------------------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const escapeHtml = (str) =>
  String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

function toPersianSafeNumber(val) {
  if (val === null || val === undefined) return NaN;
  if (typeof val === "number") return val;
  let s = String(val).trim();
  if (s === "") return NaN;
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  s = s.replace(/[۰-۹]/g, (d) => String(persianDigits.indexOf(d)));
  s = s.replace(/,/g, "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

function normalizeStr(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function isValidColumnLetter(v) {
  return /^[A-Za-z]{1,3}$/.test(String(v || "").trim());
}

/** Renders a reference to the shared SVG icon sprite defined in index.html. */
function icon(name, cls = "") {
  return `<span class="icon ${cls}"><svg><use href="#icon-${name}"></use></svg></span>`;
}

/* ---------------------------------------------------------
   0b. Jalali (Shamsi) date — self-contained, no CDN dependency
   --------------------------------------------------------- */
/** Gregorian date -> [jYear, jMonth(1-12), jDay]. Standard public-domain algorithm. */
function gregorianToJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let jm, jd;
  if (days < 186) { jm = 1 + Math.floor(days / 31); jd = 1 + (days % 31); }
  else { jm = 7 + Math.floor((days - 186) / 30); jd = 1 + ((days - 186) % 30); }
  return [jy, jm, jd];
}
function todayJalali() {
  const now = new Date();
  return gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
function pad2(n) { return String(n).padStart(2, "0"); }
function jalaliToStr(y, m, d) { return `${y}/${pad2(m)}/${pad2(d)}`; }
const PERSIAN_DIGIT_MAP = "۰۱۲۳۴۵۶۷۸۹";
function toPersianDigits(v) {
  return String(v).replace(/[0-9]/g, (d) => PERSIAN_DIGIT_MAP[Number(d)]);
}
function jalaliMonthName(m) {
  return ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"][m - 1] || "";
}
/** Jalali -> Gregorian [gy, gm(1-12), gd]. Standard public-domain algorithm
 * (inverse of gregorianToJalali) — used only to do reliable day-arithmetic
 * (e.g. "yesterday") via the native Date object, then convert back. */
function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const isLeap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const monthDays = [0, 31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 1; gm <= 12; gm++) {
    if (gd <= monthDays[gm]) break;
    gd -= monthDays[gm];
  }
  return [gy, gm, gd];
}
/** Adds (or subtracts, with a negative delta) whole days to a Jalali date,
 * round-tripping through Gregorian/native Date so calendar-length quirks
 * (leap years, 30 vs 31-day months) are handled correctly either way. */
function jalaliAddDays(jy, jm, jd, deltaDays) {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const d = new Date(gy, gm - 1, gd);
  d.setDate(d.getDate() + deltaDays);
  return gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
function yesterdayJalaliStr() {
  const [y, m, d] = todayJalali();
  const [yy, mm, dd] = jalaliAddDays(y, m, d, -1);
  return jalaliToStr(yy, mm, dd);
}

/* ---------------------------------------------------------
   1. Toasts
   --------------------------------------------------------- */
function showToast(message, type = "neutral", timeout = 3600) {
  const region = $("#toast-region");
  const el = document.createElement("div");
  el.className = `toast ${type === "neutral" ? "" : type}`;
  const iconName = type === "success" ? "check-circle" : type === "error" ? "x-circle" : type === "warning" ? "alert-triangle" : "info";
  el.innerHTML = `${icon(iconName)}<span>${escapeHtml(message)}</span>`;
  region.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 200ms ease";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

/* ---------------------------------------------------------
   2. Modal (confirm / info / custom)
   --------------------------------------------------------- */
function openModal({ icon: iconName = "info", title, body, listItems = null, actions }) {
  const region = $("#modal-region");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const toneMap = { "alert-triangle": "tone-warning", trash: "tone-danger", "check-circle": "tone-success" };
  const tone = toneMap[iconName] || "";
  const listHtml = listItems && listItems.length
    ? `<div class="modal-list">${listItems.map((i) => `<span class="badge badge-neutral">${escapeHtml(i)}</span>`).join("")}</div>`
    : "";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-icon ${tone}"><svg><use href="#icon-${iconName}"></use></svg></div>
      <div class="modal-title">${escapeHtml(title)}</div>
      <div class="modal-body">${body}</div>
      ${listHtml}
      <div class="modal-actions" id="modal-actions-slot"></div>
    </div>`;
  region.appendChild(overlay);
  const actionsSlot = $("#modal-actions-slot", overlay);
  actions.forEach((a) => {
    const btn = document.createElement("button");
    btn.className = `btn ${a.className || "btn-secondary"}`;
    btn.textContent = a.label;
    btn.onclick = () => {
      overlay.remove();
      if (a.onClick) a.onClick();
    };
    actionsSlot.appendChild(btn);
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && actions.some((a) => a.dismissOnBackdrop !== false)) {
      // only close on backdrop if there's a cancel-like action
    }
  });
  return overlay;
}

function confirmModal({ icon, title, body, confirmLabel, confirmClass = "btn-danger", listItems = null }) {
  return new Promise((resolve) => {
    openModal({
      icon, title, body, listItems,
      actions: [
        { label: "انصراف", className: "btn-secondary", onClick: () => resolve(false) },
        { label: confirmLabel, className: confirmClass, onClick: () => resolve(true) },
      ],
    });
  });
}

/* ---------------------------------------------------------
   3. IndexedDB layer
   --------------------------------------------------------- */
const DB_NAME = "salesflow-db";
const DB_VERSION = 3;
let dbInstance = null;

function openDb() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains("groups")) {
        db.createObjectStore("groups", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("products")) {
        db.createObjectStore("products", { keyPath: "code" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      // v2 — SalesFlow نسخه ۲: مخزن فروش روزانه (برای تجمعی خودکار ماهانه)
      if (!db.objectStoreNames.contains("salesLog")) {
        db.createObjectStore("salesLog", { keyPath: "id" }); // id = `${date}__${line}`
      }
      // v3 — گروه‌های مادر (چند گروه کالا را زیر یک گروه مادر جمع کردن)
      if (!db.objectStoreNames.contains("parentGroups")) {
        db.createObjectStore("parentGroups", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (ev) => { dbInstance = ev.target.result; resolve(dbInstance); };
    req.onerror = (ev) => reject(ev.target.error);
  });
}

function txStore(storeName, mode = "readonly") {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

const Store = {
  async getAll(storeName) {
    const store = await txStore(storeName);
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  },
  async get(storeName, key) {
    const store = await txStore(storeName);
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  },
  async put(storeName, value) {
    const store = await txStore(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  },
  async delete(storeName, key) {
    const store = await txStore(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  },
  async clear(storeName) {
    const store = await txStore(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  },
};

async function getSetting(key, fallback) {
  const rec = await Store.get("settings", key);
  return rec ? rec.value : fallback;
}
async function setSetting(key, value) {
  return Store.put("settings", { key, value });
}

/* ---------------------------------------------------------
   3b. مخزن فروش روزانه (salesLog) — تجمعی خودکار ماهانه
   --------------------------------------------------------- */
/** Saves (or overwrites, if the same date+line was already saved) one
 * line's full daily breakdown (per group + total) under its Shamsi date. */
async function saveDailySaleFull(dateStr, line, rows, totalToday) {
  return Store.put("salesLog", {
    id: `${dateStr}__${line}`,
    date: dateStr,
    line,
    rows: rows.map((r) => ({ groupId: r.groupId, todaySale: r.todaySale })),
    totalToday,
  });
}

/**
 * Cumulative sale for `line`, from the configured baseline (مدیریت › فروش
 * تا روز قبل) through `uptoDateStr` — both per product-group and as a line
 * total. By default this INCLUDES `uptoDateStr` itself (used by تاریخچه/
 * گزارش فروش تا روز to show "cumulative through this day"). Pass
 * `exclusive: true` to stop strictly before it instead — this is what
 * گزارش کامل روز uses so that re-generating/overwriting an already-saved
 * day doesn't double-count that day's old entry into "cumulative so far"
 * before adding the new value on top.
 *
 * The baseline carries a full per-group breakdown (not just a total), so
 * both individual rows and the total row are accurate from the baseline
 * date forward, even when starting mid-month.
 */
async function getMonthCumulativeRows(line, uptoDateStr, { exclusive = false } = {}) {
  const monthPrefix = uptoDateStr.slice(0, 7); // "YYYY/MM"
  const baseline = state.monthBaseline[line] || { date: "", amounts: {}, total: 0 };
  // An empty date means "start of month" — the baseline always applies (day
  // one onward), not just when its (nonexistent) date matches this month.
  const baselineApplies = !baseline.date || baseline.date.slice(0, 7) === monthPrefix;
  const all = await Store.getAll("salesLog");
  const logs = all.filter((e) => e.line === line && e.date.slice(0, 7) === monthPrefix &&
    (exclusive ? e.date < uptoDateStr : e.date <= uptoDateStr) &&
    (!baseline.date || e.date > baseline.date));
  const byGroup = baselineApplies ? { ...baseline.amounts } : {};
  let total = baselineApplies ? (baseline.total || 0) : 0;
  for (const e of logs) {
    total += e.totalToday || 0;
    (e.rows || []).forEach((r) => { byGroup[r.groupId] = (byGroup[r.groupId] || 0) + (r.todaySale || 0); });
  }
  return { byGroup, total };
}

/* ---------------------------------------------------------
   4. App state (in-memory cache, hydrated from IndexedDB)
   --------------------------------------------------------- */
/** Default appearance for the two "گزارش کامل روز" report images — colors
 * sampled from the user's own sample Excel report so the first-run output
 * matches it; every value is user-editable afterwards from تنظیمات. */
const DEFAULT_REPORT_STYLE = {
  titleFontFamily: "Vazirmatn",
  headerFontFamily: "Vazirmatn",
  bodyFontFamily: "Vazirmatn",
  footerFontFamily: "Vazirmatn",
  titleSize: 20,
  headerSize: 15,
  bodySize: 15,
  footerSize: 15,
  // right-to-left display order + per-column relative width + editable label + alignment + bold
  columnOrder: ["product", "target", "today", "cumulative", "remaining"],
  columnWeights: { product: 24, target: 19, today: 19, cumulative: 19, remaining: 19 },
  columnLabels: { product: "کالا", target: "هدف ماه", today: "فروش امروز", cumulative: "فروش از ابتدای ماه", remaining: "مانده تا هدف" },
  columnAlign: { product: "right", target: "center", today: "center", cumulative: "center", remaining: "center" },
  columnBold: { product: true, target: false, today: false, cumulative: false, remaining: false },
  // per-column background override (applies to that column's data-row + total-row cells);
  // columnBgEnabled[key]=false means "use the row's own background" (dataRowBg/totalRowBg)
  columnBgEnabled: { product: false, target: false, today: false, cumulative: false, remaining: false },
  columnBg: { product: "#ffffff", target: "#ffffff", today: "#ffffff", cumulative: "#ffffff", remaining: "#ffffff" },
  imageWidth: 660,
  borderWidth: 1,
  dateCellSpan: 1, // how many of the rightmost-columns' worth of width the date cell (top-left) takes up — default = just the last column
  // right-to-left display order + relative width + editable label for the footer stats row
  footerOrder: ["customer", "perRep", "invalid"],
  footerWeights: { customer: 2, perRep: 1, invalid: 2 },
  footerLabels: { customer: "مشتری امروز", perRep: "سرانه", invalid: "درصد ابطالی" },
  titleTemplate: "گزارش فروش {line}",
  dateTemplate: "تاریخ: {date}",
  titleBold: true,
  headerBold: true,
  footerBold: true,
  rowHeights: { title: 46, header: 36, data: 32, total: 36, spacer: 24, footer: 36 },
  spacerBg: "#0070c0",
  dateCellBg: "#002d82",
  dateCellText: "#ffffff",
  titleCellBg: "#9bc1e6",
  titleCellText: "#0b3f73",
  headerRowBg: "#fce5d7",
  headerRowText: "#0b3f73",
  dataRowBg: "#ffffff",
  dataRowText: "#172b3a",
  totalRowBg: "#ddebf6",
  totalRowText: "#0b3f73",
  remainingPositiveText: "#16a34a",
  remainingNegativeText: "#dc2626",
  footerCustomerBg: "#ffff00",
  footerCustomerText: "#000000",
  footerPerRepBg: "#ffc000",
  footerPerRepText: "#000000",
  footerInvalidBg: "#00af50",
  footerInvalidText: "#ffffff",
  borderColor: "#94a3b8",
};

const REPORT_COLUMN_KEYS = ["product", "target", "today", "cumulative", "remaining"];
const REPORT_FOOTER_KEYS = ["customer", "perRep", "invalid"];

/** Fills in any missing/malformed pieces of a saved reportStyle (e.g. from
 * before column/footer reordering existed, or a corrupted order array) with
 * their defaults, so drawReportCanvas can always assume a complete, valid
 * shape. */
function sanitizeReportStyle(raw) {
  const s = { ...DEFAULT_REPORT_STYLE, ...(raw || {}) };
  s.columnWeights = { ...DEFAULT_REPORT_STYLE.columnWeights, ...(raw?.columnWeights && !Array.isArray(raw.columnWeights) ? raw.columnWeights : {}) };
  s.columnLabels = { ...DEFAULT_REPORT_STYLE.columnLabels, ...(raw?.columnLabels || {}) };
  s.columnAlign = { ...DEFAULT_REPORT_STYLE.columnAlign, ...(raw?.columnAlign || {}) };
  s.columnBold = { ...DEFAULT_REPORT_STYLE.columnBold, ...(raw?.columnBold || {}) };
  s.columnBgEnabled = { ...DEFAULT_REPORT_STYLE.columnBgEnabled, ...(raw?.columnBgEnabled || {}) };
  s.columnBg = { ...DEFAULT_REPORT_STYLE.columnBg, ...(raw?.columnBg || {}) };
  s.columnOrder = Array.isArray(raw?.columnOrder) && REPORT_COLUMN_KEYS.every((k) => raw.columnOrder.includes(k)) && raw.columnOrder.length === REPORT_COLUMN_KEYS.length
    ? raw.columnOrder
    : [...DEFAULT_REPORT_STYLE.columnOrder];
  s.footerWeights = { ...DEFAULT_REPORT_STYLE.footerWeights, ...(raw?.footerWeights || {}) };
  s.footerLabels = { ...DEFAULT_REPORT_STYLE.footerLabels, ...(raw?.footerLabels || {}) };
  s.footerOrder = Array.isArray(raw?.footerOrder) && REPORT_FOOTER_KEYS.every((k) => raw.footerOrder.includes(k)) && raw.footerOrder.length === REPORT_FOOTER_KEYS.length
    ? raw.footerOrder
    : [...DEFAULT_REPORT_STYLE.footerOrder];
  s.rowHeights = { ...DEFAULT_REPORT_STYLE.rowHeights, ...(raw?.rowHeights || {}) };
  return s;
}

/** A small built-in sample dataset, used to render the settings live-preview
 * before the user has ever generated a real report. */
const SAMPLE_PREVIEW_REPORT_DATA = {
  lineLabel: "لاین یک",
  dateStr: "1405/06/08",
  rows: [
    { name: "شوینده", target: 30552, todaySale: 2116, cumulative: 3871, remaining: 3871 - 30552, sellByUnit: false },
    { name: "اکشن", target: 2804, todaySale: 37, cumulative: 123, remaining: 123 - 2804, sellByUnit: false },
    { name: "پاستیل", target: 4950, todaySale: 95, cumulative: 242, remaining: 242 - 4950, sellByUnit: true },
  ],
  totalToday: 2248,
  totalCumulative: 4236,
  targetTotal: 38306,
  totalRemaining: 4236 - 38306,
  customerCount: 351,
  perRep: 70.2,
  invalidPct: "14.04",
};

const state = {
  groups: [],           // [{id, name, order}]
  products: [],          // [{code, group, cartonQty}]
  columnMap: { code: "", qty: "", carton: "", line: "", customer: "", invoice: "" },
  lines: {
    line1: { label: "لاین یک", excelValue: "" },
    line2: { label: "لاین دو", excelValue: "" },
  },
  lineGroups: { line1: [], line2: [] }, // arrays of group ids — derived automatically from lineReportItems (real-group entries only); kept for اهداف/گزارش فروش تا روز/تاریخچه, unchanged since v2

  // ---- SalesFlow نسخه ۳ additions ----
  parentGroups: [],     // [{id, name, order, childGroupIds:[groupId...], displayName}]
  lineReportItems: { line1: [], line2: [] }, // [{type:'group'|'parent', id}] — ordered rows for the per-line report (تعریف گزارش کلی); source of truth for report display, supersedes lineGroups for that purpose
  fontScale: 1.1,
  salesWorkbookSheet: null, // current parsed worksheet (for report)
  salesFileLoaded: false,

  // ---- SalesFlow نسخه ۲ additions ----
  monthlyTargets: { line1: {}, line2: {} },  // { line1: {groupId: number}, line2: {...} }
  targetTotals: { line1: 0, line2: 0 },       // separately-announced total target per line
  sellersCount: { line1: 0, line2: 0 },
  monthBaseline: {                             // گزارش فروش تا روز — مبدأ تجمعی ماه، به‌تفکیک گروه کالا
    line1: { date: "", amounts: {}, total: 0 },
    line2: { date: "", amounts: {}, total: 0 },
  },
  reportStyle: { ...DEFAULT_REPORT_STYLE },
  appLockPinHash: "",
  lastBackupAt: "",
};

async function hydrateState() {
  state.groups = (await Store.getAll("groups")).sort((a, b) => a.order - b.order);
  state.products = await Store.getAll("products");
  // shallow-merge over defaults so older saved settings (from before a field
  // like "invoice" existed) don't lose the new key entirely.
  state.columnMap = { ...state.columnMap, ...(await getSetting("columnMap", {})) };
  state.lines = await getSetting("lines", state.lines);
  state.lineGroups = await getSetting("lineGroups", state.lineGroups);
  state.fontScale = await getSetting("fontScale", 1.1);

  state.parentGroups = (await Store.getAll("parentGroups")).sort((a, b) => a.order - b.order);
  const rawReportItems = await getSetting("lineReportItems", null);
  if (rawReportItems && rawReportItems.line1 && rawReportItems.line2) {
    state.lineReportItems = rawReportItems;
  } else {
    // migrating from before نسخه ۳: no lineReportItems saved yet — build it
    // from the existing lineGroups (plain real-group ids) so nothing is lost.
    state.lineReportItems = {
      line1: (state.lineGroups.line1 || []).map((id) => ({ type: "group", id })),
      line2: (state.lineGroups.line2 || []).map((id) => ({ type: "group", id })),
    };
  }

  state.monthlyTargets = await getSetting("monthlyTargets", state.monthlyTargets);
  state.targetTotals = await getSetting("targetTotals", state.targetTotals);
  state.sellersCount = await getSetting("sellersCount", state.sellersCount);
  const rawBaseline = await getSetting("monthBaseline", state.monthBaseline);
  state.monthBaseline = {
    line1: { date: rawBaseline?.line1?.date || "", amounts: rawBaseline?.line1?.amounts || {}, total: rawBaseline?.line1?.total ?? rawBaseline?.line1?.amount ?? 0 },
    line2: { date: rawBaseline?.line2?.date || "", amounts: rawBaseline?.line2?.amounts || {}, total: rawBaseline?.line2?.total ?? rawBaseline?.line2?.amount ?? 0 },
  };
  state.reportStyle = sanitizeReportStyle(await getSetting("reportStyle", {}));
  state.appLockPinHash = await getSetting("appLockPinHash", "");
  state.lastBackupAt = await getSetting("lastBackupAt", "");
}

function groupById(id) { return state.groups.find((g) => g.id === id); }
function groupByName(name) { return state.groups.find((g) => g.name === name); }
function productCountForGroup(groupId) {
  return state.products.filter((p) => p.group === groupId).length;
}

/* ---- گروه‌های مادر — SalesFlow نسخه ۳ ---- */
function parentGroupById(id) { return state.parentGroups.find((p) => p.id === id); }
/** The parent group (if any) that `groupId` is currently a child of. */
function parentOfGroup(groupId) {
  return state.parentGroups.find((p) => (p.childGroupIds || []).includes(groupId));
}
/** Checks whether a set of group ids can safely be grouped under one parent:
 * all of them must share the same «فروش به قوطی» setting (mixing a carton-
 * based group with a قوطی-based one under one parent row is not allowed —
 * there is no single unit to display/sum them in). Returns {ok:true} or
 * {ok:false, message}. An empty or single-group set is always fine. */
function validateChildSellByUnitConsistency(groupIds) {
  const groups = groupIds.map((id) => groupById(id)).filter(Boolean);
  if (groups.length < 2) return { ok: true };
  const first = !!groups[0].sellByUnit;
  const mismatch = groups.find((g) => !!g.sellByUnit !== first);
  if (mismatch) {
    return {
      ok: false,
      message: `گروه‌های انتخاب‌شده تنظیم «فروش به قوطی» یکسانی ندارند (مثلاً «${escapeHtml(groups[0].name)}» و «${escapeHtml(mismatch.name)}» با هم فرق دارند) — همه زیرگروه‌های یک گروه مادر باید از نظر «فروش به قوطی» یکسان باشند.`,
    };
  }
  return { ok: true };
}

/* ---------------------------------------------------------
   5. Navigation
   --------------------------------------------------------- */
function switchView(viewKey) {
  $all(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === viewKey));
  $all(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${viewKey}`));
  $(".view-scroll").scrollTo({ top: 0, behavior: "instant" });
}

function switchManagementTab(tabKey) {
  $all("#management-tabs .tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.mtab === tabKey));
  $all(".mtab-panel").forEach((p) => (p.style.display = p.id === `mtab-${tabKey}` ? "" : "none"));
}

/* ---------------------------------------------------------
   6. GROUPS management (add / reorder / delete)
   --------------------------------------------------------- */
function renderGroupAddForm() {
  const slot = $("#group-add-form-slot");
  slot.innerHTML = `
    <div style="margin-bottom: var(--space-5); display:none" id="group-add-row">
      <div class="row">
        <div class="field" style="flex:1">
          <input type="text" id="new-group-name" placeholder="نام گروه کالا را وارد کنید" />
          <div class="field-error" id="group-add-error" style="display:none"></div>
        </div>
        <button class="btn btn-primary" id="btn-confirm-add-group">افزودن</button>
        <button class="btn btn-secondary" id="btn-cancel-add-group">انصراف</button>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="new-group-nonsellable" />
        <label for="new-group-nonsellable">غیرقابل فروش (مثل استند) — این گروه هرگز جزو فروش و تعداد مشتری حساب نشود</label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="new-group-sellbyunit" />
        <label for="new-group-sellbyunit">فروش به قوطی — گزارش این گروه با واحد کوچک (تعداد خام) محاسبه شود، نه تقسیم بر تعداد در کارتن</label>
      </div>
    </div>`;
}

function toggleGroupAddRow(show) {
  const row = $("#group-add-row");
  row.style.display = show ? "block" : "none";
  if (show) {
    $("#new-group-name").value = "";
    $("#new-group-nonsellable").checked = false;
    $("#new-group-sellbyunit").checked = false;
    $("#group-add-error").style.display = "none";
    $("#new-group-name").focus();
  }
}

async function handleAddGroup() {
  const input = $("#new-group-name");
  const errorEl = $("#group-add-error");
  const nonSellable = $("#new-group-nonsellable").checked;
  const sellByUnit = $("#new-group-sellbyunit").checked;
  const name = normalizeStr(input.value);
  if (!name) {
    errorEl.textContent = "نام گروه کالا را وارد کنید.";
    errorEl.style.display = "block";
    return;
  }
  const duplicate = state.groups.some((g) => g.name === name);
  if (duplicate) {
    errorEl.textContent = "⚠️ این گروه کالا قبلاً ثبت شده است.";
    errorEl.style.display = "block";
    return;
  }
  const maxOrder = state.groups.reduce((m, g) => Math.max(m, g.order), -1);
  const rec = { name, order: maxOrder + 1, nonSellable, sellByUnit };
  const id = await Store.put("groups", rec);
  rec.id = id;
  state.groups.push(rec);
  toggleGroupAddRow(false);
  showToast("گروه کالا با موفقیت اضافه شد", "success");
  renderGroupsList();
  refreshAllGroupDependentUI();
}

async function handleToggleGroupNonSellable(id) {
  const group = groupById(id);
  if (!group) return;
  group.nonSellable = !group.nonSellable;
  await Store.put("groups", group);
  if (group.nonSellable) {
    // a group just marked non-sellable can no longer be part of any line's
    // report definition — strip it out and persist the cleanup.
    state.lineGroups.line1 = state.lineGroups.line1.filter((gid) => gid !== id);
    state.lineGroups.line2 = state.lineGroups.line2.filter((gid) => gid !== id);
    await setSetting("lineGroups", state.lineGroups);
    await removeGroupFromLineReportItems(id);
    // نه می‌تواند زیرگروه یک گروه مادر باقی بماند
    const parent = parentOfGroup(id);
    if (parent) {
      parent.childGroupIds = (parent.childGroupIds || []).filter((gid) => gid !== id);
      await Store.put("parentGroups", parent);
      renderParentGroupsList();
    }
  }
  showToast(
    group.nonSellable ? "گروه به‌عنوان «غیرقابل فروش» علامت‌گذاری شد" : "گروه به فروش عادی بازگشت",
    "success"
  );
  renderGroupsList();
  refreshAllGroupDependentUI();
}

async function handleToggleGroupSellByUnit(id) {
  const group = groupById(id);
  if (!group) return;
  const parent = parentOfGroup(id);
  if (parent) {
    // toggling this group's unit would make it inconsistent with its
    // parent's other children — not allowed (see گروه مادر spec).
    const siblingIds = (parent.childGroupIds || []).filter((gid) => gid !== id);
    const siblings = siblingIds.map((gid) => groupById(gid)).filter(Boolean);
    const wouldBeSellByUnit = !group.sellByUnit;
    const mismatch = siblings.find((s) => !!s.sellByUnit !== wouldBeSellByUnit);
    if (mismatch) {
      openModal({
        icon: "alert-triangle",
        title: "تغییر ممکن نیست",
        body: `این گروه زیرِ گروه مادر «${escapeHtml(parent.name)}» است و سایر زیرگروه‌های آن (مثلاً «${escapeHtml(mismatch.name)}») تنظیم «فروش به قوطی» متفاوتی دارند. ابتدا این گروه را از گروه مادر خارج کنید یا تنظیم بقیه زیرگروه‌ها را هماهنگ کنید.`,
        actions: [{ label: "باشه", className: "btn-primary" }],
      });
      return;
    }
  }
  group.sellByUnit = !group.sellByUnit;
  await Store.put("groups", group);
  showToast(
    group.sellByUnit ? "گروه به‌صورت «فروش به قوطی» محاسبه می‌شود" : "گروه به محاسبه بر اساس کارتن بازگشت",
    "success"
  );
  renderGroupsList();
}

function renderGroupsList() {
  const slot = $("#groups-list-slot");
  if (!state.groups.length) {
    slot.innerHTML = `
      <div class="empty-state">
        <div class="icon"><svg><use href="#icon-box"></use></svg></div>
        <div class="title">هنوز گروهی ثبت نشده است</div>
        <div>با دکمه «افزودن گروه کالا» شروع کنید</div>
      </div>`;
    return;
  }
  const sorted = [...state.groups].sort((a, b) => a.order - b.order);
  slot.innerHTML = `<div class="order-list" id="order-list">${sorted
    .map(
      (g, idx) => `
      <div class="order-item" draggable="true" data-group-id="${g.id}">
        <span class="drag-handle"><svg width="16" height="16"><use href="#icon-grip"></use></svg></span>
        <span class="name" data-open-group="${g.id}" style="cursor:pointer">${escapeHtml(g.name)}</span>
        ${g.nonSellable ? `<span class="badge badge-neutral">غیرقابل فروش</span>` : ""}
        ${g.sellByUnit ? `<span class="badge badge-neutral">فروش به قوطی</span>` : ""}
        <span class="count">${productCountForGroup(g.id)} کالا</span>
        <div class="move-btns">
          <button class="btn btn-icon btn-sm btn-secondary" data-move="up" data-id="${g.id}" ${idx === 0 ? "disabled" : ""}><svg width="14" height="14"><use href="#icon-chevron-up"></use></svg></button>
          <button class="btn btn-icon btn-sm btn-secondary" data-move="down" data-id="${g.id}" ${idx === sorted.length - 1 ? "disabled" : ""}><svg width="14" height="14"><use href="#icon-chevron-down"></use></svg></button>
        </div>
        <button class="btn btn-sm btn-secondary" data-toggle-sellbyunit="${g.id}">${g.sellByUnit ? "بازگشت به کارتن" : "فروش به قوطی"}</button>
        <button class="btn btn-sm btn-secondary" data-toggle-nonsellable="${g.id}">${g.nonSellable ? "بازگشت به فروش عادی" : "غیرقابل فروش"}</button>
        <button class="btn btn-icon btn-sm btn-danger" data-delete-group="${g.id}"><svg width="15" height="15"><use href="#icon-trash"></use></svg></button>
      </div>`
    )
    .join("")}</div>`;

  // move buttons
  $all("[data-move]", slot).forEach((btn) => {
    btn.addEventListener("click", () => moveGroup(Number(btn.dataset.id), btn.dataset.move));
  });
  // delete buttons
  $all("[data-delete-group]", slot).forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteGroup(Number(btn.dataset.deleteGroup)));
  });
  // non-sellable toggle
  $all("[data-toggle-nonsellable]", slot).forEach((btn) => {
    btn.addEventListener("click", () => handleToggleGroupNonSellable(Number(btn.dataset.toggleNonsellable)));
  });
  // sell-by-unit toggle
  $all("[data-toggle-sellbyunit]", slot).forEach((btn) => {
    btn.addEventListener("click", () => handleToggleGroupSellByUnit(Number(btn.dataset.toggleSellbyunit)));
  });
  // open group products modal
  $all("[data-open-group]", slot).forEach((el) => {
    el.addEventListener("click", () => openGroupProductsModal(Number(el.dataset.openGroup)));
  });
  // drag & drop reordering
  let dragId = null;
  $all(".order-item", slot).forEach((item) => {
    item.addEventListener("dragstart", () => {
      dragId = Number(item.dataset.groupId);
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
    item.addEventListener("dragover", (e) => e.preventDefault());
    item.addEventListener("drop", async (e) => {
      e.preventDefault();
      const targetId = Number(item.dataset.groupId);
      if (dragId === null || dragId === targetId) return;
      await reorderGroups(dragId, targetId);
    });
  });
}

async function moveGroup(id, direction) {
  const sorted = [...state.groups].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((g) => g.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sorted.length) return;
  const a = sorted[idx], b = sorted[swapIdx];
  const tmp = a.order; a.order = b.order; b.order = tmp;
  await Store.put("groups", a);
  await Store.put("groups", b);
  renderGroupsList();
}

async function reorderGroups(dragId, targetId) {
  const sorted = [...state.groups].sort((a, b) => a.order - b.order);
  const fromIdx = sorted.findIndex((g) => g.id === dragId);
  const toIdx = sorted.findIndex((g) => g.id === targetId);
  const [moved] = sorted.splice(fromIdx, 1);
  sorted.splice(toIdx, 0, moved);
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].order = i;
    await Store.put("groups", sorted[i]);
  }
  renderGroupsList();
}

async function handleDeleteGroup(id) {
  const group = groupById(id);
  if (!group) return;
  const count = productCountForGroup(id);
  if (count > 0) {
    const ok = await confirmModal({
      icon: "alert-triangle",
      title: "هشدار حذف گروه",
      body: `با حذف گروه «${escapeHtml(group.name)}»، تمام کدهای کالای مربوط به این گروه نیز حذف خواهند شد. آیا مطمئن هستید؟`,
      confirmLabel: "حذف گروه و کالاها",
      confirmClass: "btn-danger",
    });
    if (!ok) return;
    const toDelete = state.products.filter((p) => p.group === id);
    for (const p of toDelete) await Store.delete("products", p.code);
    state.products = state.products.filter((p) => p.group !== id);
  }
  await Store.delete("groups", id);
  state.groups = state.groups.filter((g) => g.id !== id);
  // clean up line-group selections referencing this group
  state.lineGroups.line1 = state.lineGroups.line1.filter((gid) => gid !== id);
  state.lineGroups.line2 = state.lineGroups.line2.filter((gid) => gid !== id);
  await setSetting("lineGroups", state.lineGroups);
  await removeGroupFromLineReportItems(id);
  // اگر زیرگروه یک گروه مادر بود، از آن گروه مادر هم حذفش کن
  const parent = parentOfGroup(id);
  if (parent) {
    parent.childGroupIds = (parent.childGroupIds || []).filter((gid) => gid !== id);
    await Store.put("parentGroups", parent);
  }
  showToast("گروه کالا حذف شد", "success");
  renderGroupsList();
  renderParentGroupsList();
  refreshAllGroupDependentUI();
}

/** Removes any lineReportItems entry (in either line) referencing group
 * `groupId`, and persists the cleanup. Used whenever a real group is
 * deleted or becomes ineligible (marked غیرقابل فروش). */
async function removeGroupFromLineReportItems(groupId) {
  let changed = false;
  for (const lineKey of ["line1", "line2"]) {
    const before = state.lineReportItems[lineKey].length;
    state.lineReportItems[lineKey] = state.lineReportItems[lineKey].filter(
      (item) => !(item.type === "group" && item.id === groupId)
    );
    if (state.lineReportItems[lineKey].length !== before) changed = true;
  }
  if (changed) await setSetting("lineReportItems", state.lineReportItems);
}

/* ---------------------------------------------------------
   6b. گروه‌های مادر — SalesFlow نسخه ۳
   چند گروه کالا را زیر یک گروه مادر جمع می‌کند تا در گزارش یک ردیف واحد
   (مجموع زیرگروه‌ها) نمایش داده شود. خودِ گروه مادر کالا ندارد — فقط
   گروه‌های موجود (سلامت) را ارجاع می‌دهد.
   --------------------------------------------------------- */
function renderParentGroupAddForm() {
  const slot = $("#parent-group-add-form-slot");
  slot.innerHTML = `
    <div style="margin-bottom: var(--space-5); display:none" id="parent-group-add-row">
      <div class="field">
        <input type="text" id="new-parent-group-name" placeholder="نام گروه مادر را وارد کنید (مثلاً کیلوس)" />
        <div class="field-error" id="parent-group-add-error" style="display:none"></div>
      </div>
      <div class="card-section-label" style="margin-top:var(--space-3)">زیرگروه‌ها</div>
      <div id="parent-group-child-checkboxes"></div>
      <div class="row" style="margin-top: var(--space-4)">
        <button class="btn btn-primary" id="btn-confirm-add-parent-group">افزودن</button>
        <button class="btn btn-secondary" id="btn-cancel-add-parent-group">انصراف</button>
      </div>
    </div>`;
}

/** Renders the child-group checkbox list used by both the add-form and the
 * edit-modal. `excludeParentId` lets the edit modal exclude the parent
 * being edited itself when checking "already in another parent". */
function renderChildGroupCheckboxesInto(container, checkedIds, excludeParentId) {
  const sellable = [...state.groups].filter((g) => !g.nonSellable).sort((a, b) => a.order - b.order);
  if (!sellable.length) {
    container.innerHTML = `<div class="field-hint">ابتدا گروه کالا تعریف کنید</div>`;
    return;
  }
  container.innerHTML = sellable
    .map((g) => {
      const checked = checkedIds.includes(g.id);
      const owningParent = state.parentGroups.find(
        (p) => p.id !== excludeParentId && (p.childGroupIds || []).includes(g.id)
      );
      const disabled = !!owningParent && !checked;
      return `
        <div class="checkbox-row">
          <input type="checkbox" id="pg-child-${g.id}" data-child-group-id="${g.id}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
          <label for="pg-child-${g.id}">${escapeHtml(g.name)}${g.sellByUnit ? ` <span class="badge badge-neutral">قوطی</span>` : ""}${disabled ? ` — قبلاً عضو گروه مادر «${escapeHtml(owningParent.name)}» است` : ""}</label>
        </div>`;
    })
    .join("");
}

function toggleParentGroupAddRow(show) {
  const row = $("#parent-group-add-row");
  row.style.display = show ? "block" : "none";
  if (show) {
    $("#new-parent-group-name").value = "";
    $("#parent-group-add-error").style.display = "none";
    renderChildGroupCheckboxesInto($("#parent-group-child-checkboxes"), [], null);
    $("#new-parent-group-name").focus();
  }
}

async function handleAddParentGroup() {
  const input = $("#new-parent-group-name");
  const errorEl = $("#parent-group-add-error");
  const name = normalizeStr(input.value);
  errorEl.style.display = "none";
  if (!name) {
    errorEl.textContent = "نام گروه مادر را وارد کنید.";
    errorEl.style.display = "block";
    return;
  }
  const duplicate = state.parentGroups.some((p) => p.name === name);
  if (duplicate) {
    errorEl.textContent = "⚠️ این گروه مادر قبلاً ثبت شده است.";
    errorEl.style.display = "block";
    return;
  }
  const childIds = $all("[data-child-group-id]:checked", $("#parent-group-child-checkboxes")).map((chk) =>
    Number(chk.dataset.childGroupId)
  );
  const consistency = validateChildSellByUnitConsistency(childIds);
  if (!consistency.ok) {
    errorEl.innerHTML = consistency.message;
    errorEl.style.display = "block";
    return;
  }
  const maxOrder = state.parentGroups.reduce((m, p) => Math.max(m, p.order), -1);
  const rec = { name, order: maxOrder + 1, childGroupIds: childIds, displayName: "" };
  const id = await Store.put("parentGroups", rec);
  rec.id = id;
  state.parentGroups.push(rec);
  toggleParentGroupAddRow(false);
  showToast("گروه مادر با موفقیت اضافه شد", "success");
  renderParentGroupsList();
  refreshAllGroupDependentUI();
}

function renderParentGroupsList() {
  const slot = $("#parent-groups-list-slot");
  if (!slot) return;
  if (!state.parentGroups.length) {
    slot.innerHTML = `
      <div class="empty-state">
        <div class="icon"><svg><use href="#icon-folder-plus"></use></svg></div>
        <div class="title">هنوز گروه مادری ثبت نشده است</div>
        <div>با دکمه «افزودن گروه مادر» شروع کنید</div>
      </div>`;
    return;
  }
  const sorted = [...state.parentGroups].sort((a, b) => a.order - b.order);
  slot.innerHTML = `<div class="order-list">${sorted
    .map((p, idx) => {
      const children = (p.childGroupIds || []).map((id) => groupById(id)).filter(Boolean);
      const childBadges = children.length
        ? children.map((g) => `<span class="badge badge-neutral">${escapeHtml(g.name)}</span>`).join(" ")
        : `<span class="field-hint">هنوز زیرگروهی انتخاب نشده</span>`;
      return `
      <div class="order-item order-item-wrap" data-parent-group-id="${p.id}">
        <span class="name" data-open-parent-group="${p.id}" style="cursor:pointer">${escapeHtml(p.name)}</span>
        <span class="count">${children.length} زیرگروه</span>
        <div class="move-btns">
          <button class="btn btn-icon btn-sm btn-secondary" data-parent-move="up" data-id="${p.id}" ${idx === 0 ? "disabled" : ""}><svg width="14" height="14"><use href="#icon-chevron-up"></use></svg></button>
          <button class="btn btn-icon btn-sm btn-secondary" data-parent-move="down" data-id="${p.id}" ${idx === sorted.length - 1 ? "disabled" : ""}><svg width="14" height="14"><use href="#icon-chevron-down"></use></svg></button>
        </div>
        <button class="btn btn-sm btn-secondary" data-open-parent-group="${p.id}"><svg width="15" height="15"><use href="#icon-edit"></use></svg> ویرایش</button>
        <button class="btn btn-icon btn-sm btn-danger" data-delete-parent-group="${p.id}"><svg width="15" height="15"><use href="#icon-trash"></use></svg></button>
        <div style="flex-basis:100%;margin-top:var(--space-2)">${childBadges}</div>
      </div>`;
    })
    .join("")}</div>`;

  $all("[data-open-parent-group]", slot).forEach((el) => {
    el.addEventListener("click", () => openParentGroupEditModal(Number(el.dataset.openParentGroup)));
  });
  $all("[data-delete-parent-group]", slot).forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteParentGroup(Number(btn.dataset.deleteParentGroup)));
  });
  $all("[data-parent-move]", slot).forEach((btn) => {
    btn.addEventListener("click", () => moveParentGroup(Number(btn.dataset.id), btn.dataset.parentMove));
  });
}

async function moveParentGroup(id, direction) {
  const sorted = [...state.parentGroups].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((p) => p.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sorted.length) return;
  const a = sorted[idx], b = sorted[swapIdx];
  const tmp = a.order; a.order = b.order; b.order = tmp;
  await Store.put("parentGroups", a);
  await Store.put("parentGroups", b);
  renderParentGroupsList();
}

function openParentGroupEditModal(id) {
  const parent = parentGroupById(id);
  if (!parent) return;
  const region = $("#modal-region");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-title">ویرایش گروه مادر</div>
      <div class="field" style="margin-top:var(--space-3)">
        <label>نام گروه مادر</label>
        <input type="text" id="pg-edit-name" value="${escapeHtml(parent.name)}" />
      </div>
      <div class="field">
        <label>نام نمایشی در گزارش (اختیاری)</label>
        <input type="text" id="pg-edit-display-name" value="${escapeHtml(parent.displayName || "")}" placeholder="در صورت خالی بودن، نام گروه مادر نمایش داده می‌شود" />
      </div>
      <div class="card-section-label" style="margin-top:var(--space-3)">زیرگروه‌ها</div>
      <div id="pg-edit-child-checkboxes"></div>
      <div class="field-error" id="pg-edit-error" style="display:none"></div>
      <div class="modal-actions" id="pg-edit-actions" style="margin-top:var(--space-5)"></div>
    </div>`;
  region.appendChild(overlay);
  renderChildGroupCheckboxesInto($("#pg-edit-child-checkboxes", overlay), parent.childGroupIds || [], parent.id);

  const actionsSlot = $("#pg-edit-actions", overlay);
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn-danger";
  deleteBtn.textContent = "حذف گروه مادر";
  deleteBtn.onclick = async () => {
    overlay.remove();
    await handleDeleteParentGroup(parent.id);
  };
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "انصراف";
  cancelBtn.onclick = () => overlay.remove();
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "ذخیره";
  saveBtn.onclick = async () => {
    const errorEl = $("#pg-edit-error", overlay);
    errorEl.style.display = "none";
    const name = normalizeStr($("#pg-edit-name", overlay).value);
    if (!name) {
      errorEl.textContent = "نام گروه مادر را وارد کنید.";
      errorEl.style.display = "block";
      return;
    }
    const duplicate = state.parentGroups.some((p) => p.id !== parent.id && p.name === name);
    if (duplicate) {
      errorEl.textContent = "⚠️ این گروه مادر قبلاً ثبت شده است.";
      errorEl.style.display = "block";
      return;
    }
    const childIds = $all("[data-child-group-id]:checked", $("#pg-edit-child-checkboxes", overlay)).map((chk) =>
      Number(chk.dataset.childGroupId)
    );
    const consistency = validateChildSellByUnitConsistency(childIds);
    if (!consistency.ok) {
      errorEl.innerHTML = consistency.message;
      errorEl.style.display = "block";
      return;
    }
    parent.name = name;
    parent.displayName = normalizeStr($("#pg-edit-display-name", overlay).value);
    parent.childGroupIds = childIds;
    await Store.put("parentGroups", parent);
    overlay.remove();
    showToast("گروه مادر ذخیره شد", "success");
    renderParentGroupsList();
    refreshAllGroupDependentUI();
  };
  actionsSlot.appendChild(deleteBtn);
  actionsSlot.appendChild(cancelBtn);
  actionsSlot.appendChild(saveBtn);
}

async function handleDeleteParentGroup(id) {
  const parent = parentGroupById(id);
  if (!parent) return;
  const ok = await confirmModal({
    icon: "alert-triangle",
    title: "حذف گروه مادر",
    body: `آیا از حذف گروه مادر «${escapeHtml(parent.name)}» مطمئن هستید؟ خودِ زیرگروه‌ها حذف نمی‌شوند، فقط گروه‌بندی‌شان لغو می‌شود.`,
    confirmLabel: "حذف گروه مادر",
    confirmClass: "btn-danger",
  });
  if (!ok) return;
  await Store.delete("parentGroups", id);
  state.parentGroups = state.parentGroups.filter((p) => p.id !== id);
  await removeParentFromLineReportItems(id);
  showToast("گروه مادر حذف شد", "success");
  renderParentGroupsList();
  refreshAllGroupDependentUI();
}

/** Removes any lineReportItems entry referencing parent group `parentId`,
 * and persists the cleanup. Used when a parent group is deleted. */
async function removeParentFromLineReportItems(parentId) {
  let changed = false;
  for (const lineKey of ["line1", "line2"]) {
    const before = state.lineReportItems[lineKey].length;
    state.lineReportItems[lineKey] = state.lineReportItems[lineKey].filter(
      (item) => !(item.type === "parent" && item.id === parentId)
    );
    if (state.lineReportItems[lineKey].length !== before) changed = true;
  }
  if (changed) await setSetting("lineReportItems", state.lineReportItems);
}

function openGroupProductsModal(groupId) {
  const group = groupById(groupId);
  if (!group) return;
  const region = $("#modal-region");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px">
      <div class="modal-title">${escapeHtml(group.name)}</div>
      <div class="card-subtitle" style="margin-bottom:var(--space-4)">تعداد کالا: ${productCountForGroup(groupId)}</div>
      <div class="search-input-wrap" style="margin-bottom:var(--space-4)">
        <input type="text" id="group-modal-search" placeholder="جستجوی کد کالا..." />
        <span class="icon"><svg><use href="#icon-search"></use></svg></span>
      </div>
      <div class="table-wrap" style="max-height:320px">
        <table class="data-table"><thead><tr><th>کد کالا</th><th class="num">تعداد در کارتن</th></tr></thead>
        <tbody id="group-modal-tbody"></tbody></table>
      </div>
      <div class="modal-actions" style="margin-top:var(--space-5)">
        <button class="btn btn-secondary" id="group-modal-close">بستن</button>
        <button class="btn btn-primary" id="group-modal-add">${icon("plus")} افزودن کالا به این گروه</button>
      </div>
    </div>`;
  region.appendChild(overlay);

  function renderRows(filter) {
    const rows = state.products
      .filter((p) => p.group === groupId)
      .filter((p) => !filter || p.code.toLowerCase().includes(filter.toLowerCase()));
    const tbody = $("#group-modal-tbody", overlay);
    tbody.innerHTML = rows.length
      ? rows.map((p) => `<tr><td>${escapeHtml(p.code)}</td><td class="num">${formatNumber(p.cartonQty)}</td></tr>`).join("")
      : `<tr><td colspan="2" style="text-align:center;color:var(--color-text-faint)">موردی یافت نشد</td></tr>`;
  }
  renderRows("");
  $("#group-modal-search", overlay).addEventListener("input", (e) => renderRows(e.target.value));
  $("#group-modal-close", overlay).addEventListener("click", () => overlay.remove());
  $("#group-modal-add", overlay).addEventListener("click", () => {
    overlay.remove();
    switchView("management");
    switchManagementTab("products");
    $all("#product-entry-tabs .tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.ptab === "manual"));
    $("#ptab-excel").style.display = "none";
    $("#ptab-manual").style.display = "";
    populateManualGroupSelect();
    $("#manual-product-group").value = String(groupId);
    $("#manual-product-code").focus();
  });
}

function refreshAllGroupDependentUI() {
  populateManualGroupSelect();
  renderLineGroupCheckboxes();
  populateSingleReportSelectors();
  renderParentGroupsList();
}

/* ---------------------------------------------------------
   7. PRODUCTS management (manual entry + Excel import + list)
   --------------------------------------------------------- */
function populateManualGroupSelect() {
  const sel = $("#manual-product-group");
  if (!sel) return;
  const sorted = [...state.groups].sort((a, b) => a.order - b.order);
  sel.innerHTML = sorted.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
  if (!sorted.length) sel.innerHTML = `<option value="">— ابتدا گروه کالا تعریف کنید —</option>`;
}

async function handleSaveManualProduct() {
  const codeInput = $("#manual-product-code");
  const groupSel = $("#manual-product-group");
  const cartonInput = $("#manual-product-carton");
  const errorSlot = $("#manual-product-error-slot");
  errorSlot.innerHTML = "";

  const code = normalizeStr(codeInput.value);
  const groupId = Number(groupSel.value);
  const carton = toPersianSafeNumber(cartonInput.value);

  if (!state.groups.length) {
    errorSlot.innerHTML = `<div class="field-error">ابتدا باید حداقل یک گروه کالا تعریف کنید.</div>`;
    return;
  }
  if (!code) {
    errorSlot.innerHTML = `<div class="field-error">کد کالا را وارد کنید.</div>`;
    return;
  }
  const existing = state.products.find((p) => p.code === code);
  if (existing) {
    errorSlot.innerHTML = `<div class="field-error">⚠️ این کد کالا قبلاً ثبت شده است.</div>`;
    return;
  }
  if (!groupId) {
    errorSlot.innerHTML = `<div class="field-error">گروه کالا را انتخاب کنید.</div>`;
    return;
  }
  if (isNaN(carton) || carton <= 0) {
    errorSlot.innerHTML = `<div class="field-error">تعداد در کارتن باید عددی بزرگ‌تر از صفر باشد.</div>`;
    return;
  }
  const rec = { code, group: groupId, cartonQty: carton };
  await Store.put("products", rec);
  state.products.push(rec);
  codeInput.value = "";
  cartonInput.value = "";
  showToast("کالا با موفقیت ذخیره شد", "success");
  renderProductsList();
  renderGroupsList();
}

function renderProductsList(filterText) {
  const slot = $("#products-table-slot");
  const sub = $("#products-count-sub");
  sub.textContent = `${state.products.length.toLocaleString("fa-IR")} کالا ثبت شده`;
  let list = state.products;
  if (filterText) {
    const f = filterText.toLowerCase();
    list = list.filter((p) => {
      const g = groupById(p.group);
      return p.code.toLowerCase().includes(f) || (g && g.name.toLowerCase().includes(f));
    });
  }
  if (!list.length) {
    slot.innerHTML = `<div class="empty-state"><div class="icon"><svg><use href="#icon-list"></use></svg></div><div class="title">موردی یافت نشد</div></div>`;
    return;
  }
  list = [...list].sort((a, b) => a.code.localeCompare(b.code, "en"));
  slot.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>کد کالا</th><th>گروه کالا</th><th class="num">تعداد در کارتن</th><th>عملیات</th></tr></thead>
        <tbody>
          ${list
            .map((p) => {
              const g = groupById(p.group);
              return `<tr>
                <td>${escapeHtml(p.code)}</td>
                <td>${g ? escapeHtml(g.name) : "—"}</td>
                <td class="num">${formatNumber(p.cartonQty)}</td>
                <td><button class="btn btn-icon btn-sm btn-danger" data-delete-product="${escapeHtml(p.code)}"><svg width="15" height="15"><use href="#icon-trash"></use></svg></button></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;
  $all("[data-delete-product]", slot).forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteProduct(btn.dataset.deleteProduct));
  });
}

async function handleDeleteProduct(code) {
  const ok = await confirmModal({
    icon: "trash",
    title: "حذف کالا",
    body: `آیا از حذف کد کالا «${escapeHtml(code)}» مطمئن هستید؟`,
    confirmLabel: "حذف کالا",
  });
  if (!ok) return;
  await Store.delete("products", code);
  state.products = state.products.filter((p) => p.code !== code);
  showToast("کالا حذف شد", "success");
  renderProductsList($("#products-search").value);
  renderGroupsList();
}

/* ----- Excel import for products ----- */
async function handleProductsFileSelected(file) {
  $("#products-file-status").textContent = "";
  $("#products-file-status").className = "file-drop-status";
  if (!file) return;
  let workbook;
  try {
    const buf = await file.arrayBuffer();
    workbook = readWorkbookSmart(buf);
  } catch (err) {
    showToast("خطا در خواندن فایل", "error");
    return;
  }
  const sheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];
  if (!ws || !ws["!ref"]) {
    showToast("فایل معتبر نیست", "error");
    return;
  }
  const rows = XLSX.utils.sheet_to_json(ws, { header: "A", raw: true, defval: "" });
  const dataRows = rows.slice(1); // skip header row

  let registered = 0, duplicate = 0, invalid = 0;
  let blankRows = 0, missingFieldRows = 0, undefinedGroupRows = 0, invalidCartonRows = 0;
  const undefinedGroups = new Set();
  const groupNameToId = new Map(state.groups.map((g) => [g.name, g.id]));
  const seenCodes = new Set(state.products.map((p) => p.code));

  for (const row of dataRows) {
    const code = normalizeStr(row.A);
    const groupName = normalizeStr(row.B);
    const cartonRaw = normalizeStr(row.C);
    const carton = toPersianSafeNumber(row.C);

    // Excel often applies formatting (borders/background) far below the
    // real data, which stretches the sheet's used range and produces
    // hundreds/thousands of phantom fully-empty rows. These are not real
    // import attempts, so they're skipped silently instead of counted.
    if (!code && !groupName && !cartonRaw) { blankRows++; continue; }

    if (!code || !groupName) { invalid++; missingFieldRows++; continue; }
    if (!groupNameToId.has(groupName)) { undefinedGroups.add(groupName); invalid++; undefinedGroupRows++; continue; }
    if (isNaN(carton) || carton <= 0) { invalid++; invalidCartonRows++; continue; }
    if (seenCodes.has(code)) { duplicate++; continue; }

    const rec = { code, group: groupNameToId.get(groupName), cartonQty: carton };
    await Store.put("products", rec);
    state.products.push(rec);
    seenCodes.add(code);
    registered++;
  }

  $("#products-file-status").textContent = "فایل بررسی شد";
  $("#products-file-status").className = "file-drop-status ok";
  renderProductsList();
  renderGroupsList();

  const reasonLines = [];
  if (missingFieldRows) reasonLines.push(`کد یا گروه کالا خالی: ${missingFieldRows.toLocaleString("fa-IR")} ردیف`);
  if (undefinedGroupRows) reasonLines.push(`گروه تعریف‌نشده: ${undefinedGroupRows.toLocaleString("fa-IR")} ردیف`);
  if (invalidCartonRows) reasonLines.push(`تعداد در کارتن نامعتبر (خالی، صفر یا منفی): ${invalidCartonRows.toLocaleString("fa-IR")} ردیف`);

  openModal({
    icon: registered > 0 ? "check-circle" : "alert-triangle",
    title: "نتیجه ورود کالا از Excel",
    body: `
      <div class="stack">
        <div class="row-between"><span>تعداد ثبت‌شده</span><span class="badge badge-success">${registered.toLocaleString("fa-IR")}</span></div>
        <div class="row-between"><span>تعداد تکراری</span><span class="badge badge-warning">${duplicate.toLocaleString("fa-IR")}</span></div>
        <div class="row-between"><span>تعداد نامعتبر</span><span class="badge badge-danger">${invalid.toLocaleString("fa-IR")}</span></div>
      </div>
      ${reasonLines.length ? `<div class="field-hint" style="margin-top:var(--space-4);text-align:right">علت نامعتبر بودن:<br>${reasonLines.join("<br>")}</div>` : ""}`,
    listItems: undefinedGroups.size
      ? [`گروه‌های تعریف‌نشده: ${Array.from(undefinedGroups).join("، ")}`]
      : null,
    actions: [{ label: "باشه", className: "btn-primary" }],
  });
}

/* ---------------------------------------------------------
   8. تعریف گزارش کلی — per-line item (group OR parent group)
   selection AND ordering
   --------------------------------------------------------- */
// Working (unsaved) order per line while the user is editing this screen.
// Each is an array of "item keys": "g<id>" for a real group, "p<id>" for a
// parent group — included items in the exact order they will appear in
// that line's report ("مجموع" is always appended last separately, never
// stored in this array).
const pendingLineOrder = { line1: [], line2: [] };

function itemKey(type, id) { return (type === "parent" ? "p" : "g") + id; }
function parseItemKey(key) {
  return { type: key[0] === "p" ? "parent" : "group", id: Number(key.slice(1)) };
}
/** Resolves an item key to its display name + record, for either type. */
function itemFromKey(key) {
  const { type, id } = parseItemKey(key);
  if (type === "parent") {
    const p = parentGroupById(id);
    return p ? { type, id, record: p, name: p.name } : null;
  }
  const g = groupById(id);
  return g ? { type, id, record: g, name: g.name } : null;
}

function initPendingLineOrder(lineKey) {
  // keep previously-saved order, drop any item that no longer exists or
  // (for real groups) has since been marked "غیرقابل فروش" (non-sellable
  // groups can never contribute to a report, so they don't belong here).
  const sellableIds = new Set(state.groups.filter((g) => !g.nonSellable).map((g) => g.id));
  pendingLineOrder[lineKey] = (state.lineReportItems[lineKey] || [])
    .filter((item) => (item.type === "group" ? sellableIds.has(item.id) : !!parentGroupById(item.id)))
    .map((item) => itemKey(item.type, item.id));
}

function renderLineGroupCheckboxes() {
  const globalSorted = [...state.groups].filter((g) => !g.nonSellable).sort((a, b) => a.order - b.order);
  const parentSorted = [...state.parentGroups].sort((a, b) => a.order - b.order);
  ["line1", "line2"].forEach((lineKey) => {
    initPendingLineOrder(lineKey);
    renderLineOrderList(lineKey, globalSorted, parentSorted);
  });
}

function renderLineOrderList(lineKey, globalSorted, parentSorted) {
  const slot = $(`#${lineKey}-groups-slot`);
  if (!slot) return;
  if (!globalSorted.length) {
    slot.innerHTML = `<div class="empty-state"><div class="icon"><svg><use href="#icon-box"></use></svg></div><div class="title">ابتدا گروه کالا تعریف کنید</div></div>`;
    return;
  }

  const selectedKeys = pendingLineOrder[lineKey];
  const selectedSet = new Set(selectedKeys);
  const selectedItems = selectedKeys.map((key) => itemFromKey(key)).filter(Boolean);
  const unselectedGroups = globalSorted.filter((g) => !selectedSet.has(itemKey("group", g.id)));
  const unselectedParents = parentSorted.filter((p) => !selectedSet.has(itemKey("parent", p.id)));

  const selectedHtml = selectedItems.length
    ? `<div class="order-list" data-line-order-list="${lineKey}">${selectedItems
        .map((it, idx) => {
          const isParent = it.type === "parent";
          const badge = isParent ? `<span class="badge badge-neutral">گروه مادر</span>` : "";
          return `
          <div class="order-item order-item-wrap" draggable="true" data-line="${lineKey}" data-item-key="${itemKey(it.type, it.id)}">
            <span class="drag-handle"><svg width="16" height="16"><use href="#icon-grip"></use></svg></span>
            <input type="checkbox" data-line-toggle="${lineKey}" data-item-key="${itemKey(it.type, it.id)}" checked />
            <span class="name">${escapeHtml(it.name)}</span>
            ${badge}
            <input type="text" class="group-display-name-input" data-item-key="${itemKey(it.type, it.id)}" value="${escapeHtml(it.record.displayName || "")}" placeholder="نام نمایشی در گزارش (اختیاری)" style="width:180px" />
            <div class="move-btns">
              <button class="btn btn-icon btn-sm btn-secondary" data-line-move="up" data-line="${lineKey}" data-item-key="${itemKey(it.type, it.id)}" ${idx === 0 ? "disabled" : ""}><svg width="14" height="14"><use href="#icon-chevron-up"></use></svg></button>
              <button class="btn btn-icon btn-sm btn-secondary" data-line-move="down" data-line="${lineKey}" data-item-key="${itemKey(it.type, it.id)}" ${idx === selectedItems.length - 1 ? "disabled" : ""}><svg width="14" height="14"><use href="#icon-chevron-down"></use></svg></button>
            </div>
          </div>`;
        })
        .join("")}
        <div class="order-item table-row-total" style="cursor:default">
          <span class="name">مجموع</span>
          <span class="count">همیشه آخرین ردیف گزارش</span>
        </div>
      </div>`
    : `<div class="field-hint" style="margin-bottom:var(--space-3)">هنوز گروهی برای این لاین انتخاب نشده است</div>`;

  const unselectedHtml = unselectedGroups.length || unselectedParents.length
    ? `<div class="card-section-label" style="margin-top:var(--space-4)">سایر گروه‌ها</div>
       ${unselectedGroups
         .map(
           (g) => `
        <div class="checkbox-row">
          <input type="checkbox" id="${lineKey}-chk-g${g.id}" data-line-toggle="${lineKey}" data-item-key="g${g.id}" />
          <label for="${lineKey}-chk-g${g.id}">${escapeHtml(g.name)}</label>
        </div>`
         )
         .join("")}
       ${unselectedParents
         .map(
           (p) => `
        <div class="checkbox-row">
          <input type="checkbox" id="${lineKey}-chk-p${p.id}" data-line-toggle="${lineKey}" data-item-key="p${p.id}" />
          <label for="${lineKey}-chk-p${p.id}">${escapeHtml(p.name)} <span class="badge badge-neutral">گروه مادر</span></label>
        </div>`
         )
         .join("")}`
    : "";

  slot.innerHTML = `
    <div class="field-hint" style="margin-bottom:var(--space-3)">با دستگیره ⠿ یا دکمه‌های بالا/پایین ترتیب نمایش گروه‌ها (و گروه‌های مادر) در گزارش این لاین را تعیین کنید. ردیف «مجموع» همیشه آخرین ردیف باقی می‌ماند. یک گروه و گروه مادرش را می‌توان هم‌زمان انتخاب کرد.</div>
    ${selectedHtml}
    ${unselectedHtml}`;

  // toggle include/exclude
  $all(`[data-line-toggle="${lineKey}"]`, slot).forEach((chk) => {
    chk.addEventListener("change", () => {
      const key = chk.dataset.itemKey;
      if (chk.checked) {
        if (!pendingLineOrder[lineKey].includes(key)) pendingLineOrder[lineKey].push(key);
      } else {
        pendingLineOrder[lineKey] = pendingLineOrder[lineKey].filter((k) => k !== key);
      }
      renderLineOrderList(lineKey, globalSorted, parentSorted);
    });
  });

  // up/down reordering
  $all(`[data-line-move]`, slot).forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.itemKey;
      const arr = pendingLineOrder[lineKey];
      const idx = arr.indexOf(key);
      const swapIdx = btn.dataset.lineMove === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || swapIdx < 0 || swapIdx >= arr.length) return;
      [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
      renderLineOrderList(lineKey, globalSorted, parentSorted);
    });
  });

  // drag & drop reordering
  let dragKey = null;
  $all(".order-item[draggable='true']", slot).forEach((item) => {
    item.addEventListener("dragstart", () => {
      dragKey = item.dataset.itemKey;
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
    item.addEventListener("dragover", (e) => e.preventDefault());
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const targetKey = item.dataset.itemKey;
      if (dragKey === null || dragKey === targetKey) return;
      const arr = pendingLineOrder[lineKey];
      const fromIdx = arr.indexOf(dragKey);
      const toIdx = arr.indexOf(targetKey);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      renderLineOrderList(lineKey, globalSorted, parentSorted);
    });
  });
}

async function handleSaveLineGroups(lineKey) {
  const items = pendingLineOrder[lineKey].map((key) => parseItemKey(key));
  state.lineReportItems[lineKey] = items;
  await setSetting("lineReportItems", state.lineReportItems);

  // derive lineGroups (real-group ids only, in the same relative order) for
  // اهداف ماهانه / گزارش فروش تا روز / تاریخچه فروش — unaffected by گروه مادر
  state.lineGroups[lineKey] = items.filter((it) => it.type === "group").map((it) => it.id);
  await setSetting("lineGroups", state.lineGroups);

  // persist any edited "نام نمایشی در گزارش" values for this line's items
  const slot = $(`#${lineKey}-groups-slot`);
  const nameInputs = slot ? $all(".group-display-name-input", slot) : [];
  for (const input of nameInputs) {
    const { type, id } = parseItemKey(input.dataset.itemKey);
    const record = type === "parent" ? parentGroupById(id) : groupById(id);
    if (!record) continue;
    const newName = input.value.trim();
    if ((record.displayName || "") !== newName) {
      record.displayName = newName;
      await Store.put(type === "parent" ? "parentGroups" : "groups", record);
    }
  }

  showToast(`تنظیمات ${lineKey === "line1" ? "لاین یک" : "لاین دو"} ذخیره شد`, "success");
  renderTargetsTab(); // group selection changed — target rows follow it
  renderBaselineTab(); // ditto — baseline rows follow the same group selection
}

/* ---------------------------------------------------------
   8b. اهداف ماهانه (Management > Targets tab) — SalesFlow نسخه ۲
   --------------------------------------------------------- */
function renderTargetsTab() {
  ["line1", "line2"].forEach((lineKey) => {
    const slot = $(`#targets-${lineKey}-slot`);
    if (!slot) return;
    const ids = state.lineGroups[lineKey] || [];
    const groups = ids.map((id) => groupById(id)).filter(Boolean);
    const targets = state.monthlyTargets[lineKey] || {};
    if (!groups.length) {
      slot.innerHTML = `<div class="empty-state"><div class="icon"><svg><use href="#icon-target"></use></svg></div><div class="title">ابتدا گروه‌های این لاین را در «تعریف گزارش کلی» انتخاب کنید</div></div>`;
      return;
    }
    slot.innerHTML = `
      <div class="order-list">
        ${groups
          .map(
            (g) => `
          <div class="order-item" style="cursor:default">
            <span class="name">${escapeHtml(g.name)}</span>
            <input type="number" min="0" step="1" class="target-input" data-target-group="${g.id}" data-target-line="${lineKey}"
              value="${targets[g.id] != null ? targets[g.id] : ""}" placeholder="هدف" style="width:120px" />
          </div>`
          )
          .join("")}
        <div class="order-item table-row-total" style="cursor:default">
          <span class="name">مجموع هدف ${lineKey === "line1" ? "لاین یک" : "لاین دو"}</span>
          <input type="number" min="0" step="1" id="target-total-${lineKey}" style="width:120px"
            value="${state.targetTotals[lineKey] != null ? state.targetTotals[lineKey] : ""}" placeholder="مجموع هدف" />
        </div>
      </div>`;
  });
}

async function handleSaveTargets(lineKey) {
  const slot = $(`#targets-${lineKey}-slot`);
  if (!slot) return;
  const newTargets = {};
  $all(`[data-target-line="${lineKey}"]`, slot).forEach((input) => {
    const gid = Number(input.dataset.targetGroup);
    const v = toPersianSafeNumber(input.value);
    if (!isNaN(v)) newTargets[gid] = v;
  });
  state.monthlyTargets[lineKey] = newTargets;
  await setSetting("monthlyTargets", state.monthlyTargets);

  const totalInput = $(`#target-total-${lineKey}`);
  const totalVal = toPersianSafeNumber(totalInput ? totalInput.value : "");
  state.targetTotals[lineKey] = isNaN(totalVal) ? 0 : totalVal;
  await setSetting("targetTotals", state.targetTotals);

  showToast(`اهداف ${lineKey === "line1" ? "لاین یک" : "لاین دو"} ذخیره شد`, "success");
}

/* ---------------------------------------------------------
   9. SETTINGS — columns, lines, appearance
   --------------------------------------------------------- */
function loadSettingsFormFromState() {
  $("#col-code").value = state.columnMap.code || "";
  $("#col-qty").value = state.columnMap.qty || "";
  $("#col-carton").value = state.columnMap.carton || "";
  $("#col-line").value = state.columnMap.line || "";
  $("#col-customer").value = state.columnMap.customer || "";
  $("#col-invoice").value = state.columnMap.invoice || "";
  $("#line1-excel-value").value = state.lines.line1.excelValue || "";
  $("#line2-excel-value").value = state.lines.line2.excelValue || "";
  $all("#font-size-tabs .tab-btn").forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.fontScale) === state.fontScale)
  );
}

async function handleSaveColumns() {
  const fields = {
    code: { input: $("#col-code"), label: "کد کالا" },
    qty: { input: $("#col-qty"), label: "تعداد فروش" },
    carton: { input: $("#col-carton"), label: "تعداد در کارتن" },
    line: { input: $("#col-line"), label: "لاین" },
    customer: { input: $("#col-customer"), label: "کد مشتری" },
    invoice: { input: $("#col-invoice"), label: "شماره پیش‌فاکتور" },
  };
  const errorSlot = $("#columns-error-slot");
  errorSlot.innerHTML = "";
  const errors = [];
  const newMap = {};
  Object.entries(fields).forEach(([key, f]) => {
    const v = normalizeStr(f.input.value).toUpperCase();
    if (!isValidColumnLetter(v)) errors.push(`ستون «${f.label}» باید یک حرف معتبر ستون Excel باشد (مثلاً C).`);
    newMap[key] = v;
  });
  if (errors.length) {
    errorSlot.innerHTML = errors.map((e) => `<div class="field-error">${escapeHtml(e)}</div>`).join("");
    return;
  }
  state.columnMap = newMap;
  await setSetting("columnMap", state.columnMap);
  showToast("تنظیمات ستون‌ها ذخیره شد", "success");
}

async function handleSaveLines() {
  const v1 = normalizeStr($("#line1-excel-value").value);
  const v2 = normalizeStr($("#line2-excel-value").value);
  if (!v1 || !v2) {
    showToast("مقدار دقیق Excel برای هر دو لاین باید وارد شود", "error");
    return;
  }
  state.lines.line1.excelValue = v1;
  state.lines.line2.excelValue = v2;
  await setSetting("lines", state.lines);
  showToast("تنظیمات لاین‌ها ذخیره شد", "success");
}

async function handleSetFontScale(scale) {
  state.fontScale = scale;
  document.documentElement.style.setProperty("--font-scale", String(scale));
  await setSetting("fontScale", scale);
  $all("#font-size-tabs .tab-btn").forEach((b) => b.classList.toggle("active", Number(b.dataset.fontScale) === scale));
}

/* ---------------------------------------------------------
   9c. تعداد فروشنده / نقطه شروع تجمعی / ظاهر گزارش — SalesFlow نسخه ۲
   --------------------------------------------------------- */
function loadSellersFormFromState() {
  $("#sellers-line1").value = state.sellersCount.line1 || "";
  $("#sellers-line2").value = state.sellersCount.line2 || "";
}
async function handleSaveSellers() {
  const v1 = toPersianSafeNumber($("#sellers-line1").value);
  const v2 = toPersianSafeNumber($("#sellers-line2").value);
  state.sellersCount = { line1: isNaN(v1) ? 0 : v1, line2: isNaN(v2) ? 0 : v2 };
  await setSetting("sellersCount", state.sellersCount);
  showToast("تعداد فروشنده هر لاین ذخیره شد", "success");
}

/* ---------------------------------------------------------
   9d. مدیریت › گزارش فروش تا روز — مبدأ تجمعی، به‌تفکیک گروه کالا
   --------------------------------------------------------- */
/** For prefilling the form: what the app currently computes as each line's
 * cumulative-through-yesterday (using whatever baseline + saved daily logs
 * already exist) — a convenient starting point the user can then edit. */
/** The most recent Shamsi date this line has an actual saved daily entry
 * for, or null if none yet — used to keep گزارش فروش تا روز showing live,
 * current totals without ever mutating the baseline itself (which stays a
 * fixed origin point, so editing/deleting an old day in تاریخچه always
 * recomputes correctly). */
async function getLatestSalesLogDate(line) {
  const all = await Store.getAll("salesLog");
  const dates = all.filter((e) => e.line === line).map((e) => e.date);
  if (!dates.length) return null;
  return dates.reduce((a, b) => (a > b ? a : b));
}

// Remembers, per line, which date the currently-DISPLAYED baseline numbers
// already account for (i.e. what computedThroughDate was used to fill the
// form). Saving with an empty date field falls back to this instead of a
// blank date — otherwise the live-computed (already history-inclusive)
// numbers get saved back with an empty date, which then sums that same
// history AGAIN on the next render, compounding higher on every save.
const lastBaselineComputedThroughDate = { line1: "", line2: "" };

async function renderBaselineTab() {
  for (const lineKey of ["line1", "line2"]) {
    const slot = $(`#baseline-${lineKey}-slot`);
    if (!slot) continue;
    const ids = state.lineGroups[lineKey] || [];
    const groups = ids.map((id) => groupById(id)).filter(Boolean);
    if (!groups.length) {
      slot.innerHTML = `<div class="empty-state"><div class="icon"><svg><use href="#icon-calendar"></use></svg></div><div class="title">ابتدا گروه‌های این لاین را در «تعریف گزارش کلی» انتخاب کنید</div></div>`;
      continue;
    }
    const b = state.monthBaseline[lineKey] || { date: "", amounts: {}, total: 0 };
    const latestLogged = await getLatestSalesLogDate(lineKey);
    let computedThroughDate = b.date || "";
    if (latestLogged && (!computedThroughDate || latestLogged > computedThroughDate)) computedThroughDate = latestLogged;
    if (!computedThroughDate) computedThroughDate = yesterdayJalaliStr();
    lastBaselineComputedThroughDate[lineKey] = computedThroughDate;
    const computed = await getMonthCumulativeRows(lineKey, computedThroughDate);
    slot.innerHTML = `
      <div class="field-hint" style="margin-bottom:var(--space-3)">
        این عدد‌ها همیشه خودکار «تا ${escapeHtml(toPersianDigits(computedThroughDate))}» به‌روز است — هر بار «ذخیره فروش روز» را در گزارش‌گیری بزنید، همین‌جا هم خودش جلو می‌رود. هر عددی را هم می‌توانید همین‌جا دستی اصلاح و ذخیره کنید (مثلاً برای شروع ماه جدید یا شروع از وسط ماه).
      </div>
      <div class="field" style="margin-bottom:var(--space-4)">
        <label>فروش تا تاریخ (خالی = همین «${escapeHtml(toPersianDigits(computedThroughDate))}» بالا در نظر گرفته می‌شود)</label>
        <input type="text" class="baseline-date-input" data-line="${lineKey}" placeholder="مثلاً 1405/05/24" value="${escapeHtml(b.date || "")}" />
      </div>
      <div class="row" style="margin-bottom:var(--space-4); flex-wrap:wrap">
        <button type="button" class="btn btn-secondary btn-sm" data-baseline-upload="${lineKey}">${icon("upload")} محاسبه خودکار از فایل اکسل (فروش از اول ماه تا تاریخ بالا)</button>
        <input type="file" class="baseline-file-input" data-line="${lineKey}" accept=".xlsx,.xls,.csv" style="display:none" />
        <span class="loading-row baseline-upload-loading" data-line="${lineKey}" style="display:none"><span class="spinner dark"></span> در حال محاسبه از فایل...</span>
      </div>
      <div class="field-hint" style="margin-bottom:var(--space-4)">قبل از آپلود، تاریخ بالا را دقیقاً به روزی تنظیم کن که گزارش اکسل تا همان‌جا را پوشش می‌دهد — وگرنه تاریخ «${escapeHtml(toPersianDigits(computedThroughDate))}» به‌طور پیش‌فرض در نظر گرفته می‌شود.</div>
      <div class="order-list">
        ${groups
          .map(
            (g) => `
          <div class="order-item" style="cursor:default">
            <span class="name">${escapeHtml(g.name)}</span>
            <input type="number" min="0" step="1" class="baseline-amount-input" data-line="${lineKey}" data-group="${g.id}"
              value="${computed.byGroup[g.id] != null ? computed.byGroup[g.id] : ""}" placeholder="فروش تا تاریخ" style="width:130px" />
          </div>`
          )
          .join("")}
        <div class="order-item table-row-total" style="cursor:default">
          <span class="name">مجموع فروش تا تاریخ — ${lineKey === "line1" ? "لاین یک" : "لاین دو"}</span>
          <input type="number" min="0" step="1" class="baseline-total-input" data-line="${lineKey}" style="width:130px"
            value="${computed.total != null ? computed.total : ""}" placeholder="مجموع" />
        </div>
      </div>
      <div class="row" style="margin-top: var(--space-4); flex-wrap:wrap">
        <button class="btn btn-primary" data-baseline-save="${lineKey}">${icon("save")} ذخیره — ${lineKey === "line1" ? "لاین یک" : "لاین دو"}</button>
        <button class="btn btn-secondary" data-baseline-clear="${lineKey}">${icon("trash")} شروع ماه جدید (صفر کردن)</button>
      </div>`;
  }

  $all("[data-baseline-save]").forEach((btn) => {
    btn.addEventListener("click", () => handleSaveBaselineLine(btn.dataset.baselineSave));
  });
  $all("[data-baseline-clear]").forEach((btn) => {
    btn.addEventListener("click", () => handleClearBaselineLine(btn.dataset.baselineClear));
  });
  $all("[data-baseline-upload]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lineKey = btn.dataset.baselineUpload;
      $(`.baseline-file-input[data-line="${lineKey}"]`).click();
    });
  });
  $all(".baseline-file-input").forEach((input) => {
    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) handleBaselineFileSelected(input.dataset.line, file);
      e.target.value = "";
    });
  });
}

/**
 * Lets the user upload a sales-report Excel file that already spans from
 * day 1 of the month through whatever date they want ("فروش تا تاریخ" above)
 * — instead of typing each group's cumulative total by hand. Runs the exact
 * same grouping/rounding logic used for the daily report
 * (computeSalesReport + buildLineReportRows) against the uploaded file,
 * scoped to this one line, and fills the form's number fields with the
 * result so the user only has to review and save.
 */
async function handleBaselineFileSelected(lineKey, file) {
  const btn = $(`[data-baseline-upload="${lineKey}"]`);
  const loadingEl = $(`.baseline-upload-loading[data-line="${lineKey}"]`);
  if (btn) btn.disabled = true;
  if (loadingEl) loadingEl.style.display = "inline-flex";
  try {
    const buf = await file.arrayBuffer();
    const workbook = readWorkbookFromArrayBuffer(buf);
    const info = getFirstSheetInfo(workbook);
    if (!info) { showToast("فایل معتبر نیست", "error"); return; }
    const valid = validateColumnsExist(info.range, state.columnMap);
    if (!valid.ok) { showToast(`ستون «${valid.field}» در این فایل پیدا نشد`, "error"); return; }
    if (!state.lines[lineKey]?.excelValue) {
      showToast("ابتدا مقدار دقیق این لاین را در تنظیمات وارد کنید", "error");
      return;
    }
    const productMap = new Map(state.products.map((p) => [p.code, p]));
    const groupsById = new Map(state.groups.map((g) => [g.id, g]));
    const { line1, line2 } = computeSalesReport(info.rows, state.columnMap, state.lines, productMap, groupsById);
    const lineResult = lineKey === "line1" ? line1 : line2;
    // گزارش فروش تا روز همیشه بر پایه گروه‌های واقعی است (نه گروه مادر) —
    // چون amounts در این تب به‌ازای هر گروه واقعی ذخیره می‌شود.
    const built = buildLineReportRows(
      lineResult.groupSumsDisplay,
      lineResult.groupSumsCartonEquivalent,
      (state.lineGroups[lineKey] || []).map((id) => ({ type: "group", id }))
    );

    const slot = $(`#baseline-${lineKey}-slot`);
    built.rows.forEach((r) => {
      const input = $(`.baseline-amount-input[data-group="${r.groupId}"]`, slot);
      if (input) input.value = r.rounded;
    });
    const totalInput = $(".baseline-total-input", slot);
    if (totalInput) totalInput.value = built.totalRounded;
    showToast("مقادیر از فایل محاسبه شد — بررسی کنید و «ذخیره» بزنید", "success");
  } catch (err) {
    showToast("خطا در خواندن یا پردازش فایل", "error");
  } finally {
    if (btn) btn.disabled = false;
    if (loadingEl) loadingEl.style.display = "none";
  }
}

async function handleSaveBaselineLine(lineKey) {
  const slot = $(`#baseline-${lineKey}-slot`);
  if (!slot) return;
  const dateInput = $(".baseline-date-input", slot);
  let date = normalizeStr(dateInput ? dateInput.value : "");
  if (date && !/^\d{4}\/\d{2}\/\d{2}$/.test(date)) {
    showToast("فرمت تاریخ باید مثل 1405/05/24 باشد", "error");
    return;
  }
  // an empty date field means "save what's shown, as of the date it's
  // already computed through" — NOT "start counting from day 1 again"
  // (that would double-count this line's own logged history on every save).
  if (!date) date = lastBaselineComputedThroughDate[lineKey] || yesterdayJalaliStr();

  // Safety check: if that exact day was ALSO logged separately (via ذخیره
  // فروش روز), saving "تا همین تاریخ" here means that day is treated as
  // already baked into these numbers and won't be added again on top — if
  // the numbers being saved don't actually include that day, its sale
  // silently vanishes from every future total. Confirm first.
  const existingSameDayEntry = await Store.get("salesLog", `${date}__${lineKey}`);
  if (existingSameDayEntry) {
    const ok = await confirmModal({
      icon: "alert-triangle",
      title: "این تاریخ قبلاً جداگانه ثبت شده",
      body: `فروش روز ${toPersianDigits(date)} (${lineKey === "line1" ? "لاین یک" : "لاین دو"}) از قبل جداگانه در تاریخچه ذخیره شده (مجموع همان روز: ${toPersianDigits(formatNumber(existingSameDayEntry.totalToday))}). با ذخیره «فروش تا ${toPersianDigits(date)}» در همین‌جا، فرض بر این است که فروش همین روز از قبل داخل همین اعداد حساب شده — دیگر جداگانه رویش اضافه نمی‌شود. مطمئن شو مقادیری که الان وارد کردی واقعاً شامل فروش همان روز هم هست؛ اگر نیست، تاریخ را یک روز قبل‌تر بگذار تا آن روز جداگانه و درست جمع بزند.`,
      confirmLabel: "می‌دانم، ذخیره کن",
      confirmClass: "btn-primary",
    });
    if (!ok) return;
  }

  const amounts = {};
  $all(".baseline-amount-input", slot).forEach((input) => {
    const gid = Number(input.dataset.group);
    const v = toPersianSafeNumber(input.value);
    if (!isNaN(v)) amounts[gid] = v;
  });
  const totalInput = $(".baseline-total-input", slot);
  const total = toPersianSafeNumber(totalInput ? totalInput.value : "");
  state.monthBaseline[lineKey] = { date, amounts, total: isNaN(total) ? 0 : total };
  await setSetting("monthBaseline", state.monthBaseline);
  showToast(`گزارش فروش تا روز — ${lineKey === "line1" ? "لاین یک" : "لاین دو"} ذخیره شد`, "success");
  renderBaselineTab();
}

async function handleClearBaselineLine(lineKey) {
  // pin the reset to TODAY (not an empty date) so it actually reads as zero —
  // an empty date sums this month's existing log history back on top, which
  // defeats the point of a manual reset.
  const todayStr = jalaliToStr(...todayJalali());
  state.monthBaseline[lineKey] = { date: todayStr, amounts: {}, total: 0 };
  await setSetting("monthBaseline", state.monthBaseline);
  showToast(`${lineKey === "line1" ? "لاین یک" : "لاین دو"} صفر شد (از امروز به بعد دوباره جمع می‌زند)`, "success");
  renderBaselineTab();
}

/* ---------------------------------------------------------
   9e. مدیریت › تاریخچه فروش — مشاهده/اصلاح/حذف هر روز ذخیره‌شده
   --------------------------------------------------------- */
async function renderHistoryTab() {
  for (const lineKey of ["line1", "line2"]) {
    const slot = $(`#history-${lineKey}-slot`);
    if (!slot) continue;
    const all = await Store.getAll("salesLog");
    const entries = all.filter((e) => e.line === lineKey).sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!entries.length) {
      slot.innerHTML = `<div class="empty-state"><div class="icon"><svg><use href="#icon-calendar"></use></svg></div><div class="title">هنوز هیچ روزی ذخیره نشده</div></div>`;
      continue;
    }
    const sumLogged = entries.reduce((s, e) => s + (e.totalToday || 0), 0);
    const summaryHtml = `<div class="history-summary">مجموع فروش ${toPersianDigits(entries.length)} روز ثبت‌شده: <strong>${toPersianDigits(formatNumber(sumLogged))}</strong></div>`;
    slot.innerHTML = summaryHtml + entries
      .map((e) => {
        const safeId = e.date.replace(/\//g, "-");
        return `
        <div class="history-entry" data-history-line="${lineKey}" data-history-date="${e.date}">
          <div class="history-entry-row">
            <span class="history-entry-date">${toPersianDigits(e.date)}</span>
            <span class="history-entry-total">مجموع فروش این روز: <strong>${toPersianDigits(formatNumber(e.totalToday))}</strong></span>
            <button type="button" class="btn btn-icon btn-sm btn-secondary" data-history-toggle="${lineKey}-${safeId}" title="مشاهده/اصلاح">
              <svg width="16" height="16"><use href="#icon-edit"></use></svg>
            </button>
            <button type="button" class="btn btn-icon btn-sm btn-secondary" data-history-delete="${lineKey}" data-history-delete-date="${e.date}" title="حذف">
              <svg width="16" height="16"><use href="#icon-trash"></use></svg>
            </button>
          </div>
          <div class="history-entry-detail" id="history-detail-${lineKey}-${safeId}" style="display:none"></div>
        </div>`;
      })
      .join("");
  }

  $all("[data-history-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggleHistoryDetail(btn.dataset.historyToggle));
  });
  $all("[data-history-delete]").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteHistoryEntry(btn.dataset.historyDelete, btn.dataset.historyDeleteDate));
  });
}

function toggleHistoryDetail(key) {
  const [lineKey, ...dateParts] = key.split("-");
  const detail = $(`#history-detail-${key}`);
  if (!detail) return;
  const isOpen = detail.style.display !== "none";
  if (isOpen) { detail.style.display = "none"; detail.innerHTML = ""; return; }
  const dateStr = dateParts.join("-").replace(/-/g, "/");
  renderHistoryDetailForm(lineKey, dateStr, detail);
  detail.style.display = "block";
}

async function renderHistoryDetailForm(lineKey, dateStr, container) {
  const entry = await Store.get("salesLog", `${dateStr}__${lineKey}`);
  if (!entry) { container.innerHTML = `<div class="field-hint">این روز پیدا نشد</div>`; return; }
  const groups = entry.rows.map((r) => ({ ...r, group: groupById(r.groupId) })).filter((r) => r.group);
  container.innerHTML = `
    <div class="order-list">
      ${groups
        .map(
          (r) => `
        <div class="order-item" style="cursor:default">
          <span class="name">${escapeHtml(r.group.displayName || r.group.name)}</span>
          <input type="number" min="0" step="1" class="history-edit-input" data-group="${r.groupId}" value="${r.todaySale}" style="width:120px" />
        </div>`
        )
        .join("")}
    </div>
    <div class="row" style="margin-top:var(--space-3)">
      <button type="button" class="btn btn-primary btn-sm" data-history-save-line="${lineKey}" data-history-save-date="${dateStr}">${icon("save")} ذخیره اصلاحات این روز</button>
    </div>`;
  $("[data-history-save-line]", container).addEventListener("click", () => handleSaveHistoryEdit(lineKey, dateStr, container));
}

async function handleSaveHistoryEdit(lineKey, dateStr, container) {
  const entry = await Store.get("salesLog", `${dateStr}__${lineKey}`);
  if (!entry) return;
  const newRows = entry.rows.map((r) => {
    const input = $(`.history-edit-input[data-group="${r.groupId}"]`, container);
    const v = input ? toPersianSafeNumber(input.value) : r.todaySale;
    return { groupId: r.groupId, todaySale: isNaN(v) ? r.todaySale : v };
  });
  const newTotal = newRows.reduce((s, r) => s + (r.todaySale || 0), 0);
  await saveDailySaleFull(dateStr, lineKey, newRows, newTotal);
  showToast(`اصلاحات روز ${toPersianDigits(dateStr)} ذخیره شد`, "success");
  renderHistoryTab();
  renderBaselineTab();
}

async function handleDeleteHistoryEntry(lineKey, dateStr) {
  const ok = await confirmModal({
    icon: "trash",
    title: "حذف این روز؟",
    body: `فروش ثبت‌شده برای ${toPersianDigits(dateStr)} (${lineKey === "line1" ? "لاین یک" : "لاین دو"}) کاملاً حذف می‌شود و دیگر در هیچ محاسبه‌ای شمرده نخواهد شد.`,
    confirmLabel: "حذف کن",
  });
  if (!ok) return;
  const rec = await Store.get("salesLog", `${dateStr}__${lineKey}`);
  if (rec) await Store.delete("salesLog", rec.id);
  showToast(`فروش روز ${toPersianDigits(dateStr)} حذف شد`, "success");
  renderHistoryTab();
  renderBaselineTab();
}

/** Field definitions for the "colors" part of the report-appearance form —
 * column widths, row heights and per-section fonts are built separately
 * (see renderReportStyleForm) since they don't fit the flat key->color
 * shape of these fields. */
const REPORT_STYLE_COLOR_FIELDS = [
  { key: "dateCellBg", label: "پس‌زمینه سلول تاریخ" },
  { key: "dateCellText", label: "متن سلول تاریخ" },
  { key: "titleCellBg", label: "پس‌زمینه عنوان گزارش" },
  { key: "titleCellText", label: "متن عنوان گزارش" },
  { key: "headerRowBg", label: "پس‌زمینه هدر ستون‌ها" },
  { key: "headerRowText", label: "متن هدر ستون‌ها" },
  { key: "dataRowBg", label: "پس‌زمینه ردیف‌های داده" },
  { key: "dataRowText", label: "متن ردیف‌های داده" },
  { key: "totalRowBg", label: "پس‌زمینه ردیف کل محصولات" },
  { key: "totalRowText", label: "متن ردیف کل محصولات" },
  { key: "spacerBg", label: "رنگ نوار آبی خالی" },
  { key: "remainingPositiveText", label: "متن «مانده» مثبت" },
  { key: "remainingNegativeText", label: "متن «مانده» منفی" },
  { key: "footerCustomerBg", label: "پس‌زمینه تعداد مشتری" },
  { key: "footerCustomerText", label: "متن تعداد مشتری" },
  { key: "footerPerRepBg", label: "پس‌زمینه سرانه مشتری" },
  { key: "footerPerRepText", label: "متن سرانه مشتری" },
  { key: "footerInvalidBg", label: "پس‌زمینه درصد ابطال" },
  { key: "footerInvalidText", label: "متن درصد ابطال" },
  { key: "borderColor", label: "رنگ خطوط جدول" },
];
const FONT_FAMILY_OPTIONS = [
  ["Vazirmatn", "وزیرمتن"],
  ["Tahoma, sans-serif", "Tahoma"],
  ["'Segoe UI', sans-serif", "Segoe UI"],
  ["'B Mitra', Tahoma, sans-serif", "B Mitra"],
  ["Calibri, sans-serif", "Calibri"],
];
const ROW_HEIGHT_LABELS = { title: "ارتفاع ردیف عنوان", header: "ارتفاع ردیف هدر", data: "ارتفاع ردیف‌های داده", total: "ارتفاع ردیف کل", spacer: "ارتفاع نوار آبی خالی", footer: "ارتفاع ردیف پایین" };
const FONT_SECTION_LABELS = [
  { sizeKey: "titleSize", familyKey: "titleFontFamily", boldKey: "titleBold", label: "عنوان اصلی" },
  { sizeKey: "headerSize", familyKey: "headerFontFamily", boldKey: "headerBold", label: "هدر ستون‌ها" },
  { sizeKey: "bodySize", familyKey: "bodyFontFamily", boldKey: null, label: "محتوای جدول (بولد هر ستون پایین‌تر تنظیم می‌شود)" },
  { sizeKey: "footerSize", familyKey: "footerFontFamily", boldKey: "footerBold", label: "ردیف پایین" },
];
const ALIGN_OPTIONS = [["right", "راست‌چین"], ["center", "وسط‌چین"], ["left", "چپ‌چین"]];

// Pending (not-yet-saved) reorder state for the two draggable lists in the
// report-style form — mutated by drag/up-down, read by collectReportStyleFormValues.
let pendingColumnOrder = null;
let pendingFooterOrder = null;

function renderReportStyleForm() {
  const slot = $("#report-style-form-slot");
  if (!slot) return;
  const S = state.reportStyle;
  pendingColumnOrder = [...S.columnOrder];
  pendingFooterOrder = [...S.footerOrder];
  slot.innerHTML = `
    <div class="field-hint" style="margin-bottom:var(--space-3)">هر تغییری اینجا فقط روی همین دو تصویر گزارش کامل روز اثر می‌گذارد؛ برای دیدن نتیجه بدون ذخیره‌کردن، از «به‌روزرسانی پیش‌نمایش» استفاده کنید.</div>

    <div class="report-image-wrap" id="style-preview-wrap" style="margin-bottom:var(--space-3);background:var(--color-surface-alt);border-radius:var(--radius-md);padding:var(--space-3)">
      <span class="loading-row"><span class="spinner dark"></span> در حال ساخت پیش‌نمایش...</span>
    </div>
    <div class="row" style="margin-bottom:var(--space-5)">
      <button type="button" class="btn btn-secondary btn-sm" id="btn-preview-report-style">${icon("image")} به‌روزرسانی پیش‌نمایش</button>
    </div>

    <div class="settings-subhead">عنوان و تاریخ</div>
    <div class="form-grid">
      <div class="field"><label>متن عنوان (${"{line}"} با «لاین یک/لاین دو» جایگزین می‌شود)</label>
        <input type="text" class="style-input" data-style-key="titleTemplate" value="${escapeHtml(S.titleTemplate)}" /></div>
      <div class="field"><label>متن تاریخ (${"{date}"} با تاریخ گزارش جایگزین می‌شود)</label>
        <input type="text" class="style-input" data-style-key="dateTemplate" value="${escapeHtml(S.dateTemplate)}" /></div>
    </div>

    <div class="settings-subhead">فونت هر بخش</div>
    <div class="form-grid">
      ${FONT_SECTION_LABELS.map(
        (f) => `
        <div class="field">
          <label>فونت ${escapeHtml(f.label)}</label>
          <select class="style-input" data-style-key="${f.familyKey}">
            ${FONT_FAMILY_OPTIONS.map(([v, l]) => `<option value="${escapeHtml(v)}" ${v === S[f.familyKey] ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>سایز ${escapeHtml(f.label)} (px)</label>
          <input type="number" class="style-input" data-style-key="${f.sizeKey}" min="8" max="60" value="${S[f.sizeKey]}" />
        </div>
        ${f.boldKey ? `
        <div class="field" style="justify-content:flex-end">
          <label class="checkbox-label"><input type="checkbox" class="style-input-bold" data-style-key="${f.boldKey}" ${S[f.boldKey] ? "checked" : ""} /> بولد باشد</label>
        </div>` : ""}`
      ).join("")}
    </div>

    <div class="settings-subhead">اندازه کلی تصویر و خطوط</div>
    <div class="form-grid">
      <div class="field"><label>عرض کل تصویر (px)</label>
        <input type="number" class="style-input" data-style-key="imageWidth" min="300" max="1400" value="${S.imageWidth}" /></div>
      <div class="field"><label>ضخامت خط جدول (px)</label>
        <input type="number" class="style-input" data-style-key="borderWidth" min="0.5" max="6" step="0.5" value="${S.borderWidth}" /></div>
      <div class="field"><label>تعداد ستون زیر سلول تاریخ</label>
        <input type="number" class="style-input" data-style-key="dateCellSpan" min="1" max="4" value="${S.dateCellSpan}" /></div>
    </div>

    <div class="settings-subhead">ستون‌های جدول — ترتیب، برچسب، عرض، چینش، بولد و رنگ پس‌زمینه</div>
    <div class="field-hint" style="margin-bottom:var(--space-3)">با دستگیره یا دکمه‌های بالا/پایین ترتیب نمایش (راست به چپ) را عوض کنید؛ برچسب، عرض، چینش متن، بولد و رنگ پس‌زمینه اختصاصی هر ستون هم قابل ویرایش است (هم برای هدر و هم برای ردیف‌های داده و جمع همان ستون — مثلاً ستون «کالا» از شوینده تا مجموع).</div>
    <div id="column-order-slot"></div>

    <div class="settings-subhead">ردیف پایین (مشتری/سرانه/ابطالی) — ترتیب، برچسب و عرض</div>
    <div id="footer-order-slot"></div>

    <div class="settings-subhead">ارتفاع ردیف‌ها (px)</div>
    <div class="form-grid">
      ${Object.keys(ROW_HEIGHT_LABELS).map(
        (k) => `
        <div class="field">
          <label>${escapeHtml(ROW_HEIGHT_LABELS[k])}</label>
          <input type="number" class="style-input-rowh" data-row-key="${k}" min="4" max="120" value="${S.rowHeights[k]}" />
        </div>`
      ).join("")}
    </div>

    <div class="settings-subhead">رنگ‌ها</div>
    <div class="form-grid">
      ${REPORT_STYLE_COLOR_FIELDS.map(
        (f) => `
        <div class="field"><label>${escapeHtml(f.label)}</label>
          <input type="color" class="style-input" data-style-key="${f.key}" value="${S[f.key]}" style="height:42px;padding:4px" /></div>`
      ).join("")}
    </div>`;

  renderColumnOrderList();
  renderFooterOrderList();
  $("#btn-preview-report-style", slot).addEventListener("click", () => renderReportStylePreview(collectReportStyleFormValues()));
  renderReportStylePreview(S); // initial preview using the saved style
}

/** Renders the draggable/reorderable list of the 5 table columns, each row
 * carrying its own editable label text + relative width, inside
 * #column-order-slot. Reordering only touches `pendingColumnOrder` (kept in
 * sync with the form) — nothing is saved until «ذخیره ظاهر گزارش». */
function renderColumnOrderList() {
  const slot = $("#column-order-slot");
  if (!slot) return;
  const S = state.reportStyle;
  slot.innerHTML = `<div class="order-list">${pendingColumnOrder
    .map(
      (key, idx) => `
      <div class="order-item order-item-wrap" draggable="true" data-col-key="${key}">
        <span class="drag-handle"><svg width="16" height="16"><use href="#icon-grip"></use></svg></span>
        <input type="text" class="style-input-collabel" data-col-key="${key}" value="${escapeHtml(S.columnLabels[key])}" style="flex:1;min-width:90px" />
        <select class="style-input-colalign" data-col-key="${key}" style="width:100px" title="چینش متن">
          ${ALIGN_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === S.columnAlign[key] ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}
        </select>
        <input type="number" class="style-input-colw" data-col-key="${key}" min="1" value="${S.columnWeights[key]}" style="width:64px" title="عرض نسبی" />
        <label class="checkbox-label" style="white-space:nowrap"><input type="checkbox" class="style-input-colbold" data-col-key="${key}" ${S.columnBold[key] ? "checked" : ""} /> بولد</label>
        <label class="checkbox-label" style="white-space:nowrap"><input type="checkbox" class="style-input-colbgenabled" data-col-key="${key}" ${S.columnBgEnabled[key] ? "checked" : ""} /> رنگ اختصاصی</label>
        <input type="color" class="style-input-colbg" data-col-key="${key}" value="${S.columnBg[key]}" style="width:44px;height:36px;padding:2px" title="رنگ پس‌زمینه این ستون (وقتی «رنگ اختصاصی» فعال باشد)" />
        <div class="move-btns">
          <button type="button" class="btn btn-icon btn-sm btn-secondary" data-col-move="up" data-col-key="${key}" ${idx === 0 ? "disabled" : ""}><svg width="14" height="14"><use href="#icon-chevron-up"></use></svg></button>
          <button type="button" class="btn btn-icon btn-sm btn-secondary" data-col-move="down" data-col-key="${key}" ${idx === pendingColumnOrder.length - 1 ? "disabled" : ""}><svg width="14" height="14"><use href="#icon-chevron-down"></use></svg></button>
        </div>
      </div>`
    )
    .join("")}</div>`;

  $all("[data-col-move]", slot).forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.colKey;
      const idx = pendingColumnOrder.indexOf(key);
      const swapIdx = btn.dataset.colMove === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || swapIdx < 0 || swapIdx >= pendingColumnOrder.length) return;
      [pendingColumnOrder[idx], pendingColumnOrder[swapIdx]] = [pendingColumnOrder[swapIdx], pendingColumnOrder[idx]];
      const draft = collectReportStyleFormValues();
      renderColumnOrderList();
      renderReportStylePreview(draft);
    });
  });
  let dragKey = null;
  $all(".order-item[draggable='true']", slot).forEach((item) => {
    item.addEventListener("dragstart", () => { dragKey = item.dataset.colKey; item.classList.add("dragging"); });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
    item.addEventListener("dragover", (e) => e.preventDefault());
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const targetKey = item.dataset.colKey;
      if (!dragKey || dragKey === targetKey) return;
      const fromIdx = pendingColumnOrder.indexOf(dragKey);
      const toIdx = pendingColumnOrder.indexOf(targetKey);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = pendingColumnOrder.splice(fromIdx, 1);
      pendingColumnOrder.splice(toIdx, 0, moved);
      const draft = collectReportStyleFormValues();
      renderColumnOrderList();
      renderReportStylePreview(draft);
    });
  });
}

/** Same idea as renderColumnOrderList but for the 3 footer stat cells
 * (تعداد مشتری / سرانه / درصد ابطالی). */
function renderFooterOrderList() {
  const slot = $("#footer-order-slot");
  if (!slot) return;
  const S = state.reportStyle;
  slot.innerHTML = `<div class="order-list">${pendingFooterOrder
    .map(
      (key, idx) => `
      <div class="order-item" draggable="true" data-foot-key="${key}">
        <span class="drag-handle"><svg width="16" height="16"><use href="#icon-grip"></use></svg></span>
        <input type="text" class="style-input-footlabel" data-foot-key="${key}" value="${escapeHtml(S.footerLabels[key])}" style="flex:1;min-width:0" />
        <input type="number" class="style-input-footw" data-foot-key="${key}" min="1" value="${S.footerWeights[key]}" style="width:70px" title="عرض نسبی" />
        <div class="move-btns">
          <button type="button" class="btn btn-icon btn-sm btn-secondary" data-foot-move="up" data-foot-key="${key}" ${idx === 0 ? "disabled" : ""}><svg width="14" height="14"><use href="#icon-chevron-up"></use></svg></button>
          <button type="button" class="btn btn-icon btn-sm btn-secondary" data-foot-move="down" data-foot-key="${key}" ${idx === pendingFooterOrder.length - 1 ? "disabled" : ""}><svg width="14" height="14"><use href="#icon-chevron-down"></use></svg></button>
        </div>
      </div>`
    )
    .join("")}</div>`;

  $all("[data-foot-move]", slot).forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.footKey;
      const idx = pendingFooterOrder.indexOf(key);
      const swapIdx = btn.dataset.footMove === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || swapIdx < 0 || swapIdx >= pendingFooterOrder.length) return;
      [pendingFooterOrder[idx], pendingFooterOrder[swapIdx]] = [pendingFooterOrder[swapIdx], pendingFooterOrder[idx]];
      const draft = collectReportStyleFormValues();
      renderFooterOrderList();
      renderReportStylePreview(draft);
    });
  });
  let dragKey = null;
  $all(".order-item[draggable='true']", slot).forEach((item) => {
    item.addEventListener("dragstart", () => { dragKey = item.dataset.footKey; item.classList.add("dragging"); });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
    item.addEventListener("dragover", (e) => e.preventDefault());
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const targetKey = item.dataset.footKey;
      if (!dragKey || dragKey === targetKey) return;
      const fromIdx = pendingFooterOrder.indexOf(dragKey);
      const toIdx = pendingFooterOrder.indexOf(targetKey);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = pendingFooterOrder.splice(fromIdx, 1);
      pendingFooterOrder.splice(toIdx, 0, moved);
      const draft = collectReportStyleFormValues();
      renderFooterOrderList();
      renderReportStylePreview(draft);
    });
  });
}

/** Reads the current (unsaved) values out of the settings form and returns
 * a full reportStyle object — used both by the live preview and by Save. */
function collectReportStyleFormValues() {
  const slot = $("#report-style-form-slot");
  const s = { ...state.reportStyle };
  $all(".style-input", slot).forEach((input) => {
    const key = input.dataset.styleKey;
    const isNumberField = key.endsWith("Size") || key === "imageWidth" || key === "borderWidth" || key === "dateCellSpan";
    s[key] = isNumberField ? Number(input.value) || state.reportStyle[key] : input.value;
  });
  $all(".style-input-bold", slot).forEach((input) => {
    s[input.dataset.styleKey] = input.checked;
  });

  s.columnOrder = [...pendingColumnOrder];
  const columnWeights = { ...state.reportStyle.columnWeights };
  const columnLabels = { ...state.reportStyle.columnLabels };
  const columnAlign = { ...state.reportStyle.columnAlign };
  const columnBold = { ...state.reportStyle.columnBold };
  const columnBgEnabled = { ...state.reportStyle.columnBgEnabled };
  const columnBg = { ...state.reportStyle.columnBg };
  $all(".style-input-colw", slot).forEach((input) => {
    const v = Number(input.value);
    if (v > 0) columnWeights[input.dataset.colKey] = v;
  });
  $all(".style-input-collabel", slot).forEach((input) => {
    if (input.value.trim()) columnLabels[input.dataset.colKey] = input.value.trim();
  });
  $all(".style-input-colalign", slot).forEach((input) => {
    columnAlign[input.dataset.colKey] = input.value;
  });
  $all(".style-input-colbold", slot).forEach((input) => {
    columnBold[input.dataset.colKey] = input.checked;
  });
  $all(".style-input-colbgenabled", slot).forEach((input) => {
    columnBgEnabled[input.dataset.colKey] = input.checked;
  });
  $all(".style-input-colbg", slot).forEach((input) => {
    columnBg[input.dataset.colKey] = input.value;
  });
  s.columnWeights = columnWeights;
  s.columnLabels = columnLabels;
  s.columnAlign = columnAlign;
  s.columnBold = columnBold;
  s.columnBgEnabled = columnBgEnabled;
  s.columnBg = columnBg;

  s.footerOrder = [...pendingFooterOrder];
  const footerWeights = { ...state.reportStyle.footerWeights };
  const footerLabels = { ...state.reportStyle.footerLabels };
  $all(".style-input-footw", slot).forEach((input) => {
    const v = Number(input.value);
    if (v > 0) footerWeights[input.dataset.footKey] = v;
  });
  $all(".style-input-footlabel", slot).forEach((input) => {
    if (input.value.trim()) footerLabels[input.dataset.footKey] = input.value.trim();
  });
  s.footerWeights = footerWeights;
  s.footerLabels = footerLabels;

  const rowHeights = { ...state.reportStyle.rowHeights };
  $all(".style-input-rowh", slot).forEach((input) => {
    const k = input.dataset.rowKey;
    const v = Number(input.value);
    if (v > 0) rowHeights[k] = v;
  });
  s.rowHeights = rowHeights;
  return s;
}

async function renderReportStylePreview(styleDraft) {
  const wrap = $("#style-preview-wrap");
  if (!wrap) return;
  try {
    const sampleData = lastFullReportContext?.results?.line1 || SAMPLE_PREVIEW_REPORT_DATA;
    const canvas = await drawReportCanvas(sampleData, styleDraft);
    wrap.innerHTML = `<img src="${canvas.toDataURL("image/png")}" alt="پیش‌نمایش گزارش" style="width:100%;border-radius:var(--radius-sm)" />`;
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-warning">${icon("alert-triangle")}<span>ساخت پیش‌نمایش با خطا مواجه شد</span></div>`;
  }
}

async function handleSaveReportStyle() {
  state.reportStyle = sanitizeReportStyle(collectReportStyleFormValues());
  await setSetting("reportStyle", state.reportStyle);
  showToast("ظاهر گزارش خروجی ذخیره شد", "success");
}

async function handleResetReportStyle() {
  state.reportStyle = sanitizeReportStyle(DEFAULT_REPORT_STYLE);
  await setSetting("reportStyle", state.reportStyle);
  renderReportStyleForm();
  showToast("ظاهر گزارش به حالت پیش‌فرض بازگشت", "success");
}

/* ---------------------------------------------------------
   9b. پشتیبان‌گیری — export / import all groups, products, and settings
   --------------------------------------------------------- */
async function handleExportBackup() {
  const payload = {
    app: "SalesFlow",
    backupVersion: 3,
    exportedAt: new Date().toISOString(),
    groups: state.groups,
    products: state.products,
    columnMap: state.columnMap,
    lines: state.lines,
    lineGroups: state.lineGroups,
    fontScale: state.fontScale,
    // SalesFlow نسخه ۲
    monthlyTargets: state.monthlyTargets,
    targetTotals: state.targetTotals,
    sellersCount: state.sellersCount,
    monthBaseline: state.monthBaseline,
    reportStyle: state.reportStyle,
    salesLog: await Store.getAll("salesLog"),
    // SalesFlow نسخه ۳ — گروه‌های مادر
    parentGroups: state.parentGroups,
    lineReportItems: state.lineReportItems,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `salesflow-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  state.lastBackupAt = new Date().toISOString();
  await setSetting("lastBackupAt", state.lastBackupAt);
  updateBackupStatusText();
  hideBackupReminderBanner();
  showToast("فایل پشتیبان دانلود شد", "success");
}

async function handleImportBackupFile(file) {
  if (!file) return;
  let payload;
  try {
    const text = await file.text();
    payload = JSON.parse(text);
  } catch (err) {
    showToast("فایل پشتیبان معتبر نیست", "error");
    return;
  }
  if (!payload || !Array.isArray(payload.groups) || !Array.isArray(payload.products)) {
    showToast("ساختار فایل پشتیبان معتبر نیست", "error");
    return;
  }

  const ok = await confirmModal({
    icon: "alert-triangle",
    title: "بازیابی فایل پشتیبان",
    body: "با این کار تمام گروه‌های کالا، کدهای کالا و تنظیمات فعلی حذف و با اطلاعات فایل پشتیبان جایگزین می‌شوند. این عملیات قابل بازگشت نیست. آیا مطمئن هستید؟",
    confirmLabel: "بازیابی و جایگزینی",
    confirmClass: "btn-danger",
  });
  if (!ok) return;

  try {
    await Store.clear("groups");
    await Store.clear("products");
    await Store.clear("settings");
    await Store.clear("salesLog");
    await Store.clear("parentGroups");

    for (const g of payload.groups) await Store.put("groups", g);
    for (const p of payload.products) await Store.put("products", p);
    if (payload.columnMap) await setSetting("columnMap", payload.columnMap);
    if (payload.lines) await setSetting("lines", payload.lines);
    if (payload.lineGroups) await setSetting("lineGroups", payload.lineGroups);
    if (payload.fontScale) await setSetting("fontScale", payload.fontScale);
    // SalesFlow نسخه ۲
    if (payload.monthlyTargets) await setSetting("monthlyTargets", payload.monthlyTargets);
    if (payload.targetTotals) await setSetting("targetTotals", payload.targetTotals);
    if (payload.sellersCount) await setSetting("sellersCount", payload.sellersCount);
    if (payload.monthBaseline) await setSetting("monthBaseline", payload.monthBaseline);
    if (payload.reportStyle) await setSetting("reportStyle", payload.reportStyle);
    if (Array.isArray(payload.salesLog)) {
      for (const entry of payload.salesLog) await Store.put("salesLog", entry);
    }
    // SalesFlow نسخه ۳ — گروه‌های مادر
    if (Array.isArray(payload.parentGroups)) {
      for (const p of payload.parentGroups) await Store.put("parentGroups", p);
    }
    if (payload.lineReportItems) await setSetting("lineReportItems", payload.lineReportItems);

    await hydrateState();
    document.documentElement.style.setProperty("--font-scale", String(state.fontScale));

    renderGroupsList();
    renderProductsList();
    populateManualGroupSelect();
    renderLineGroupCheckboxes();
    loadSettingsFormFromState();
    populateSingleReportSelectors();
    handleRemoveSalesFile();
    renderTargetsTab();
    renderBaselineTab();
    loadSellersFormFromState();
    renderReportStyleForm();

    showToast("بازیابی با موفقیت انجام شد", "success");
  } catch (err) {
    showToast("خطا در بازیابی فایل پشتیبان", "error");
  }
}

/* ---------------------------------------------------------
   10. REPORT ENGINE
   --------------------------------------------------------- */
/**
 * Many accounting/ERP systems (common with Iranian سیستم‌های حسابداری/فروش)
 * export a ".xls"/".xlsx" file that is not actually a binary Excel file at
 * all. Two variants show up in practice, and both silently produce an
 * empty/garbled sheet (all-zero report) if handed straight to SheetJS's
 * binary reader — it doesn't throw, so the failure is invisible:
 *
 *   1. An HTML table saved with an .xls extension.
 *   2. Plain delimited text (tab- or comma-separated), frequently encoded
 *      in a legacy Persian/Arabic codepage (Windows-1256) rather than
 *      UTF-8, saved with an .xls extension.
 *
 * Opening either in Excel and using "Save As → xlsx" works because Excel
 * itself converts the content into a real workbook first. This function
 * detects a genuine binary workbook by its real file signature, and
 * otherwise decodes the bytes as text (respecting a declared HTML
 * <meta charset>, falling back through common encodings) to build a
 * proper sheet directly — so the person never has to do that manual
 * "open and re-save" step themselves.
 */
function readWorkbookSmart(buf) {
  const sigBytes = new Uint8Array(buf.slice(0, 8));
  const isZip = sigBytes[0] === 0x50 && sigBytes[1] === 0x4b; // "PK.." — real .xlsx
  const isOle2 = sigBytes[0] === 0xd0 && sigBytes[1] === 0xcf && sigBytes[2] === 0x11 && sigBytes[3] === 0xe0; // real binary .xls
  if (isZip || isOle2) {
    return XLSX.read(buf, { type: "array" });
  }

  const headPeek = new TextDecoder("iso-8859-1").decode(buf.slice(0, 4000));
  const looksLikeHtml = /<html[\s>]|<table[\s>]|<!doctype html/i.test(headPeek);
  const charsetMatch = headPeek.match(/charset\s*=\s*["']?([\w-]+)/i);
  const declaredEncoding = charsetMatch ? charsetMatch[1].toLowerCase() : null;
  const candidates = [...new Set([declaredEncoding, "utf-8", "windows-1256", "windows-1252"].filter(Boolean))];

  let text = null;
  for (const enc of candidates) {
    try {
      const decoded = new TextDecoder(enc).decode(buf);
      if (text === null) text = decoded; // keep the first successful decode as a fallback
      if (!decoded.includes("\uFFFD")) { text = decoded; break; } // clean decode, no replacement chars
    } catch (err) {
      // unsupported encoding label — try the next candidate
    }
  }
  if (text === null) text = new TextDecoder("utf-8").decode(buf);

  if (looksLikeHtml) {
    return XLSX.read(text, { type: "string" });
  }

  const delimitedWorkbook = buildWorkbookFromDelimitedText(text);
  if (delimitedWorkbook) return delimitedWorkbook;

  // Last resort — let the binary reader try anyway so a real error surfaces
  // instead of the file being silently treated as empty.
  return XLSX.read(buf, { type: "array" });
}

/**
 * Builds a workbook from plain delimited text (tab, comma, or semicolon —
 * whichever appears most on the first line). Used when a ".xls"/".xlsx"
 * file turns out to be a flat text export rather than a real workbook.
 */
function buildWorkbookFromDelimitedText(text) {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
  if (!lines.length) return null;

  const sample = lines[0];
  const delimiterCounts = {
    "\t": (sample.match(/\t/g) || []).length,
    ",": (sample.match(/,/g) || []).length,
    ";": (sample.match(/;/g) || []).length,
  };
  const [bestDelimiter, bestCount] = Object.entries(delimiterCounts).sort((a, b) => b[1] - a[1])[0];
  if (bestCount === 0) return null; // doesn't look like delimited data at all

  const aoa = lines.map((line) => line.split(bestDelimiter));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  return { SheetNames: ["Sheet1"], Sheets: { Sheet1: ws } };
}

function readWorkbookFromArrayBuffer(buf) {
  return readWorkbookSmart(buf);
}

function getFirstSheetInfo(workbook) {
  const sheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];
  if (!ws || !ws["!ref"]) return null;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const rows = XLSX.utils.sheet_to_json(ws, { header: "A", raw: true, defval: "" });
  return { ws, range, rows: rows.slice(1) }; // skip header row
}

function validateColumnsExist(range, columnMap) {
  const labels = { code: "کد کالا", qty: "تعداد فروش", carton: "تعداد در کارتن", line: "لاین", customer: "کد مشتری", invoice: "شماره پیش‌فاکتور" };
  for (const key of Object.keys(columnMap)) {
    const letter = columnMap[key];
    if (!letter) return { ok: false, field: labels[key], letter };
    const idx = XLSX.utils.decode_col(letter);
    if (idx > range.e.c) return { ok: false, field: labels[key], letter };
  }
  return { ok: true };
}

/**
 * Computes exact (unrounded) per-group sums, per-line totals, unique
 * customer counts, and the set of undefined product codes encountered.
 * Rounding is intentionally NOT applied here (section 22/38 of spec).
 */
/**
 * Computes exact (unrounded) per-group sums, per-line totals, unique
 * customer counts, and the set of undefined product codes encountered.
 * Rounding is intentionally NOT applied here (section 22/38 of spec).
 *
 * Each group is tracked in TWO parallel sums:
 *   - groupSumsDisplay: what a group's own report row shows — respects
 *     "فروش به قوطی" (sellByUnit), so such a group's row is the raw sold
 *     quantity (e.g. "بایودنت 1500 قوطی"), not divided by carton size.
 *   - groupSumsCartonEquivalent: ALWAYS qty ÷ carton size, regardless of
 *     sellByUnit. "مجموع" is built from this one only, so every group is
 *     converted to the same carton unit before being added together —
 *     otherwise a قوطی-based group's raw count would inflate the total.
 *
 * `groupsById` maps groupId -> group record, used to detect groups marked
 * "غیرقابل فروش" (non-sellable, e.g. display stands) — rows for such
 * products are excluded entirely: not in any group sum, not in the line
 * total, and not counted toward unique customers either.
 */
function computeSalesReport(rows, columnMap, lines, productMap, groupsById) {
  const result = {
    line1: { groupSumsDisplay: {}, groupSumsCartonEquivalent: {}, customers: new Set() },
    line2: { groupSumsDisplay: {}, groupSumsCartonEquivalent: {}, customers: new Set() },
  };
  const undefinedCodes = new Set();

  for (const row of rows) {
    // پیش‌فاکتور تسویه‌نشده (مقدار ستون برابر صفر) یعنی فاکتور نهایی نشده و
    // اصلاً جزو فروش نیست — این سطر باید کاملاً از گزارش کنار گذاشته شود
    // (نه در جمع گروه‌ها، نه در تعداد مشتری، نه در کدهای تعریف‌نشده).
    const invoiceNum = toPersianSafeNumber(row[columnMap.invoice]);
    if (invoiceNum === 0) continue;

    const lineVal = normalizeStr(row[columnMap.line]);
    let lineKey = null;
    if (lineVal === lines.line1.excelValue) lineKey = "line1";
    else if (lineVal === lines.line2.excelValue) lineKey = "line2";
    if (!lineKey) continue; // other lines are ignored entirely

    const code = normalizeStr(row[columnMap.code]);
    const product = productMap.get(code);

    // کالاهای گروه «غیرقابل فروش» (مثل استند) هرگز جزو فروش نیستند —
    // نه در جمع گروه‌ها، نه در مجموع لاین، نه در تعداد مشتری.
    if (product && groupsById.get(product.group)?.nonSellable) continue;

    const customerVal = normalizeStr(row[columnMap.customer]);
    if (customerVal) result[lineKey].customers.add(customerVal);

    if (!product) {
      if (code) undefinedCodes.add(code);
      continue; // row not calculated further — no group is guessed
    }

    const qty = toPersianSafeNumber(row[columnMap.qty]);
    const cartonFromFile = toPersianSafeNumber(row[columnMap.carton]);
    let cartonQty = 0;
    if (!isNaN(cartonFromFile) && cartonFromFile > 0) cartonQty = cartonFromFile;
    else if (product.cartonQty > 0) cartonQty = product.cartonQty;

    // carton-equivalent is always computed the same way, no matter the
    // group's display setting — this is what "مجموع" is built from.
    const cartonEquivalentSales = cartonQty > 0 && !isNaN(qty) ? qty / cartonQty : 0;

    const productGroup = groupsById.get(product.group);
    const displaySales = productGroup?.sellByUnit
      ? (!isNaN(qty) ? qty : 0) // «فروش به قوطی» — نمایش با واحد خام
      : cartonEquivalentSales;

    const g = product.group;
    result[lineKey].groupSumsDisplay[g] = (result[lineKey].groupSumsDisplay[g] || 0) + displaySales;
    result[lineKey].groupSumsCartonEquivalent[g] = (result[lineKey].groupSumsCartonEquivalent[g] || 0) + cartonEquivalentSales;
  }

  return { ...result, undefinedCodes };
}

/**
 * Builds report rows in the exact order the user configured for this line
 * (section 8 UI — "تعریف گزارش کلی"), NOT the global group-management order.
 *
 * `items` is an array of {type:'group'|'parent', id}. A "group" item works
 * as before. A "parent" item (گروه مادر — SalesFlow نسخه ۳) sums the
 * groupSumsDisplay of all its child groups into one row; this is only
 * meaningful when every child shares the same «فروش به قوطی» setting
 * (enforced when the parent group is defined/edited — see
 * validateChildSellByUnitConsistency), so a parent row's own sellByUnit is
 * simply its first child's. A parent with no (remaining) valid children, or
 * one whose children have since become inconsistent, is skipped.
 *
 * Each row's own value uses groupSumsDisplay (so a "فروش به قوطی" group
 * shows its raw quantity). "مجموع" is built from groupSumsCartonEquivalent
 * instead — every sellable REAL group converted to the same carton unit —
 * so it always reflects the line's true carton-equivalent sales, whether or
 * not a group (or its parent) is included in the displayed rows, and
 * without a قوطی-based group inflating it, and without a گروه مادر row
 * double-counting its children (مجموع is built straight from real groups,
 * never from parent rows). Non-sellable ("غیرقابل فروش") groups never enter
 * either sum to begin with (computeSalesReport already excludes them).
 * "مجموع" is always rendered as the final row by the caller.
 */
function buildLineReportRows(groupSumsDisplay, groupSumsCartonEquivalent, items) {
  const rows = items
    .map((item) => {
      if (item.type === "parent") {
        const p = parentGroupById(item.id);
        if (!p) return null;
        const children = (p.childGroupIds || []).map((cid) => groupById(cid)).filter(Boolean);
        if (!children.length) return null;
        const sellByUnit = !!children[0].sellByUnit;
        const consistent = children.every((c) => !!c.sellByUnit === sellByUnit);
        if (!consistent) return null; // safety net — should not happen, prevented at definition time
        const exact = children.reduce((sum, c) => sum + (groupSumsDisplay[c.id] || 0), 0);
        return { parentId: p.id, name: p.displayName || p.name, exact, rounded: Math.round(exact), sellByUnit };
      }
      const g = groupById(item.id);
      if (!g) return null;
      const exact = groupSumsDisplay[g.id] || 0;
      return { groupId: g.id, name: g.displayName || g.name, exact, rounded: Math.round(exact), sellByUnit: !!g.sellByUnit };
    })
    .filter(Boolean);
  const totalExact = Object.values(groupSumsCartonEquivalent).reduce((sum, v) => sum + v, 0);
  const totalRounded = Math.round(totalExact);
  return { rows, totalExact, totalRounded };
}

/* ---------------------------------------------------------
   11. REPORTS VIEW — file loading + گزارش کلی + گزارش تکی
   --------------------------------------------------------- */
let currentSalesRows = null; // cached parsed rows of the currently selected sales file
let lastUndefinedCodes = [];
let lastReportData = null;        // most recently generated {line1, line2} report (SalesFlow نسخه ۲)
let lastFullReportContext = null; // computed data behind the currently-shown full-report images
let fontDataUrlCache = {};        // cache of local woff2 fonts -> base64 data URLs, for image export

async function handleSalesFileSelected(file) {
  const statusEl = $("#sales-file-status");
  const dropEl = $("#sales-file-drop");
  const removeBtn = $("#btn-remove-sales-file");
  statusEl.textContent = "";
  dropEl.classList.remove("has-file");
  removeBtn.style.display = "none";
  currentSalesRows = null;
  $("#btn-generate-report").disabled = true;
  $("#sales-file-warning-slot").innerHTML = "";
  if (!file) return;

  try {
    const buf = await file.arrayBuffer();
    const workbook = readWorkbookFromArrayBuffer(buf);
    const info = getFirstSheetInfo(workbook);
    if (!info) {
      showToast("فایل معتبر نیست", "error");
      return;
    }
    currentSalesRows = info;
    statusEl.textContent = "فایل انتخاب شد";
    dropEl.classList.add("has-file");
    removeBtn.style.display = "inline-flex";
    $("#btn-generate-report").disabled = false;
  } catch (err) {
    showToast("خطا در خواندن فایل", "error");
  }
}

function handleRemoveSalesFile() {
  currentSalesRows = null;
  lastUndefinedCodes = [];
  lastReportData = null;
  lastFullReportContext = null;
  $("#sales-file-input").value = "";
  $("#sales-file-status").textContent = "";
  $("#sales-file-drop").classList.remove("has-file");
  $("#btn-remove-sales-file").style.display = "none";
  $("#btn-generate-report").disabled = true;
  $("#sales-file-warning-slot").innerHTML = "";
  $("#undefined-codes-alert-slot").innerHTML = "";
  $("#report-output").innerHTML = `
    <div class="empty-state">
      <div class="icon">📄</div>
      <div class="title">هنوز گزارشی تولید نشده است</div>
      <div>فایل فروش را انتخاب کرده و روی «تولید گزارش» کلیک کنید</div>
    </div>`;
  $("#full-report-trigger-row").style.display = "none";
  $("#full-report-card").style.display = "none";
  $("#full-report-output").innerHTML = "";
  showToast("فایل حذف شد — می‌توانید فایل جدید انتخاب کنید", "success");
}

function showColumnValidationError(field) {
  $("#sales-file-warning-slot").innerHTML = `
    <div class="alert alert-warning">
      <span class="icon"><svg><use href="#icon-alert-triangle"></use></svg></span>
      <span>خطا در فایل فروش — ستون «${escapeHtml(field)}» که در تنظیمات مشخص شده، در فایل واردشده وجود ندارد. لطفاً فایل یا تنظیمات ستون‌ها را بررسی کنید.</span>
    </div>`;
}

async function handleGenerateReport() {
  if (!currentSalesRows) {
    showToast("لطفاً ابتدا فایل فروش را انتخاب کنید", "error");
    return;
  }
  $("#sales-file-warning-slot").innerHTML = "";
  $("#undefined-codes-alert-slot").innerHTML = "";

  const valid = validateColumnsExist(currentSalesRows.range, state.columnMap);
  if (!valid.ok) { showColumnValidationError(valid.field); return; }
  if (!state.lines.line1.excelValue || !state.lines.line2.excelValue) {
    showToast("ابتدا مقدار دقیق لاین‌ها را در تنظیمات وارد کنید", "error");
    return;
  }
  if (!state.groups.length) {
    showToast("ابتدا گروه‌های کالا را در بخش مدیریت تعریف کنید", "error");
    return;
  }

  $("#report-loading").style.display = "flex";
  $("#report-output").innerHTML = "";
  await new Promise((r) => setTimeout(r, 30)); // let loading paint before heavy sync work

  const productMap = new Map(state.products.map((p) => [p.code, p]));
  const groupsById = new Map(state.groups.map((g) => [g.id, g]));
  const { line1, line2, undefinedCodes } = computeSalesReport(
    currentSalesRows.rows, state.columnMap, state.lines, productMap, groupsById
  );

  const r1 = buildLineReportRows(line1.groupSumsDisplay, line1.groupSumsCartonEquivalent, state.lineReportItems.line1);
  const r2 = buildLineReportRows(line2.groupSumsDisplay, line2.groupSumsCartonEquivalent, state.lineReportItems.line2);

  $("#report-loading").style.display = "none";
  lastReportData = {
    line1: { ...r1, customerCount: line1.customers.size },
    line2: { ...r2, customerCount: line2.customers.size },
  };
  renderFullReport(lastReportData);
  $("#full-report-trigger-row").style.display = "flex";
  $("#full-report-card").style.display = "none";
  $("#full-report-output").innerHTML = "";

  lastUndefinedCodes = Array.from(undefinedCodes);
  if (lastUndefinedCodes.length) {
    $("#undefined-codes-alert-slot").innerHTML = `
      <div class="alert alert-warning">
        <span class="icon"><svg><use href="#icon-alert-triangle"></use></svg></span>
        <span>${lastUndefinedCodes.length.toLocaleString("fa-IR")} کد کالا تعریف نشده‌اند —
          <button class="link" id="btn-show-undefined-codes">نمایش لیست</button>
        </span>
      </div>`;
    $("#btn-show-undefined-codes").addEventListener("click", () => {
      openModal({
        icon: "alert-triangle",
        title: "کدهای کالای تعریف‌نشده",
        body: "این کدها در بانک کالا ثبت نشده‌اند و در محاسبه گزارش لحاظ نشده‌اند:",
        listItems: lastUndefinedCodes,
        actions: [{ label: "باشه", className: "btn-primary" }],
      });
    });
  }
}

function renderLineReportCard(lineKey, lineLabel, dotClass, data) {
  const rowsHtml = data.rows.length
    ? data.rows
        .map((r) => {
          const displayValue = r.sellByUnit ? `${formatNumber(r.rounded)} قوطی` : formatNumber(r.rounded);
          return `<tr class="${r.rounded === 0 ? "table-row-zero" : ""}"><td>${escapeHtml(r.name)}</td><td class="num">${displayValue}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="2" style="text-align:center;color:var(--color-text-faint)">هیچ گروهی برای نمایش در این لاین تعریف نشده است</td></tr>`;

  return `
    <div class="line-block">
      <div class="line-block-header">
        <div class="line-block-title"><span class="line-dot ${dotClass}"></span> ${lineLabel}</div>
        <span class="customer-count">تعداد مشتری: ${data.customerCount.toLocaleString("fa-IR")}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>گروه کالا</th><th class="num">فروش</th></tr></thead>
          <tbody>
            ${rowsHtml}
            <tr class="table-row-total"><td>مجموع</td><td class="num">${formatNumber(data.totalRounded)}</td></tr>
          </tbody>
        </table>
      </div>
      <button class="btn btn-secondary btn-sm" data-copy-line="${lineKey}"><svg width="15" height="15"><use href="#icon-copy"></use></svg> کپی گزارش ${lineLabel}</button>
    </div>`;
}

function renderFullReport(data) {
  const out = $("#report-output");
  out.innerHTML = `
    <div class="stack" style="gap:var(--space-6)">
      ${renderLineReportCard("line1", "لاین یک", "line1", data.line1)}
      <div class="divider"></div>
      ${renderLineReportCard("line2", "لاین دو", "line2", data.line2)}
    </div>`;
  out.dataset.hasReport = "1";

  $all("[data-copy-line]", out).forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.copyLine;
      const d = data[key];
      const lines = [...d.rows.map((r) => String(r.rounded)), String(d.totalRounded)];
      copyToClipboard(lines.join("\n"));
    });
  });
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("در کلیپ‌بورد کپی شد", "success");
  } catch (err) {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); showToast("در کلیپ‌بورد کپی شد", "success"); }
    catch { showToast("کپی با خطا مواجه شد", "error"); }
    ta.remove();
  }
}

/* ---------------------------------------------------------
   11b. گزارش کامل روز — SalesFlow نسخه ۲
   تاریخ + درصد ابطالی → محاسبه هدف/تجمعی/مانده/سرانه → دو تصویر
   --------------------------------------------------------- */
function openFullReportModal() {
  if (!lastReportData) {
    showToast("ابتدا گزارش را تولید کنید", "error");
    return;
  }
  const [jy, jm, jd] = todayJalali();
  const region = $("#modal-region");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-title">گزارش کامل روز</div>
      <div class="modal-body">تاریخ گزارش (قابل‌ویرایش) و درصد ابطالی هر لاین را مشخص کنید — درصد ابطالی اختیاری است.</div>
      <div class="form-grid" style="margin-top:var(--space-4)">
        <div class="field" style="grid-column:1/-1">
          <label>${icon("calendar")} تاریخ گزارش (شمسی)</label>
          <div class="row">
            <input type="number" id="fr-date-y" value="${jy}" style="width:90px" placeholder="سال" />
            <input type="number" id="fr-date-m" min="1" max="12" value="${jm}" style="width:70px" placeholder="ماه" />
            <input type="number" id="fr-date-d" min="1" max="31" value="${jd}" style="width:70px" placeholder="روز" />
          </div>
        </div>
        <div class="field">
          <label><span class="line-dot line1"></span> درصد ابطالی لاین یک</label>
          <input type="text" id="fr-invalid-line1" placeholder="اختیاری — می‌توانید خالی بگذارید" />
        </div>
        <div class="field">
          <label><span class="line-dot line2"></span> درصد ابطالی لاین دو</label>
          <input type="text" id="fr-invalid-line2" placeholder="اختیاری — می‌توانید خالی بگذارید" />
        </div>
      </div>
      <div class="modal-actions" id="fr-modal-actions" style="margin-top:var(--space-5)"></div>
    </div>`;
  region.appendChild(overlay);
  const actionsSlot = $("#fr-modal-actions", overlay);
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "انصراف";
  cancelBtn.onclick = () => overlay.remove();
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-primary";
  confirmBtn.textContent = "تایید و نمایش تصاویر";
  confirmBtn.onclick = async () => {
    const y = Number($("#fr-date-y", overlay).value);
    const m = Number($("#fr-date-m", overlay).value);
    const d = Number($("#fr-date-d", overlay).value);
    if (!y || !m || m < 1 || m > 12 || !d || d < 1 || d > 31) {
      showToast("تاریخ نامعتبر است", "error");
      return;
    }
    const dateStr = jalaliToStr(y, m, d);
    const invalidPct = {
      line1: normalizeStr($("#fr-invalid-line1", overlay).value),
      line2: normalizeStr($("#fr-invalid-line2", overlay).value),
    };
    overlay.remove();
    await generateFullReport(dateStr, invalidPct);
  };
  actionsSlot.appendChild(cancelBtn);
  actionsSlot.appendChild(confirmBtn);
}

async function generateFullReport(dateStr, invalidPct) {
  const results = {};
  for (const lineKey of ["line1", "line2"]) {
    const rd = lastReportData[lineKey];
    const targets = state.monthlyTargets[lineKey] || {};
    const cum = await getMonthCumulativeRows(lineKey, dateStr, { exclusive: true }); // strictly before today — so re-generating/overwriting an already-saved day replaces it instead of double-counting
    // گزارش کامل روز (هدف/تجمعی/مانده) فعلاً فقط برای ردیف‌های گروه واقعی
    // محاسبه می‌شود — یک گروه مادر هدف/مبدأ تجمعی مستقل خودش را ندارد.
    const rows = rd.rows.filter((r) => r.groupId != null).map((r) => {
      const cumulative = (cum.byGroup[r.groupId] || 0) + r.rounded;
      const target = targets[r.groupId] != null ? targets[r.groupId] : null;
      return {
        groupId: r.groupId,
        name: r.name,
        sellByUnit: r.sellByUnit,
        todaySale: r.rounded,
        target,
        cumulative,
        remaining: target != null ? cumulative - target : null,
      };
    });
    const totalToday = rd.totalRounded;
    const totalCumulative = cum.total + totalToday;
    const targetTotal = state.targetTotals[lineKey] || 0;
    const sellers = state.sellersCount[lineKey] || 0;
    const perRep = sellers > 0 ? rd.customerCount / sellers : null;
    results[lineKey] = {
      lineLabel: lineKey === "line1" ? "لاین یک" : "لاین دو",
      dateStr,
      rows,
      totalToday,
      totalCumulative,
      targetTotal,
      totalRemaining: totalCumulative - targetTotal,
      customerCount: rd.customerCount,
      perRep,
      invalidPct: invalidPct[lineKey] || "",
    };
  }
  lastFullReportContext = { dateStr, results };
  $("#full-report-card").style.display = "block";
  await renderFullReportImages(results);
  $("#full-report-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Waits for the Vazirmatn weights we draw with to be fully loaded, so the
 * canvas text below is rendered with the correct glyphs on first paint. */
async function ensureReportFontsLoaded(sizes) {
  const jobs = [];
  for (const s of sizes) {
    jobs.push(document.fonts.load(`400 ${s}px Vazirmatn`));
    jobs.push(document.fonts.load(`700 ${s}px Vazirmatn`));
  }
  await Promise.all(jobs);
  await document.fonts.ready;
}

/** Given column-width weights (relative, any positive numbers) in visual
 * right-to-left order (first = rightmost, matching how the report reads in
 * RTL), returns each column's {x0,x1,w} pixel bounds within a canvas of
 * `canvasWidth`. Weights are normalized automatically so they don't need
 * to add up to any particular total. */
function computeColumnBoundsRTL(weights, canvasWidth) {
  const total = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0) || 1;
  let xRight = canvasWidth;
  return weights.map((w) => {
    const width = (Math.max(w, 0) / total) * canvasWidth;
    const b = { x0: xRight - width, x1: xRight, w: width };
    xRight -= width;
    return b;
  });
}

/** Draws one line's full-day report (title+date, column headers, one row
 * per product group, a blank spacer bar, total row, footer stats row)
 * directly with the Canvas 2D API — column widths, row heights, per-section
 * fonts/sizes/bold, per-column alignment/bold and every color come from `S`
 * (state.reportStyle, or a live-preview draft of it) — and returns the
 * finished <canvas>. Pure vector drawing avoids the "tainted canvas"
 * restriction that an SVG/foreignObject round-trip runs into. */
async function drawReportCanvas(data, S) {
  const scale = 2; // export at 2x for crisp screenshots
  const widthCss = S.imageWidth || 660;
  const rowH = S.rowHeights;
  const heightCss = rowH.title + rowH.header + data.rows.length * rowH.data + rowH.total + rowH.spacer + rowH.footer;

  await ensureReportFontsLoaded([S.titleSize, S.headerSize, S.bodySize, S.footerSize, Math.round(S.titleSize * 0.7)]);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthCss * scale);
  canvas.height = Math.round(heightCss * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.direction = "rtl";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthCss, heightCss);

  // column bounds follow S.columnOrder (right-to-left) + S.columnWeights, keyed by column id
  const bounds = computeColumnBoundsRTL(S.columnOrder.map((k) => S.columnWeights[k]), widthCss);
  const colBoundsByKey = {};
  S.columnOrder.forEach((k, i) => (colBoundsByKey[k] = bounds[i]));
  // footer bounds are a separate 3-slot row, following S.footerOrder + S.footerWeights
  const footerBounds = computeColumnBoundsRTL(S.footerOrder.map((k) => S.footerWeights[k]), widthCss);
  const footerBoundsByKey = {};
  S.footerOrder.forEach((k, i) => (footerBoundsByKey[k] = footerBounds[i]));

  const fmt = (n) => toPersianDigits(formatNumber(n));

  function cell(x0, x1, y0, y1, bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = S.borderColor;
    ctx.lineWidth = S.borderWidth || 1;
    const half = (S.borderWidth || 1) / 2;
    ctx.strokeRect(x0 + half, y0 + half, x1 - x0 - half * 2, y1 - y0 - half * 2);
  }
  /** align: "right" | "center" | "left" — physical, independent of ctx.direction. */
  function text(str, b, y, size, color, bold, family, align, numeric) {
    const pad = 8;
    ctx.fillStyle = color;
    ctx.font = `${bold ? "700" : "400"} ${size}px ${family}, Tahoma, sans-serif`;
    ctx.direction = numeric ? "ltr" : "rtl";
    ctx.textAlign = align === "right" ? "right" : align === "left" ? "left" : "center";
    const x = align === "right" ? b.x1 - pad : align === "left" ? b.x0 + pad : (b.x0 + b.x1) / 2;
    ctx.fillText(String(str), x, y, b.w - pad * 2);
    ctx.direction = "rtl";
  }
  /** The background for a data/total-row cell: the column's own override
   * color if enabled, otherwise the row-type's default background. */
  function colBg(key, rowDefaultBg) {
    return S.columnBgEnabled[key] ? S.columnBg[key] : rowDefaultBg;
  }

  let y = 0;

  // ---- title row: rightmost 3 column-slots = report title, leftmost 2 = date ----
  const n = S.columnOrder.length;
  const span = Math.min(Math.max(S.dateCellSpan || 1, 1), n - 1);
  const titleB = { x0: bounds[n - 1 - span].x0, x1: bounds[0].x1, w: bounds[0].x1 - bounds[n - 1 - span].x0 };
  const dateB = { x0: bounds[n - 1].x0, x1: bounds[n - span].x1, w: bounds[n - span].x1 - bounds[n - 1].x0 };
  cell(titleB.x0, titleB.x1, y, y + rowH.title, S.titleCellBg);
  cell(dateB.x0, dateB.x1, y, y + rowH.title, S.dateCellBg);
  text(S.titleTemplate.replace("{line}", data.lineLabel), titleB, y + rowH.title / 2, S.titleSize, S.titleCellText, S.titleBold, S.titleFontFamily, "center", false);
  text(S.dateTemplate.replace("{date}", toPersianDigits(data.dateStr)), dateB, y + rowH.title / 2, Math.round(S.titleSize * 0.7), S.dateCellText, S.titleBold, S.titleFontFamily, "center", false);
  y += rowH.title;

  // ---- column header row (alignment follows the column's own align) ----
  S.columnOrder.forEach((key) => {
    const b = colBoundsByKey[key];
    cell(b.x0, b.x1, y, y + rowH.header, colBg(key, S.headerRowBg));
    text(S.columnLabels[key], b, y + rowH.header / 2, S.headerSize, S.headerRowText, S.headerBold, S.headerFontFamily, S.columnAlign[key], false);
  });
  y += rowH.header;

  // ---- one data row per product group ----
  for (const r of data.rows) {
    const todayDisplay = r.sellByUnit ? `${fmt(r.todaySale)} قوطی` : fmt(r.todaySale);
    const valuesByKey = {
      product: r.name,
      target: r.target != null ? fmt(r.target) : "—",
      today: todayDisplay,
      cumulative: fmt(r.cumulative),
      remaining: r.remaining != null ? fmt(r.remaining) : "—",
    };
    S.columnOrder.forEach((key) => {
      const b = colBoundsByKey[key];
      cell(b.x0, b.x1, y, y + rowH.data, colBg(key, S.dataRowBg));
      const color = key === "remaining" ? (r.remaining == null ? S.dataRowText : r.remaining < 0 ? S.remainingNegativeText : S.remainingPositiveText) : S.dataRowText;
      text(valuesByKey[key], b, y + rowH.data / 2, S.bodySize, color, S.columnBold[key], S.bodyFontFamily, S.columnAlign[key], key !== "product");
    });
    y += rowH.data;
  }

  // ---- total row ----
  {
    const valuesByKey = {
      product: "کل محصولات",
      target: fmt(data.targetTotal),
      today: fmt(data.totalToday),
      cumulative: fmt(data.totalCumulative),
      remaining: fmt(data.totalRemaining),
    };
    S.columnOrder.forEach((key) => {
      const b = colBoundsByKey[key];
      cell(b.x0, b.x1, y, y + rowH.total, colBg(key, S.totalRowBg));
      const color = key === "remaining" ? (data.totalRemaining < 0 ? S.remainingNegativeText : S.remainingPositiveText) : S.totalRowText;
      text(valuesByKey[key], b, y + rowH.total / 2, S.bodySize, color, true, S.bodyFontFamily, S.columnAlign[key], key !== "product");
    });
    y += rowH.total;
  }

  // ---- blank blue spacer bar (matches the sample report exactly) ----
  cell(bounds[4].x0, bounds[0].x1, y, y + rowH.spacer, S.spacerBg);
  y += rowH.spacer;

  // ---- footer stats row — order/labels/widths from S.footerOrder ----
  {
    const invalidDisplay = data.invalidPct ? `${toPersianDigits(data.invalidPct)}٪` : "";
    const perRepDisplay = data.perRep != null ? toPersianDigits(data.perRep.toFixed(1)) : "";
    const valuesByKey = { customer: toPersianDigits(data.customerCount), perRep: perRepDisplay, invalid: invalidDisplay };
    const bgByKey = { customer: S.footerCustomerBg, perRep: S.footerPerRepBg, invalid: S.footerInvalidBg };
    const textColorByKey = { customer: S.footerCustomerText, perRep: S.footerPerRepText, invalid: S.footerInvalidText };
    S.footerOrder.forEach((key) => {
      const b = footerBoundsByKey[key];
      cell(b.x0, b.x1, y, y + rowH.footer, bgByKey[key]);
      const label = valuesByKey[key] ? `${S.footerLabels[key]}: ${valuesByKey[key]}` : `${S.footerLabels[key]}:`;
      text(label, b, y + rowH.footer / 2, key === "perRep" ? Math.max(11, S.footerSize - 2) : S.footerSize, textColorByKey[key], S.footerBold, S.footerFontFamily, "center", false);
    });
  }

  return canvas;
}

async function renderReportToPngDataUrl(data) {
  const canvas = await drawReportCanvas(data, state.reportStyle);
  return canvas.toDataURL("image/png");
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.match(/:(.*?);/)[1];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function renderFullReportImages(results) {
  const out = $("#full-report-output");
  out.innerHTML = `
    <div class="stack" style="gap:var(--space-6)">
      <div>
        <div class="line-block-title" style="margin-bottom:var(--space-3)"><span class="line-dot line1"></span> گزارش لاین یک:</div>
        <div class="report-image-wrap" id="fr-image-wrap-line1"><span class="loading-row"><span class="spinner dark"></span> در حال ساخت تصویر...</span></div>
        <div class="report-image-actions" id="fr-actions-line1" style="display:none">
          <button class="btn btn-secondary btn-sm" data-fr-action="copy" data-fr-line="line1">${icon("copy")} کپی</button>
          <button class="btn btn-secondary btn-sm" data-fr-action="download" data-fr-line="line1">${icon("download")} دریافت تصویر</button>
          <button class="btn btn-secondary btn-sm" data-fr-action="share" data-fr-line="line1">${icon("share")} اشتراک‌گذاری</button>
        </div>
      </div>
      <div class="divider"></div>
      <div>
        <div class="line-block-title" style="margin-bottom:var(--space-3)"><span class="line-dot line2"></span> گزارش لاین دو:</div>
        <div class="report-image-wrap" id="fr-image-wrap-line2"><span class="loading-row"><span class="spinner dark"></span> در حال ساخت تصویر...</span></div>
        <div class="report-image-actions" id="fr-actions-line2" style="display:none">
          <button class="btn btn-secondary btn-sm" data-fr-action="copy" data-fr-line="line2">${icon("copy")} کپی</button>
          <button class="btn btn-secondary btn-sm" data-fr-action="download" data-fr-line="line2">${icon("download")} دریافت تصویر</button>
          <button class="btn btn-secondary btn-sm" data-fr-action="share" data-fr-line="line2">${icon("share")} اشتراک‌گذاری</button>
        </div>
      </div>
    </div>`;

  for (const lineKey of ["line1", "line2"]) {
    try {
      const dataUrl = await renderReportToPngDataUrl(results[lineKey]);
      lastFullReportContext.results[lineKey].imageDataUrl = dataUrl;
      const wrap = $(`#fr-image-wrap-${lineKey}`);
      wrap.innerHTML = `<img src="${dataUrl}" alt="گزارش ${results[lineKey].lineLabel}" style="width:100%;border-radius:var(--radius-md);border:1px solid var(--color-border);cursor:pointer" data-fr-image="${lineKey}" />`;
      $(`#fr-actions-${lineKey}`).style.display = "flex";
      $(`[data-fr-image="${lineKey}"]`, wrap).addEventListener("click", () => copyReportImage(lineKey));
    } catch (err) {
      $(`#fr-image-wrap-${lineKey}`).innerHTML = `<div class="alert alert-warning">${icon("alert-triangle")}<span>ساخت تصویر با خطا مواجه شد</span></div>`;
    }
  }

  $all("[data-fr-action]", out).forEach((btn) => {
    btn.addEventListener("click", () => {
      const lineKey = btn.dataset.frLine;
      const action = btn.dataset.frAction;
      if (action === "copy") copyReportImage(lineKey);
      else if (action === "download") downloadReportImage(lineKey);
      else if (action === "share") shareReportImage(lineKey);
    });
  });
}

async function copyReportImage(lineKey) {
  const dataUrl = lastFullReportContext?.results?.[lineKey]?.imageDataUrl;
  if (!dataUrl) return;
  try {
    const blob = dataUrlToBlob(dataUrl);
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    showToast("تصویر گزارش کپی شد — آماده ارسال", "success");
  } catch (err) {
    showToast("کپی تصویر پشتیبانی نشد — از «دریافت تصویر» استفاده کنید", "warning");
  }
}

function downloadReportImage(lineKey) {
  const ctx = lastFullReportContext;
  const dataUrl = ctx?.results?.[lineKey]?.imageDataUrl;
  if (!dataUrl) return;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `salesflow-${lineKey === "line1" ? "line1" : "line2"}-${ctx.dateStr.replace(/\//g, "-")}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function shareReportImage(lineKey) {
  const ctx = lastFullReportContext;
  const data = ctx?.results?.[lineKey];
  if (!data?.imageDataUrl) return;
  const blob = dataUrlToBlob(data.imageDataUrl);
  const file = new File([blob], `salesflow-${lineKey}-${ctx.dateStr.replace(/\//g, "-")}.png`, { type: "image/png" });
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `گزارش ${data.lineLabel}` });
    } catch (err) {
      // user cancelled the share sheet — no action needed
    }
  } else {
    showToast("اشتراک‌گذاری مستقیم پشتیبانی نمی‌شود — تصویر دانلود شد", "warning");
    downloadReportImage(lineKey);
  }
}

async function handleSaveDailySale() {
  if (!lastFullReportContext) {
    showToast("ابتدا گزارش کامل روز را نمایش دهید", "error");
    return;
  }
  const { dateStr, results } = lastFullReportContext;
  for (const lineKey of ["line1", "line2"]) {
    const rd = results[lineKey];
    await saveDailySaleFull(dateStr, lineKey, rd.rows, rd.totalToday);
  }
  // نکته: مبدأ (گزارش فروش تا روز) دیگر عمداً اینجا تغییر داده نمی‌شود —
  // آن تب حالا خودش زنده تا آخرین روز ثبت‌شده محاسبه می‌کند (نه با جابه‌جا
  // کردن مبدأ)، تا اصلاح/حذف یک روز قدیمی از تاریخچه همیشه صحیح بماند.
  renderBaselineTab();
  renderHistoryTab();
  showToast(`فروش روز ${toPersianDigits(dateStr)} ذخیره شد`, "success");
}

/* ----- گزارش تکی ----- */
function populateSingleReportSelectors() {
  const lineSel = $("#single-line-select");
  const groupSel = $("#single-group-select");
  if (!lineSel || !groupSel) return;
  lineSel.innerHTML = `<option value="line1">لاین یک</option><option value="line2">لاین دو</option>`;
  const sorted = [...state.groups].filter((g) => !g.nonSellable).sort((a, b) => a.order - b.order);
  groupSel.innerHTML = sorted.length
    ? sorted.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("")
    : `<option value="">— گروهی تعریف نشده —</option>`;
}

function handleSingleReport() {
  const out = $("#single-report-output");
  out.innerHTML = "";
  if (!currentSalesRows) {
    showToast("لطفاً ابتدا فایل فروش را در بخش «گزارش کلی» انتخاب کنید", "error");
    return;
  }
  const valid = validateColumnsExist(currentSalesRows.range, state.columnMap);
  if (!valid.ok) { showColumnValidationError(valid.field); return; }
  if (!state.lines.line1.excelValue || !state.lines.line2.excelValue) {
    showToast("ابتدا مقدار دقیق لاین‌ها را در تنظیمات وارد کنید", "error");
    return;
  }
  const lineKey = $("#single-line-select").value;
  const groupId = Number($("#single-group-select").value);
  const group = groupById(groupId);
  if (!group) {
    showToast("ابتدا حداقل یک گروه کالا تعریف کنید", "error");
    return;
  }

  const productMap = new Map(state.products.map((p) => [p.code, p]));
  const groupsById = new Map(state.groups.map((g) => [g.id, g]));
  const { line1, line2 } = computeSalesReport(currentSalesRows.rows, state.columnMap, state.lines, productMap, groupsById);
  const target = lineKey === "line1" ? line1 : line2;
  const exact = target.groupSumsDisplay[groupId] || 0;
  const rounded = Math.round(exact);
  const displayValue = group.sellByUnit ? `${formatNumber(rounded)} قوطی` : formatNumber(rounded);

  out.innerHTML = `
    <div class="card" style="background:var(--color-surface-alt)">
      <div class="row-between">
        <span>لاین: <strong>${lineKey === "line1" ? "لاین یک" : "لاین دو"}</strong></span>
        <span>گروه: <strong>${escapeHtml(group.name)}</strong></span>
        <span>تعداد فروش: <strong class="num">${displayValue}</strong></span>
      </div>
    </div>`;
}

/* ---------------------------------------------------------
   12. Wiring — event bindings & init
   --------------------------------------------------------- */
function bindNavigation() {
  $all(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  $all("#management-tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchManagementTab(btn.dataset.mtab));
  });
}

/** Wires native HTML5 drag-and-drop onto a drop-zone element, in addition
 * to its existing click-to-browse button, calling onFile(file) either way. */
function enableFileDragDrop(dropEl, onFile) {
  ["dragenter", "dragover"].forEach((evt) => {
    dropEl.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropEl.classList.add("drag-active");
    });
  });
  ["dragleave", "dragend"].forEach((evt) => {
    dropEl.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropEl.classList.remove("drag-active");
    });
  });
  dropEl.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropEl.classList.remove("drag-active");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}

function bindReportsView() {
  $("#btn-pick-sales-file").addEventListener("click", () => $("#sales-file-input").click());
  $("#sales-file-input").addEventListener("change", (e) => handleSalesFileSelected(e.target.files[0]));
  $("#btn-remove-sales-file").addEventListener("click", handleRemoveSalesFile);
  $("#btn-generate-report").addEventListener("click", handleGenerateReport);
  $("#btn-single-report").addEventListener("click", handleSingleReport);
  enableFileDragDrop($("#sales-file-drop"), handleSalesFileSelected);

  $("#btn-open-full-report").addEventListener("click", openFullReportModal);
  $("#btn-save-daily-sale").addEventListener("click", handleSaveDailySale);
}

function bindManagementView() {
  $("#btn-add-group").addEventListener("click", () => toggleGroupAddRow(true));
  document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "btn-confirm-add-group") handleAddGroup();
    if (e.target && e.target.id === "btn-cancel-add-group") toggleGroupAddRow(false);
  });
  $("#new-group-name") && $("#new-group-name").addEventListener("keydown", () => {});
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && document.activeElement && document.activeElement.id === "new-group-name") {
      handleAddGroup();
    }
  });

  $("#btn-add-parent-group") && $("#btn-add-parent-group").addEventListener("click", () => toggleParentGroupAddRow(true));
  document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "btn-confirm-add-parent-group") handleAddParentGroup();
    if (e.target && e.target.id === "btn-cancel-add-parent-group") toggleParentGroupAddRow(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && document.activeElement && document.activeElement.id === "new-parent-group-name") {
      handleAddParentGroup();
    }
  });

  // product entry tabs
  $all("#product-entry-tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $all("#product-entry-tabs .tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      $("#ptab-excel").style.display = btn.dataset.ptab === "excel" ? "" : "none";
      $("#ptab-manual").style.display = btn.dataset.ptab === "manual" ? "" : "none";
    });
  });

  $("#btn-pick-products-file").addEventListener("click", () => $("#products-file-input").click());
  $("#products-file-input").addEventListener("change", (e) => handleProductsFileSelected(e.target.files[0]));
  enableFileDragDrop($("#products-file-drop"), handleProductsFileSelected);
  $("#btn-save-manual-product").addEventListener("click", handleSaveManualProduct);
  $("#products-search").addEventListener("input", (e) => renderProductsList(e.target.value));

  $("#btn-save-line1-def").addEventListener("click", () => handleSaveLineGroups("line1"));
  $("#btn-save-line2-def").addEventListener("click", () => handleSaveLineGroups("line2"));

  $("#btn-save-targets-line1").addEventListener("click", () => handleSaveTargets("line1"));
  $("#btn-save-targets-line2").addEventListener("click", () => handleSaveTargets("line2"));
}

function bindSettingsView() {
  $("#btn-save-columns").addEventListener("click", handleSaveColumns);
  $("#btn-save-lines").addEventListener("click", handleSaveLines);
  $all("#font-size-tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleSetFontScale(Number(btn.dataset.fontScale)));
  });
  $("#btn-export-backup").addEventListener("click", handleExportBackup);
  $("#btn-import-backup-trigger").addEventListener("click", () => $("#backup-file-input").click());
  $("#backup-file-input").addEventListener("change", (e) => {
    handleImportBackupFile(e.target.files[0]);
    e.target.value = "";
  });

  $("#btn-save-sellers").addEventListener("click", handleSaveSellers);
  $("#btn-save-report-style").addEventListener("click", handleSaveReportStyle);
  $("#btn-reset-report-style").addEventListener("click", handleResetReportStyle);
}

/* ---------------------------------------------------------
   0c. قفل برنامه (اختیاری) — یک صفحه‌ی قفل ساده، نه رمزنگاری واقعی؛
   فقط جلوی باز کردن سرسری اپ توسط دیگران را می‌گیرد.
   --------------------------------------------------------- */
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Blocks app rendering behind a PIN prompt if one is set — resolves once
 * unlocked (or immediately if no PIN is configured). */
async function checkAppLock() {
  if (!state.appLockPinHash) {
    document.body.classList.remove("sf-boot");
    return;
  }
  const overlay = $("#app-lock-overlay");
  const input = $("#app-lock-input");
  const errorEl = $("#app-lock-error");
  overlay.style.display = "flex";
  document.body.classList.remove("sf-boot");
  input.focus();

  await new Promise((resolve) => {
    async function tryUnlock() {
      const val = input.value;
      if (!val) return;
      const hash = await sha256Hex(val);
      if (hash === state.appLockPinHash) {
        overlay.style.display = "none";
        input.value = "";
        errorEl.style.display = "none";
        resolve();
      } else {
        errorEl.style.display = "block";
        input.value = "";
        input.focus();
      }
    }
    $("#app-lock-submit").addEventListener("click", tryUnlock);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
  });
}

function renderAppLockForm() {
  const slot = $("#app-lock-form-slot");
  if (!slot) return;
  if (!state.appLockPinHash) {
    slot.innerHTML = `
      <div class="field-hint" style="margin-bottom:var(--space-3)">هنوز رمزی تنظیم نشده — هر کسی اپ را باز کند مستقیم واردش می‌شود.</div>
      <div class="form-grid">
        <div class="field"><label>رمز جدید (حداقل ۴ رقم/کاراکتر)</label><input type="password" id="lock-new-pin" autocomplete="off" /></div>
        <div class="field"><label>تکرار رمز</label><input type="password" id="lock-new-pin-confirm" autocomplete="off" /></div>
      </div>
      <div class="row" style="margin-top:var(--space-4)">
        <button class="btn btn-primary" id="btn-set-app-lock">${icon("lock")} فعال کردن قفل</button>
      </div>`;
    $("#btn-set-app-lock").addEventListener("click", handleSetAppLock);
  } else {
    slot.innerHTML = `
      <div class="field-hint" style="margin-bottom:var(--space-3)">قفل روشن است. برای تغییر یا حذف رمز، اول رمز فعلی را وارد کنید.</div>
      <div class="form-grid">
        <div class="field"><label>رمز فعلی</label><input type="password" id="lock-current-pin" autocomplete="off" /></div>
        <div class="field"><label>رمز جدید (برای حذف قفل، خالی بگذارید)</label><input type="password" id="lock-new-pin" autocomplete="off" /></div>
      </div>
      <div class="row" style="margin-top:var(--space-4); flex-wrap:wrap">
        <button class="btn btn-primary" id="btn-change-app-lock">${icon("save")} ذخیره تغییر رمز</button>
        <button class="btn btn-secondary" id="btn-remove-app-lock">${icon("trash")} حذف قفل</button>
        <button class="btn btn-secondary" id="btn-lock-now">${icon("lock")} قفل کردن الان</button>
      </div>`;
    $("#btn-change-app-lock").addEventListener("click", handleChangeAppLock);
    $("#btn-remove-app-lock").addEventListener("click", handleRemoveAppLock);
    $("#btn-lock-now").addEventListener("click", () => location.reload());
  }
}

async function handleSetAppLock() {
  const pin = $("#lock-new-pin").value;
  const confirm = $("#lock-new-pin-confirm").value;
  if (pin.length < 4) { showToast("رمز باید حداقل ۴ رقم/کاراکتر باشد", "error"); return; }
  if (pin !== confirm) { showToast("رمز و تکرارش یکی نیستند", "error"); return; }
  state.appLockPinHash = await sha256Hex(pin);
  await setSetting("appLockPinHash", state.appLockPinHash);
  showToast("قفل فعال شد", "success");
  renderAppLockForm();
}

async function handleChangeAppLock() {
  const current = $("#lock-current-pin").value;
  const newPin = $("#lock-new-pin").value;
  const currentHash = await sha256Hex(current || "");
  if (currentHash !== state.appLockPinHash) { showToast("رمز فعلی اشتباه است", "error"); return; }
  if (!newPin) { showToast("برای حذف قفل، از دکمه «حذف قفل» استفاده کنید", "error"); return; }
  if (newPin.length < 4) { showToast("رمز جدید باید حداقل ۴ رقم/کاراکتر باشد", "error"); return; }
  state.appLockPinHash = await sha256Hex(newPin);
  await setSetting("appLockPinHash", state.appLockPinHash);
  showToast("رمز تغییر کرد", "success");
  renderAppLockForm();
}

async function handleRemoveAppLock() {
  const current = $("#lock-current-pin").value;
  const currentHash = await sha256Hex(current || "");
  if (currentHash !== state.appLockPinHash) { showToast("رمز فعلی اشتباه است", "error"); return; }
  state.appLockPinHash = "";
  await setSetting("appLockPinHash", "");
  showToast("قفل حذف شد", "success");
  renderAppLockForm();
}

async function init() {
  await hydrateState();
  await checkAppLock();
  document.documentElement.style.setProperty("--font-scale", String(state.fontScale));

  renderGroupAddForm();
  renderGroupsList();
  renderParentGroupAddForm();
  renderParentGroupsList();
  populateManualGroupSelect();
  renderProductsList();
  renderLineGroupCheckboxes();
  loadSettingsFormFromState();
  populateSingleReportSelectors();

  renderTargetsTab();
  loadSellersFormFromState();
  renderBaselineTab();
  renderHistoryTab();
  renderReportStyleForm();
  renderAppLockForm();
  updateBackupStatusText();
  checkBackupReminder();

  bindNavigation();
  bindReportsView();
  bindManagementView();
  bindSettingsView();

  if ("serviceWorker" in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) showUpdateBanner();
    });
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => {
        // check for a newer sw.js periodically while the app stays open
        // (GitHub Pages/browser HTTP caching would otherwise delay this)
        setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      })
      .catch(() => {});
  }
}

/** Shows a small persistent bar prompting the user to reload once a newer
 * deployed version has taken over as the active service worker — this is
 * how "update the app" works for a GitHub-Pages-hosted PWA with no server
 * to push notifications from. */
function showUpdateBanner() {
  if ($("#update-banner")) return;
  const bar = document.createElement("div");
  bar.id = "update-banner";
  bar.innerHTML = `
    <span>${icon("upload-cloud")} نسخه‌ی جدید SalesFlow آماده است</span>
    <button id="btn-update-now" class="btn btn-primary btn-sm">بروزرسانی</button>`;
  document.body.prepend(bar);
  $("#btn-update-now").addEventListener("click", () => location.reload());
}

/* ---------------------------------------------------------
   0d. یادآوری پشتیبان‌گیری — همه‌چیز فقط رو همین مرورگر ذخیره می‌شود،
   پس یادآوری منظم برای گرفتن فایل پشتیبان اهمیت دارد.
   --------------------------------------------------------- */
const BACKUP_REMINDER_DAYS = 7;

function daysSince(isoString) {
  if (!isoString) return Infinity;
  const diffMs = Date.now() - new Date(isoString).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function updateBackupStatusText() {
  const el = $("#backup-status-text");
  if (!el) return;
  if (!state.lastBackupAt) {
    el.textContent = "هنوز هیچ پشتیبانی گرفته نشده.";
    return;
  }
  const d = daysSince(state.lastBackupAt);
  el.textContent = d === 0 ? "آخرین پشتیبان: امروز" : d === 1 ? "آخرین پشتیبان: دیروز" : `آخرین پشتیبان: ${d} روز پیش`;
}

function checkBackupReminder() {
  if (daysSince(state.lastBackupAt) >= BACKUP_REMINDER_DAYS) showBackupReminderBanner();
}

/** Inserted as a normal (non-fixed) element right at the top of <body> —
 * ahead of #app-shell — so it pushes the rest of the page down instead of
 * floating over it. That's what avoids the earlier bug where a fixed-position
 * banner sat on top of (and silently ate clicks on) the tab bar underneath it. */
function showBackupReminderBanner() {
  if ($("#backup-reminder-banner")) return;
  const bar = document.createElement("div");
  bar.id = "backup-reminder-banner";
  const d = daysSince(state.lastBackupAt);
  const msg = d === Infinity ? "هنوز هیچ پشتیبانی از این برنامه نگرفته‌اید" : `آخرین پشتیبان‌گیری ${d} روز پیش بوده`;
  bar.innerHTML = `
    <span>${icon("alert-triangle")} ${escapeHtml(msg)} — یادت نره!</span>
    <button id="btn-backup-now" class="btn btn-primary btn-sm">دریافت پشتیبان</button>
    <button id="btn-dismiss-backup-reminder" class="btn-close-banner" aria-label="بستن">✕</button>`;
  // sits right after the update banner if one is already showing, so the two
  // stack in normal document flow (update banner on top) rather than overlapping
  const updateBar = $("#update-banner");
  if (updateBar) updateBar.insertAdjacentElement("afterend", bar);
  else document.body.prepend(bar);
  $("#btn-backup-now").addEventListener("click", handleExportBackup);
  $("#btn-dismiss-backup-reminder").addEventListener("click", hideBackupReminderBanner);
}

function hideBackupReminderBanner() {
  const bar = $("#backup-reminder-banner");
  if (bar) bar.remove();
}

document.addEventListener("DOMContentLoaded", init);
