const DEFAULT_PLACE = { lat: 37.5665, lon: 126.978, city: "서울", country: "대한민국" };
let currentPlace = { ...DEFAULT_PLACE };
let activeWeatherTimezone = "Asia/Seoul";
let searchSuggestTimer = null;
let searchSuggestions = [];
let searchSuggestReqSeq = 0;
let lastWeatherData = null;
let selectedTimeStepHours = 1;
let mobileTimeStepAutoLocked = false;
let mobileTimeStepUnlocked = false;
let timeSlotsTapState = null;
let lastMobileTimeStepCycleAt = 0;
let suppressTimeSlotsTapUntil = 0;
const RECENT_SEARCH_KEY = "weather_story_recent_searches_v1";
const PREFERRED_UI_SCALE = 1.1;
const MIN_DESKTOP_UI_SCALE = 0.9;

const el = {
  updatedAt: document.getElementById("updatedAt"),
  locationLabel: document.getElementById("locationLabel"),
  searchStatus: document.getElementById("searchStatus"),
  openSearchBtn: document.getElementById("openSearchBtn"),
  closeSearchBtn: document.getElementById("closeSearchBtn"),
  searchModal: document.getElementById("searchModal"),
  searchBackdrop: document.getElementById("searchBackdrop"),
  searchForm: document.getElementById("searchForm"),
  searchInput: document.getElementById("searchInput"),
  searchSuggest: document.getElementById("searchSuggest"),
  searchBtn: document.getElementById("searchBtn"),
  nowIcon: document.getElementById("nowIcon"),
  nowTemp: document.getElementById("nowTemp"),
  nowState: document.getElementById("nowState"),
  nowCompareChip: document.getElementById("nowCompareChip"),
  nowSummary: document.getElementById("nowSummary"),
  timeSummary: document.getElementById("timeSummary"),
  timeStepToggle: document.getElementById("timeStepToggle"),
  timeSlots: document.getElementById("timeSlots"),
  weekList: document.getElementById("weekList"),
  weekSummary: document.getElementById("weekSummary"),
  weatherSkeleton: document.getElementById("weatherSkeleton"),
  refresh: document.getElementById("refreshBtn"),
};

const WEATHER_TEXT = {
  0: "맑음", 1: "대체로 맑음", 2: "구름 조금", 3: "흐림", 45: "안개", 48: "짙은 안개",
  51: "약한 이슬비", 53: "이슬비", 55: "강한 이슬비", 61: "약한 비", 63: "비", 65: "강한 비",
  71: "약한 눈", 73: "눈", 75: "강한 눈", 80: "소나기", 81: "강한 소나기", 82: "매우 강한 소나기",
  95: "뇌우", 96: "우박 동반 뇌우", 99: "강한 우박 동반 뇌우",
};

function weatherText(code) { return WEATHER_TEXT[code] || "알 수 없음"; }
function isRain(code) { return [51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(code); }
function isSnow(code) { return [71,73,75,77,85,86].includes(code); }
function isShowerCode(code) { return [80,81,82].includes(code); }
function withLineBreaks(text) {
  return String(text).split(". ").map((p) => p.trim()).filter(Boolean).map((p) => (p.endsWith(".") ? p : `${p}.`)).join("<br />");
}
function formatKoreanHour(hour) {
  const h = Number(hour) || 0;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (h <= 6) return `새벽 ${h12}시`;
  if (h < 12) return `오전 ${h12}시`;
  return `오후 ${h12}시`;
}
function isMobileViewport() {
  return window.matchMedia("(max-width: 1020px)").matches;
}
function rerenderCachedWeatherIfReady() {
  if (lastWeatherData) render(lastWeatherData);
}
function setWeatherLoadingSkeleton(visible) {
  if (!el.weatherSkeleton) return;
  el.weatherSkeleton.hidden = !visible;
}
function parseApiDateTime(value) {
  const s = String(value || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] ? Number(m[4]) : 0,
    minute: m[5] ? Number(m[5]) : 0,
    second: m[6] ? Number(m[6]) : 0,
    dateKey: `${m[1]}-${m[2]}-${m[3]}`,
  };
}

function dateKeyToUtcMs(dateKey) {
  const m = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function diffDateKeys(targetKey, baseKey) {
  const targetMs = dateKeyToUtcMs(targetKey);
  const baseMs = dateKeyToUtcMs(baseKey);
  if (!Number.isFinite(targetMs) || !Number.isFinite(baseMs)) return 0;
  return Math.round((targetMs - baseMs) / 86400000);
}

function shiftDateKey(dateKey, days) {
  const ms = dateKeyToUtcMs(dateKey);
  if (!Number.isFinite(ms)) return dateKey;
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

function getNowZonedParts(timeZone = activeWeatherTimezone) {
  try {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(
      dtf
        .formatToParts(new Date())
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value]),
    );
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    };
  } catch {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return {
      year: y,
      month: Number(m),
      day: Number(d),
      hour: now.getHours(),
      minute: now.getMinutes(),
      second: now.getSeconds(),
      dateKey: `${y}-${m}-${d}`,
    };
  }
}

function getApiDateKey(value) {
  return String(value || "").slice(0, 10);
}

function getApiHour(value) {
  const parsed = parseApiDateTime(value);
  return parsed ? parsed.hour : 0;
}

function toHour(iso) { return formatKoreanHour(getApiHour(iso)); }
function toHourLabelWithDay(iso) {
  return formatKoreanHour(getApiHour(iso));
}
function hourPhaseClass(hour) {
  const h = Number(hour) || 0;
  if (h >= 0 && h <= 4) return "late-night";
  if (h >= 6 && h <= 10) return "morning";
  if (h >= 11 && h <= 16) return "day";
  if (h === 17) return "evening";
  if (h >= 18 && h <= 22) return "twilight";
  return "night"; // includes dawn
}
function getDayOffsetFromToday(iso) {
  return diffDateKeys(getApiDateKey(iso), getNowZonedParts().dateKey);
}
function toNearTimeLabel(iso) {
  const target = parseApiDateTime(iso);
  const now = getNowZonedParts();
  if (!target) return "지금";
  const diffHours = Math.round(
    (diffDateKeys(target.dateKey, now.dateKey) * 24)
    + (target.hour - now.hour)
    + ((target.minute - now.minute) / 60),
  );
  if (diffHours <= 0) return "지금";
  if (diffHours <= 3) return `${diffHours}시간 뒤`;
  const hour24 = target.hour;
  const meridiem = hour24 < 12 ? "오전" : "오후";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${meridiem} ${hour12}시쯤`;
}

function weekdayIndexFromDateKey(dateKey) {
  const ms = dateKeyToUtcMs(dateKey);
  if (!Number.isFinite(ms)) return 0;
  return new Date(ms).getUTCDay();
}

function weekdayShortKoFromDateKey(dateKey) {
  const labels = ["일", "월", "화", "수", "목", "금", "토"];
  return labels[weekdayIndexFromDateKey(dateKey)] || "일";
}

function weekdayStartPhrase(dayShort) {
  const day = String(dayShort || "").trim();
  if (!day) return "이날부터";
  return `${day}요일부터`;
}

function withSubjectParticle(word) {
  const s = String(word || "");
  const last = s.charCodeAt(s.length - 1);
  if (!s) return s;
  if (last < 0xac00 || last > 0xd7a3) return `${s}가`;
  const hasBatchim = (last - 0xac00) % 28 !== 0;
  return `${s}${hasBatchim ? "이" : "가"}`;
}

function formatUpdatedAtLabel(date = new Date(), timeZone = activeWeatherTimezone, options = {}) {
  const { timeOnly = false } = options;
  try {
    const dtf = new Intl.DateTimeFormat("ko-KR", {
      timeZone,
      year: timeOnly ? undefined : "numeric",
      month: timeOnly ? undefined : "numeric",
      day: timeOnly ? undefined : "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
    if (timeOnly) return `${map.hour}:${map.minute}:${map.second} 기준`;
    return `${map.year}.${map.month}.${map.day} ${map.hour}:${map.minute}:${map.second} 기준`;
  } catch {
    return `${date.toLocaleString("ko-KR", { timeZone })} 기준`;
  }
}

function formatLocationLabel(place, { compact = false } = {}) {
  const city = String(place?.city || "").trim();
  const country = String(place?.country || "").trim();
  if (!compact) return country ? `${city}, ${country}` : city;
  const shortCity = city.split(",")[0]?.trim() || city;
  return country ? `${shortCity}, ${country}` : shortCity;
}

function updateAdaptiveUiScale() {
  const root = document.documentElement;
  const isMobile = window.matchMedia("(max-width: 1020px)").matches;
  if (isMobile) {
    root.style.setProperty("--ui-scale", "1");
    return;
  }

  root.style.setProperty("--ui-scale", String(PREFERRED_UI_SCALE));

  requestAnimationFrame(() => {
    const doc = document.documentElement;
    const contentHeight = Math.max(doc.scrollHeight, document.body?.scrollHeight || 0);
    const viewportHeight = window.innerHeight || doc.clientHeight || 0;
    if (!viewportHeight || !contentHeight) return;

    // If content would be clipped in desktop mode (overflow hidden), reduce scale proportionally.
    if (contentHeight <= viewportHeight) return;
    const fitRatio = viewportHeight / contentHeight;
    const nextScale = Math.max(MIN_DESKTOP_UI_SCALE, Math.min(PREFERRED_UI_SCALE, PREFERRED_UI_SCALE * fitRatio * 0.99));
    root.style.setProperty("--ui-scale", nextScale.toFixed(3));

    // Scale changes layout metrics used by guide bands / edge opacity.
    requestAnimationFrame(() => {
      updateWeekOutfitBubbleCollisionLift();
      updateWeekListSafePadding();
      updateWeeklyGuideLines();
      updateHourlyGuideBand();
      updateScrollEdgeOpacity();
    });
  });
}

function countryNameKo(code) {
  try {
    if (!code) return "";
    const dn = new Intl.DisplayNames(["ko-KR"], { type: "region" });
    return dn.of(code) || code;
  } catch {
    return code || "";
  }
}

function normalizeSearchQueries(input) {
  const raw = String(input || "").trim();
  if (!raw) return [];
  const clean = raw.replace(/\s+/g, " ");
  const noSpace = clean.replace(/\s+/g, "");
  const suffixPairs = [
    ["특별시", ""],
    ["광역시", ""],
    ["특별자치시", ""],
    ["특별자치도", ""],
    ["자치시", ""],
    ["자치도", ""],
    ["시", ""],
    ["도", ""],
  ];
  const set = new Set([clean]);
  for (const [suffix, replacement] of suffixPairs) {
    if (clean.endsWith(suffix)) set.add(clean.slice(0, -suffix.length) + replacement);
    else set.add(`${clean}${suffix}`);
  }
  const aliases = {
    서울: ["서울특별시"],
    부산: ["부산광역시"],
    대구: ["대구광역시"],
    인천: ["인천광역시"],
    광주: ["광주광역시"],
    대전: ["대전광역시"],
    울산: ["울산광역시"],
    세종: ["세종특별자치시"],
    제주: ["제주도", "제주시", "제주특별자치도"],
    제주도: ["제주", "제주시", "제주특별자치도"],
    제주특별자치도: ["제주", "제주도", "제주시"],
    수원: ["수원시"],
    성남: ["성남시"],
    용인: ["용인시"],
    고양: ["고양시"],
    창원: ["창원시"],
    포항: ["포항시"],
    전주: ["전주시"],
    청주: ["청주시"],
    천안: ["천안시"],
    경산: ["경산시"],
  };
  for (const key of [clean, noSpace]) {
    if (aliases[key]) {
      aliases[key].forEach((v) => set.add(v));
    }
  }

  // 한국 검색에서 자주 쓰는 "OO역/OO터미널/OO공항" 입력을 행정명으로 축약
  const trimmedFacility = clean.replace(/(역|터미널|공항)$/u, "");
  if (trimmedFacility && trimmedFacility !== clean) {
    set.add(trimmedFacility);
    for (const [suffix] of suffixPairs) set.add(`${trimmedFacility}${suffix}`);
  }

  return [...set].map((v) => v.trim()).filter(Boolean);
}

async function geocodeOpenMeteo(name, language) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", language);
  url.searchParams.set("format", "json");
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.results?.length) return null;
  const q = String(name).replace(/\s+/g, "").toLowerCase();
  const scored = data.results.map((r) => {
    const n = String(r.name || "").replace(/\s+/g, "").toLowerCase();
    const a1 = String(r.admin1 || "").replace(/\s+/g, "").toLowerCase();
    let score = 0;
    if (String(r.country_code || "").toUpperCase() === "KR") score += 100;
    if (n === q) score += 80;
    if (n.startsWith(q)) score += 50;
    if (n.includes(q)) score += 30;
    if (a1.includes(q)) score += 10;
    if (typeof r.population === "number") score += Math.min(20, Math.log10(Math.max(1, r.population)));
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].r;
}

async function geocodeOpenMeteoCandidates(name, language, count = 5) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", String(count));
  url.searchParams.set("language", language);
  url.searchParams.set("format", "json");
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

async function geocodeNominatim(name) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", name);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("accept-language", "ko");
  url.searchParams.set("limit", "5");
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows?.length) return null;
  const r = rows[0];
  const parts = String(r.display_name || "").split(",").map((p) => p.trim()).filter(Boolean);
  return {
    latitude: Number(r.lat),
    longitude: Number(r.lon),
    name: parts[0] || name,
    country_code: "",
    country: parts[parts.length - 1] || "",
  };
}

async function reverseGeocodeNominatim(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("accept-language", "ko");
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const r = await res.json();
  const addr = r.address || {};
  const neighborhood =
    addr.neighbourhood ||
    addr.neighborhood ||
    addr.suburb ||
    addr.quarter ||
    addr.village ||
    addr.hamlet ||
    addr.city_district ||
    addr.borough;
  const cityLike = addr.city || addr.town || addr.county || addr.state || addr.province || addr.municipality;
  const country = addr.country || "";
  const localLabel =
    neighborhood && cityLike && neighborhood !== cityLike
      ? `${neighborhood}, ${cityLike}`
      : neighborhood || cityLike || "";
  return {
    city: localLabel || "현재 위치",
    country,
  };
}

async function resolvePlaceByKoreanQuery(query) {
  const candidates = normalizeSearchQueries(query);
  const uniqueCandidates = [...new Set(candidates)];
  for (const q of uniqueCandidates) {
    const rKo = await geocodeOpenMeteo(q, "ko");
    if (rKo) return rKo;
  }
  for (const q of uniqueCandidates) {
    const rDefault = await geocodeOpenMeteo(q, "en");
    if (rDefault) return rDefault;
  }
  for (const q of uniqueCandidates) {
    const rN = await geocodeNominatim(q);
    if (rN) return rN;
  }
  return null;
}

async function fetchSearchSuggestions(query) {
  const candidates = [...new Set(normalizeSearchQueries(query))];
  const batches = await Promise.all(
    candidates.slice(0, 4).map((q) => geocodeOpenMeteoCandidates(q, "ko", 5).catch(() => [])),
  );
  const rows = batches.flat();
  const seen = new Set();
  const scored = rows.map((r) => {
    const key = `${r.latitude},${r.longitude}`;
    const qNorm = String(query).replace(/\s+/g, "").toLowerCase();
    const n = String(r.name || "").replace(/\s+/g, "").toLowerCase();
    let score = 0;
    if (String(r.country_code || "").toUpperCase() === "KR") score += 100;
    if (n === qNorm) score += 80;
    if (n.startsWith(qNorm)) score += 50;
    if (n.includes(qNorm)) score += 30;
    return { r, key, score };
  }).sort((a, b) => b.score - a.score);
  const out = [];
  for (const item of scored) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item.r);
    if (out.length >= 5) break;
  }
  return out;
}

function closeSuggestions() {
  searchSuggestions = [];
  if (!el.searchSuggest) return;
  el.searchSuggest.hidden = true;
  el.searchSuggest.innerHTML = "";
}

function openSearchModal() {
  if (!el.searchModal) return;
  el.searchModal.hidden = false;
  requestAnimationFrame(() => {
    el.searchInput?.focus();
    const q = el.searchInput?.value.trim();
    if (!q) showRecentSuggestions();
  });
}

function closeSearchModal() {
  if (!el.searchModal) return;
  el.searchModal.hidden = true;
  closeSuggestions();
}

function renderSuggestions(items) {
  searchSuggestions = items;
  if (!el.searchSuggest) return;
  if (!items.length) {
    closeSuggestions();
    return;
  }
  el.searchSuggest.innerHTML = items.map((r, i) => {
    const country = r.country || countryNameKo(String(r.country_code || "").toUpperCase());
    const region = r._recent ? `최근 검색${country ? ` · ${country}` : ""}` : [r.admin1, country].filter(Boolean).join(", ");
    return `<button type="button" class="suggest-item ${r._recent ? "recent" : ""}" data-index="${i}"><span class="suggest-main">${r.name}</span><span class="suggest-sub">${region || "위치 정보"}</span></button>`;
  }).join("");
  el.searchSuggest.hidden = false;
}

function loadRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_SEARCH_KEY);
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => typeof r === "object" && r && Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude))).slice(0, 8);
  } catch {
    return [];
  }
}

function saveRecentSearch(placeLike) {
  try {
    const current = loadRecentSearches();
    const normalized = {
      name: placeLike.name || placeLike.city || "선택한 위치",
      country: placeLike.country || "",
      country_code: placeLike.country_code || "",
      admin1: placeLike.admin1 || "",
      latitude: Number(placeLike.latitude ?? placeLike.lat),
      longitude: Number(placeLike.longitude ?? placeLike.lon),
    };
    if (!Number.isFinite(normalized.latitude) || !Number.isFinite(normalized.longitude)) return;
    const key = `${normalized.name}|${normalized.latitude.toFixed(4)}|${normalized.longitude.toFixed(4)}`;
    const next = [normalized, ...current.filter((r) => `${r.name}|${Number(r.latitude).toFixed(4)}|${Number(r.longitude).toFixed(4)}` !== key)].slice(0, 5);
    localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

function showRecentSuggestions() {
  const recents = loadRecentSearches().map((r) => ({ ...r, _recent: true }));
  renderSuggestions(recents);
}

function applySelectedPlace(place, fallbackName) {
  currentPlace = {
    lat: Number(place.latitude),
    lon: Number(place.longitude),
    city: place.name || fallbackName || "선택한 위치",
    country: place.country || countryNameKo(String(place.country_code || "").toUpperCase()),
  };
}

function weatherIconSvg(code, big = false) {
  const cls = big ? "wicon big" : "wicon";
  if ([0, 1].includes(code)) {
    return `<svg class="${cls}" viewBox="0 0 64 64"><defs><radialGradient id="sunG" cx="40%" cy="35%"><stop offset="0%" stop-color="#ffe89a"/><stop offset="100%" stop-color="#ffb400"/></radialGradient></defs><circle cx="32" cy="32" r="16" fill="url(#sunG)"/><g stroke="#ffd86b" stroke-width="4" stroke-linecap="round"><line x1="32" y1="6" x2="32" y2="0"/><line x1="32" y1="64" x2="32" y2="58"/><line x1="6" y1="32" x2="0" y2="32"/><line x1="64" y1="32" x2="58" y2="32"/></g></svg>`;
  }
  if ([2, 3, 45, 48].includes(code)) {
    return `<svg class="${cls}" viewBox="0 0 64 64"><defs><linearGradient id="cloudG" x1="0" x2="1"><stop offset="0%" stop-color="#d7e4ff"/><stop offset="100%" stop-color="#8fa6d9"/></linearGradient></defs><ellipse cx="27" cy="34" rx="16" ry="11" fill="url(#cloudG)"/><ellipse cx="40" cy="30" rx="14" ry="10" fill="url(#cloudG)"/><rect x="15" y="34" width="35" height="12" rx="6" fill="url(#cloudG)"/></svg>`;
  }
  if (isRain(code)) {
    return `<svg class="${cls}" viewBox="0 0 64 64"><defs><linearGradient id="cloudRG" x1="0" x2="1"><stop offset="0%" stop-color="#d7e4ff"/><stop offset="100%" stop-color="#8fa6d9"/></linearGradient><linearGradient id="rainG" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#5fd4ff"/><stop offset="100%" stop-color="#2f7dff"/></linearGradient></defs><ellipse cx="27" cy="30" rx="16" ry="11" fill="url(#cloudRG)"/><ellipse cx="40" cy="27" rx="14" ry="10" fill="url(#cloudRG)"/><rect x="15" y="30" width="35" height="12" rx="6" fill="url(#cloudRG)"/><g stroke="url(#rainG)" stroke-width="4" stroke-linecap="round"><line x1="22" y1="48" x2="18" y2="56"/><line x1="32" y1="48" x2="28" y2="56"/><line x1="42" y1="48" x2="38" y2="56"/></g></svg>`;
  }
  return `<svg class="${cls}" viewBox="0 0 64 64"><circle cx="32" cy="32" r="14" fill="#9db2df"/></svg>`;
}

function dropIconSvg(probability = null) {
  const p = Number(probability);
  let tone = "mid";
  if (Number.isFinite(p)) {
    if (p <= 10) tone = "low";
    else if (p >= 50) tone = "high";
  }
  return `<svg class="drop-icon ${tone}" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5C6.7 3.4 4 6.6 4 9a4 4 0 1 0 8 0c0-2.4-2.7-5.6-4-7.5z" fill="currentColor"/></svg>`;
}

function clothesGlyphSvg() {
  return `<svg class="clothes-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.7 6.1c-.6-.3-1-1-1-1.8A2.3 2.3 0 0 1 12 2a2.3 2.3 0 0 1 2.3 2.3c0 .8-.4 1.5-1 1.8l6.8 4.2c1.8 1.1 1 3.9-1.1 3.9H4.9c-2.1 0-2.9-2.8-1.1-3.9l6.9-4.2Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function outfitIconSvg(kind) {
  if (kind === "padded") return `<svg class="wicon big" viewBox="0 0 64 64"><path d="M20 14h24l6 8-5 8v22H19V30l-5-8 6-8z" fill="#c9a66b"/><path d="M24 18h16v34H24z" fill="#b4894f"/></svg>`;
  if (kind === "coat") return `<svg class="wicon big" viewBox="0 0 64 64"><path d="M22 14h20l5 8-4 9v21H21V31l-4-9 5-8z" fill="#8ea3c9"/></svg>`;
  if (kind === "light") return `<svg class="wicon big" viewBox="0 0 64 64"><path d="M20 18h24l5 8-6 6v18H21V32l-6-6 5-8z" fill="#88b4ff"/></svg>`;
  return `<svg class="wicon big" viewBox="0 0 64 64"><path d="M18 18h28l6 8-7 7v17H19V33l-7-7 6-8z" fill="#ffd36b"/></svg>`;
}

function getTodayHourlyIndexes(times) {
  const today = getNowZonedParts().dateKey;
  const idx = [];
  for (let i = 0; i < times.length; i += 1) {
    const key = getApiDateKey(times[i]);
    if (key === today) idx.push(i);
  }
  return idx;
}

function buildNowFeature(weather) {
  const idx = getTodayHourlyIndexes(weather.hourly.time);
  const nowParts = getNowZonedParts();
  const nowHour = nowParts.hour;
  const future = idx.filter((i) => getApiHour(weather.hourly.time[i]) >= nowHour);
  const currentTemp = Math.round(weather.current.temperature_2m);
  const todayKey = nowParts.dateKey;
  const yesterdayKey = shiftDateKey(todayKey, -1);
  const yesterdaySameHourIdx = weather.hourly.time.findIndex((t, i) => {
    return (
      getApiHour(t) === nowHour &&
      getApiDateKey(t) === yesterdayKey &&
      typeof weather.hourly.temperature_2m[i] === "number"
    );
  });
  const yesterdaySameTemp =
    yesterdaySameHourIdx >= 0 ? Math.round(weather.hourly.temperature_2m[yesterdaySameHourIdx]) : null;
  const compareChip = (() => {
    if (yesterdaySameTemp === null) return { text: "", dir: "" };
    if (currentTemp > yesterdaySameTemp) return { text: `어제보다 ↑ ${currentTemp - yesterdaySameTemp}°`, dir: "rise" };
    if (currentTemp < yesterdaySameTemp) return { text: `어제보다 ↓ ${yesterdaySameTemp - currentTemp}°`, dir: "fall" };
    return { text: "어제보다 0°", dir: "" };
  })();

  if (!future.length) {
    return {
      now: currentTemp,
      code: weather.daily.weather_code[1],
      state: weatherText(weather.daily.weather_code[1]),
      rainProb: Math.round(weather.daily.precipitation_probability_max[1] || 0),
      compareChip,
      summary: "",
      trendLead: "오늘 남은 시간의 예보 데이터는 적어요.",
    };
  }

  const futureTemps = future.map((i) => Math.round(weather.hourly.temperature_2m[i]));
  const minTemp = Math.min(...futureTemps);
  const maxTemp = Math.max(...futureTemps);
  const minIdx = future.find((i) => Math.round(weather.hourly.temperature_2m[i]) === minTemp) || future[0];
  const maxIdx = future.find((i) => Math.round(weather.hourly.temperature_2m[i]) === maxTemp) || future[0];
  const currentSlotIdx = future.find((i) => getApiHour(weather.hourly.time[i]) === nowHour) || future[0];
  const downDelta = Math.round(weather.hourly.temperature_2m[currentSlotIdx]) - minTemp;

  let trendLead = "";
  if (downDelta >= 2) trendLead = `${toNearTimeLabel(weather.hourly.time[minIdx])} 지금보다 ${downDelta}° 내려가요.`;
  else {
    const upDelta = maxTemp - Math.round(weather.hourly.temperature_2m[currentSlotIdx]);
    if (upDelta >= 2) trendLead = `${toNearTimeLabel(weather.hourly.time[maxIdx])} 지금보다 ${upDelta}° 올라가요.`;
    else trendLead = "당분간 기온 변화가 적어요.";
  }

  return {
    now: currentTemp,
    code: weather.hourly.weather_code[currentSlotIdx] || weather.daily.weather_code[1],
    state: weatherText(weather.hourly.weather_code[currentSlotIdx] || weather.daily.weather_code[1]),
    rainProb: Math.round(weather.hourly.precipitation_probability[currentSlotIdx] || 0),
    compareChip,
    summary: "",
    trendLead,
  };
}

function buildOutfitForDay(weather, idx, compareIdx, compareLabel) {
  const max = Math.round(weather.daily.temperature_2m_max[idx]);
  const min = Math.round(weather.daily.temperature_2m_min[idx]);
  const mean = Math.round((max + min) / 2);
  const compareMax = Math.round(weather.daily.temperature_2m_max[compareIdx]);
  const compareMin = Math.round(weather.daily.temperature_2m_min[compareIdx]);
  const compareMean = Math.round((compareMax + compareMin) / 2);
  const meanDiff = mean - compareMean;
  const minDiff = min - compareMin;
  const range = max - min;

  const shortenOutfitTitle = (text) => {
    const raw = String(text || "");
    if (raw.length <= 20) return raw;
    return raw
      .replace("가벼운 아우터 + 얇은 긴팔 레이어드", "얇은 아우터 + 긴팔 레이어드")
      .replace("자켓 + 바람막이 + 긴팔 레이어드", "자켓·바람막이 + 긴팔")
      .replace("코트 + 니트 + 맨투맨 레이어드", "코트 + 니트 레이어드")
      .replace("가벼운 아우터 + 맨투맨", "아우터 + 맨투맨")
      .replace("패딩·울코트 + 니트 레이어드", "패딩 + 니트 레이어드");
  };
  const normalizeOutfitName = (text) => shortenOutfitTitle(
    String(text || "")
      .replaceAll("/", "·")
      .replace(/\s+또는\s+/g, "·")
      .replace(/\s*레이어드/g, "")
      .replace(/니트\s*\+\s*자켓/g, "자켓 + 니트")
      .replace(/맨투맨\s*\+\s*가벼운 아우터/g, "가벼운 아우터 + 맨투맨")
      .replace(/맨투맨·가벼운 아우터/g, "가벼운 아우터·맨투맨")
      .trim(),
  );

  let name = "가벼운 아우터";
  if (mean <= -4) name = "두꺼운 패딩 + 머플러";
  else if (mean <= 1) name = "패딩·헤비 코트";
  else if (mean <= 5) name = "코트·두꺼운 외투";
  else if (mean <= 9) name = "코트 + 얇은 이너";
  else if (mean <= 13) name = "자켓 + 니트";
  else if (mean <= 18) name = "가벼운 아우터 + 맨투맨";
  else if (mean <= 23) name = "얇은 긴팔";
  else name = "반팔 중심";

  const layeredOutfit = (() => {
    if (range < 8) return null;
    if (max <= 4) {
      return {
        outfitName: "패딩/울코트 + 니트 레이어드",
        actionText: "일교차가 커서 두꺼운 아우터에 니트·기모 이너를 레이어드하세요.",
      };
    }
    if (max <= 10) {
      return {
        outfitName: "코트 + 니트/맨투맨 레이어드",
        actionText: "일교차가 커서 코트류 아우터에 중간 두께 니트나 맨투맨을 레이어드하세요.",
      };
    }
    if (max <= 16) {
      return {
        outfitName: "자켓/바람막이 + 긴팔 레이어드",
        actionText: "일교차가 커서 탈착 쉬운 자켓·바람막이에 긴팔 이너를 레이어드하세요.",
      };
    }
    if (max <= 22) {
      return {
        outfitName: "가벼운 아우터 + 얇은 긴팔 레이어드",
        actionText: "일교차가 커서 얇은 아우터와 얇은 긴팔을 레이어드하고 낮엔 벗을 수 있게 준비하세요.",
      };
    }
    return {
      outfitName: "얇은 셔츠/가디건 레이어드",
      actionText: "일교차가 커서 반팔 위에 얇은 셔츠나 가디건을 레이어드하는 편이 좋아요.",
    };
  })();

  const sameBaseText = compareLabel === "오늘보다" ? "오늘이랑 비슷" : "어제랑 비슷";
  let compareText = "";
  if (meanDiff >= 2) compareText = "더 더워짐";
  else if (meanDiff <= -2) compareText = "더 추워짐";
  else compareText = sameBaseText;

  let rangeText = "";
  if (range >= 8) rangeText = "일교차 큼";
  else if (range <= 5) rangeText = "일교차 작음";
  else rangeText = "일교차 보통";

  if (layeredOutfit) {
    name = layeredOutfit.outfitName;
    compareText = compareText || sameBaseText;
  }
  name = normalizeOutfitName(name);

  const reasons = [];
  if (Math.abs(meanDiff) >= 2) {
    reasons.push(meanDiff > 0 ? `평균 +${Math.abs(meanDiff)}°` : `평균 -${Math.abs(meanDiff)}°`);
  }
  if (range >= 8) reasons.push("일교차 큼");
  else if (range <= 5) reasons.push("일교차 작음");
  if (minDiff <= -3) reasons.push(`최저 ${Math.abs(minDiff)}° 하강`);
  if (minDiff >= 3) reasons.push(`최저 ${Math.abs(minDiff)}° 상승`);
  const maxDiff = max - compareMax;
  if (maxDiff >= 4) reasons.push(`최고 ${Math.abs(maxDiff)}° 상승`);
  if (maxDiff <= -4) reasons.push(`최고 ${Math.abs(maxDiff)}° 하강`);

  return {
    label: idx === 1 ? "오늘" : "내일",
    outfitName: name,
    actionText: [compareText, rangeText].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(" · "),
    compareChip: meanDiff > 0
      ? { text: `${compareLabel} ↑ ${Math.abs(meanDiff)}°`, dir: "rise" }
      : meanDiff < 0
        ? { text: `${compareLabel} ↓ ${Math.abs(meanDiff)}°`, dir: "fall" }
        : { text: `${compareLabel} 0°`, dir: "" },
    reasons: reasons.slice(0, 3),
  };
}

function compactOutfitActionText(text) {
  return String(text || "").trim();
}

function applyPill(elm, chip) {
  if (!elm) return;
  if (!chip?.text) {
    elm.hidden = true;
    elm.textContent = "";
    elm.className = elm.className.split(" ").filter((c) => c !== "rise" && c !== "fall").join(" ");
    return;
  }
  elm.hidden = false;
  elm.textContent = chip.text;
  const base = elm.className.split(" ").filter((c) => c !== "rise" && c !== "fall");
  if (chip.dir) base.push(chip.dir);
  elm.className = base.join(" ");
}

function applyEdgeCardOpacity(container, selector, options = {}) {
  if (!container) return;
  const items = container.querySelectorAll(selector);
  if (!items.length) return;
  const {
    fadePx = 52,
    minOpacity = 0.42,
    sideInset = 8,
    metric = "center",
  } = options;
  const cRect = container.getBoundingClientRect();
  const leftEdge = cRect.left + sideInset;
  const rightEdge = cRect.right - sideInset;
  items.forEach((item) => {
    const r = item.getBoundingClientRect();
    let distToLeft;
    let distToRight;
    if (metric === "edge") {
      distToLeft = r.left - leftEdge;
      distToRight = rightEdge - r.right;
    } else {
      const centerX = r.left + (r.width / 2);
      distToLeft = centerX - leftEdge;
      distToRight = rightEdge - centerX;
    }
    const edgeDist = Math.min(distToLeft, distToRight);
    const t = Math.max(0, Math.min(1, edgeDist / fadePx));
    const opacity = minOpacity + ((1 - minOpacity) * t);
    item.style.opacity = opacity.toFixed(3);
  });
}

function updateScrollEdgeOpacity() {
  const isMobile = window.matchMedia("(max-width: 1020px)").matches;
  if (isMobile) {
    applyEdgeCardOpacity(el.timeSlots, ".hour-card", { fadePx: 44, minOpacity: 0.3, sideInset: 0, metric: "center" });
    applyEdgeCardOpacity(el.weekList, "li", { fadePx: 52, minOpacity: 0.3, sideInset: 0, metric: "center" });
    return;
  }
  applyEdgeCardOpacity(el.timeSlots, ".hour-card", { fadePx: 64, minOpacity: 0, sideInset: 0, metric: "edge" });
  applyEdgeCardOpacity(el.weekList, "li", { fadePx: 72, minOpacity: 0, sideInset: 0, metric: "edge" });
}

const wheelScrollAnimState = new WeakMap();

function animateHorizontalWheelScroll(container, deltaY) {
  if (!container || !Number.isFinite(deltaY) || deltaY === 0) return false;
  const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
  if (maxScroll <= 0) return false;

  let state = wheelScrollAnimState.get(container);
  if (!state) {
    state = { velocity: 0, rafId: 0 };
    wheelScrollAnimState.set(container, state);
  }

  state.velocity += deltaY * 0.12;

  if (state.rafId) return true;

  const tick = () => {
    state.rafId = 0;
    const currentMax = Math.max(0, container.scrollWidth - container.clientWidth);
    const current = container.scrollLeft;
    const next = Math.max(0, Math.min(currentMax, current + state.velocity));
    container.scrollLeft = next;

    state.velocity *= 0.9;

    if (next <= 0 || next >= currentMax) {
      state.velocity *= 0.7;
    }

    if (Math.abs(state.velocity) < 0.12) {
      state.velocity = 0;
      return;
    }

    state.rafId = requestAnimationFrame(tick);
  };

  state.rafId = requestAnimationFrame(tick);
  return true;
}

function applyHorizontalWheelDelta(container, e) {
  if (!container) return false;
  const absX = Math.abs(e.deltaX || 0);
  const absY = Math.abs(e.deltaY || 0);
  if (absY === 0) return false;
  if (absX > absY) return false;
  const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
  if (maxScroll <= 0) return false;
  if ((container.scrollLeft <= 0 && e.deltaY < 0) || (container.scrollLeft >= maxScroll && e.deltaY > 0)) {
    return false;
  }
  e.preventDefault();
  return animateHorizontalWheelScroll(container, e.deltaY);
}

function handleHorizontalWheelScroll(e) {
  applyHorizontalWheelDelta(e.currentTarget, e);
}

function getWheelSnapTargetByProximity(clientX, clientY) {
  const candidates = [el.timeSlots, el.weekList].filter(Boolean);
  let best = null;
  for (const node of candidates) {
    const r = node.getBoundingClientRect();
    const dx = clientX < r.left ? (r.left - clientX) : clientX > r.right ? (clientX - r.right) : 0;
    const dy = clientY < r.top ? (r.top - clientY) : clientY > r.bottom ? (clientY - r.bottom) : 0;
    const dist = Math.hypot(dx, dy);
    const withinHorizontalReach = dx <= 180;
    const withinVerticalReach = dy <= 140;
    if (!withinHorizontalReach || !withinVerticalReach) continue;
    if (!best || dist < best.dist) best = { node, dist };
  }
  return best?.node || null;
}

function handleDesktopNearbyHorizontalWheel(e) {
  if (window.matchMedia("(max-width: 1020px)").matches) return;
  if (e.defaultPrevented) return;
  const target = e.target;
  if (target && (target.closest("input, textarea, select, button") || target.closest("#searchModal:not([hidden])"))) return;
  if (target && (el.timeSlots?.contains(target) || el.weekList?.contains(target))) return;
  const snapTarget = getWheelSnapTargetByProximity(e.clientX, e.clientY);
  if (!snapTarget) return;
  applyHorizontalWheelDelta(snapTarget, e);
}

const dragScrollState = new WeakMap();

function onDragScrollPointerMove(e) {
  const container = e.currentTarget;
  const state = dragScrollState.get(container);
  if (!state?.dragging) return;
  const dx = e.clientX - state.startX;
  container.scrollLeft = state.startScrollLeft - dx;
  if (Math.abs(dx) > 3) state.moved = true;
}

function endDragScroll(container) {
  const state = dragScrollState.get(container);
  if (!state) return;
  state.dragging = false;
  requestAnimationFrame(() => container.classList.remove("is-dragging"));
}

function onDragScrollPointerUp(e) {
  endDragScroll(e.currentTarget);
}

function onDragScrollPointerCancel(e) {
  endDragScroll(e.currentTarget);
}

function onDragScrollPointerDown(e) {
  const container = e.currentTarget;
  if (e.pointerType === "touch") return;
  if (e.button !== 0) return;
  const state = dragScrollState.get(container) || {};
  state.dragging = true;
  state.moved = false;
  state.startX = e.clientX;
  state.startScrollLeft = container.scrollLeft;
  dragScrollState.set(container, state);
  container.classList.add("is-dragging");
  container.setPointerCapture?.(e.pointerId);
}

function installDragScroll(container) {
  if (!container) return;
  container.addEventListener("pointerdown", onDragScrollPointerDown);
  container.addEventListener("pointermove", onDragScrollPointerMove);
  container.addEventListener("pointerup", onDragScrollPointerUp);
  container.addEventListener("pointercancel", onDragScrollPointerCancel);
  container.addEventListener("lostpointercapture", onDragScrollPointerCancel);
}

function scrollCardToSecondSlot(container, selector) {
  if (!container) return;
  const targetCard = container.querySelector(selector);
  if (!targetCard) return;
  const firstCard = container.querySelector(selector.includes("li") ? "li" : ".hour-card");
  const cardGap = Number.parseFloat(getComputedStyle(container).columnGap || getComputedStyle(container).gap || "8") || 8;
  const cardWidth = firstCard ? firstCard.offsetWidth : targetCard.offsetWidth;
  const isMobile = window.matchMedia("(max-width: 1020px)").matches;
  const beforeSlots = isMobile ? 1.5 : 2.0; // shift target card 0.5 card to the left from previous setting
  const beforeWidth = (cardWidth + cardGap) * beforeSlots;
  const target = targetCard.offsetLeft - beforeWidth;
  const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
  container.scrollLeft = Math.max(0, Math.min(maxScroll, Math.round(target)));
}

function updateWeekListSafePadding() {
  if (!el.weekList) return;
  const baseTop = 56;
  const baseBottom = 64;
  let extraTop = 0;
  let extraBottom = 0;
  const cards = el.weekList.querySelectorAll("li");
  cards.forEach((card) => {
    const cardRect = card.getBoundingClientRect();
    const topBubble = card.querySelector(".week-card-bubble");
    const bottomBubble = card.querySelector(".week-event-bubble");
    if (topBubble) {
      const r = topBubble.getBoundingClientRect();
      extraTop = Math.max(extraTop, Math.ceil(cardRect.top - r.top));
    }
    if (bottomBubble) {
      const r = bottomBubble.getBoundingClientRect();
      extraBottom = Math.max(extraBottom, Math.ceil(r.bottom - cardRect.bottom));
    }
  });
  el.weekList.style.setProperty("--week-pad-top", `${baseTop + Math.max(0, extraTop)}px`);
  el.weekList.style.setProperty("--week-pad-bottom", `${baseBottom + Math.max(0, extraBottom)}px`);
}

function updateWeekOutfitBubbleCollisionLift() {
  if (!el.weekList) return;
  const cards = [...el.weekList.querySelectorAll("li")];
  cards.forEach((card) => {
    const bubble = card.querySelector(".week-card-bubble");
    if (bubble) bubble.style.setProperty("--bubble-lift", "0px");
  });

  // Measure after reset, then lift only bubbles that collide with neighboring cards.
  cards.forEach((card) => {
    const bubble = card.querySelector(".week-card-bubble");
    if (!bubble) return;
    const bubbleRect = bubble.getBoundingClientRect();
    let overlapTop = 0;
    for (const other of cards) {
      if (other === card) {
        const ownIcon = other.querySelector(".week-icon-lg");
        if (ownIcon) {
          const ir = ownIcon.getBoundingClientRect();
          const overlapsX = bubbleRect.right > ir.left && bubbleRect.left < ir.right;
          const overlapsY = bubbleRect.bottom > ir.top && bubbleRect.top < ir.bottom;
          if (overlapsX && overlapsY) {
            overlapTop = Math.max(overlapTop, Math.ceil(bubbleRect.bottom - ir.top) + 8);
          }
        }
        continue;
      }

      const collisionRects = [other.getBoundingClientRect()];
      const icon = other.querySelector(".week-icon-lg");
      if (icon) collisionRects.push(icon.getBoundingClientRect());

      for (const r of collisionRects) {
        const overlapsX = bubbleRect.right > r.left && bubbleRect.left < r.right;
        const overlapsY = bubbleRect.bottom > r.top && bubbleRect.top < r.bottom;
        if (!overlapsX || !overlapsY) continue;
        overlapTop = Math.max(overlapTop, Math.ceil(bubbleRect.bottom - r.top) + 8);
      }
    }
    if (overlapTop > 0) {
      bubble.style.setProperty("--bubble-lift", `${overlapTop}px`);
    }
  });
}

function updateWeeklyGuideLines() {
  if (!el.weekList) return;
  const todayCard = el.weekList.querySelector("li.week-today");
  if (!todayCard) return;
  const wrap = el.weekList.closest(".scroll-fade-wrap");
  if (!wrap) return;
  const wrapRect = wrap.getBoundingClientRect();
  const cardRect = todayCard.getBoundingClientRect();
  const top = Math.round(cardRect.top - wrapRect.top);
  const bottom = Math.round(cardRect.bottom - wrapRect.top);
  wrap.style.setProperty("--band-top", `${top}px`);
  wrap.style.setProperty("--band-height", `${Math.max(0, bottom - top)}px`);
  wrap.classList.add("has-band");
}

function updateHourlyGuideBand() {
  if (!el.timeSlots) return;
  const nearCard = el.timeSlots.querySelector(".hour-card.near-now");
  if (!nearCard) return;
  const wrap = el.timeSlots.closest(".scroll-fade-wrap");
  if (!wrap) return;
  const wrapRect = wrap.getBoundingClientRect();
  const cardRect = nearCard.getBoundingClientRect();
  const top = Math.round(cardRect.top - wrapRect.top);
  const bottom = Math.round(cardRect.bottom - wrapRect.top);
  wrap.style.setProperty("--band-top", `${top}px`);
  wrap.style.setProperty("--band-height", `${Math.max(0, bottom - top)}px`);
  wrap.classList.add("has-band");
}

function buildTimeFeature(weather) {
  const now = getNowZonedParts();
  const stepHours = Math.max(1, Math.min(3, Number(selectedTimeStepHours) || 1));
  const candidates = [];
  for (let i = 0; i < weather.hourly.time.length; i += 1) {
    const d = parseApiDateTime(weather.hourly.time[i]);
    if (!d) continue;
    if (d.minute !== 0) continue;
    const relMinutes = (diffDateKeys(d.dateKey, now.dateKey) * 24 * 60)
      + ((d.hour * 60 + d.minute) - (now.hour * 60 + now.minute));
    candidates.push({
      hour: toHourLabelWithDay(weather.hourly.time[i]),
      hourNum: d.hour,
      dayOffset: diffDateKeys(d.dateKey, now.dateKey),
      code: weather.hourly.weather_code[i],
      temp: Math.round(weather.hourly.temperature_2m[i]),
      rainProb: Math.round(weather.hourly.precipitation_probability[i] || 0),
      relMinutes,
    });
  }

  const dayRange = Math.round(weather.daily.temperature_2m_max[1] - weather.daily.temperature_2m_min[1]);
  const rangeText = dayRange >= 8 ? "오늘 일교차가 큰 편이에요." : dayRange <= 5 ? "오늘 일교차가 작은 편이에요." : "오늘 일교차는 보통 수준이에요.";

  let nearCandidateIdx = 0;
  let nearGap = Infinity;
  candidates.forEach((s, i) => {
    const gap = Math.abs(s.relMinutes);
    if (gap < nearGap) {
      nearGap = gap;
      nearCandidateIdx = i;
    }
  });

  const sampled = candidates.filter((_, i) => Math.abs(i - nearCandidateIdx) % stepHours === 0);
  const sampledNearIdx = sampled.findIndex((s) => s.relMinutes === candidates[nearCandidateIdx]?.relMinutes);
  const pastCount = Math.round(24 / stepHours);
  const totalCount = Math.round(72 / stepHours) + 1;
  const startIdx = Math.max(0, sampledNearIdx - pastCount);
  const slots = sampled.slice(startIdx, startIdx + totalCount);
  const nearSlotIdx = slots.findIndex((s) => s.relMinutes === candidates[nearCandidateIdx]?.relMinutes);

  for (let i = 0; i < slots.length; i += 1) {
    slots[i].isNearNow = i === nearSlotIdx;
    slots[i].delta = 0;
    slots[i].deltaDir = "";
    if (i > 0) {
      const d = slots[i].temp - slots[i - 1].temp;
      slots[i].delta = d;
      if (d >= 3) slots[i].deltaDir = "up";
      else if (d <= -3) slots[i].deltaDir = "down";
    }
  }

  if (slots.length) {
    const temps = slots.map((s) => s.temp);
    const minT = Math.min(...temps);
    const maxT = Math.max(...temps);
    const range = Math.max(1, maxT - minT);
    for (const s of slots) {
      const normalized = (s.temp - minT) / range; // 0..1
      const offset = Math.round((1 - normalized) * 56); // colder -> lower card
      s.offsetPx = offset;
    }
  }

  for (const s of slots) {
    s.note = "";
    s.noteType = "";
  }
  const wetSlot = (s) => isRain(s.code) || isSnow(s.code) || s.rainProb >= 40;
  const wetRuns = [];
  let runStart = -1;
  for (let i = 0; i < slots.length; i += 1) {
    if (wetSlot(slots[i])) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      wetRuns.push({ start: runStart, end: i - 1 });
      runStart = -1;
    }
  }
  if (runStart !== -1) wetRuns.push({ start: runStart, end: slots.length - 1 });
  const wetNounForRun = (start, end) => {
    let rain = 0;
    let snow = 0;
    let shower = 0;
    for (let i = start; i <= end; i += 1) {
      if (isSnow(slots[i].code)) snow += 1;
      if (isRain(slots[i].code) || slots[i].rainProb >= 40) rain += 1;
      if (isShowerCode(slots[i].code)) shower += 1;
    }
    return { noun: snow > rain ? "눈" : "비", shower };
  };
  wetRuns.forEach((run, idx) => {
    const durationH = (run.end - run.start + 1);
    const { noun, shower } = wetNounForRun(run.start, run.end);
    let label = "";
    if (noun === "비" && shower >= 1 && durationH <= 4) label = durationH <= 2 ? "소나기 잠깐" : "소나기";
    else label = `${durationH}시간 ${noun}`;
    if (!slots[run.start].note) {
      slots[run.start].note = label;
      slots[run.start].noteType =
        label.includes("소나기") ? "shower"
        : label.includes("눈") ? "snow"
        : label.includes("비") ? "rain"
        : "rain";
    }

    const dryStart = run.end + 1;
    const nextRun = wetRuns[idx + 1];
    if (dryStart < slots.length) {
      const drySpanSlots = nextRun ? Math.max(0, nextRun.start - dryStart) : (slots.length - dryStart);
      const dryHours = drySpanSlots;
      if (dryHours >= 2) {
        if (nextRun && dryHours <= 8 && !slots[dryStart].note) {
          slots[dryStart].note = `${dryHours}시간 소강`;
          slots[dryStart].noteType = "lull";
        } else if (!nextRun && !slots[dryStart].note) {
          slots[dryStart].note = `${noun} 그침`;
          slots[dryStart].noteType = "end";
        }
      }
    }
  });

  for (let i = 1; i < slots.length; i += 1) {
    if (slots[i].note) continue;
    if (slots[i].delta >= 4) {
      slots[i].note = "기온 급상승";
      slots[i].noteType = "temp-up";
    } else if (slots[i].delta <= -4) {
      slots[i].note = "기온 급하강";
      slots[i].noteType = "temp-down";
    }
  }

  const todayOnly = slots.filter((s) => s.dayOffset === 0);
  if (todayOnly.length) {
    const tMax = Math.max(...todayOnly.map((s) => s.temp));
    const tMin = Math.min(...todayOnly.map((s) => s.temp));
    const tRange = tMax - tMin;
    const diurnalBucket = (hour) => {
      if (hour <= 5) return "새벽";
      if (hour <= 10) return "아침";
      if (hour <= 17) return "오후";
      return "밤";
    };
    if (tRange >= 8) {
      const cold = todayOnly.find((s) => s.temp === tMin && (s.hourNum <= 8 || s.hourNum >= 20)) || todayOnly.find((s) => s.temp === tMin);
      if (cold && !cold.note) {
        cold.note = `일교차 큰 ${diurnalBucket(cold.hourNum)}`;
        cold.noteType = "range-cold";
      }
    } else if (tRange <= 5) {
      const mild = todayOnly.find((s) => s.temp === tMin) || todayOnly[0];
      if (mild && !mild.note) {
        mild.note = "일교차 보통";
        mild.noteType = "range-mild";
      }
    }
  }

  return { summary: rangeText, slots };
}

function dayMarkerLabel(offset) {
  if (offset === 0) return "오늘";
  if (offset === 1) return "내일";
  if (offset === 2) return "모레";
  if (offset === -1) return "어제";
  if (offset === -2) return "2일전";
  if (offset < -2) return `${Math.abs(offset)}일전`;
  if (offset > 2) return `${offset}일 뒤`;
  return "";
}

function getHourlyIndexesForDayOffset(times, offset) {
  const out = [];
  for (let i = 0; i < times.length; i += 1) {
    if (getDayOffsetFromToday(times[i]) === offset) out.push(i);
  }
  return out;
}

function getDailyIndexByOffset(times, offset) {
  for (let i = 0; i < times.length; i += 1) {
    if (getDayOffsetFromToday(times[i]) === offset) return i;
  }
  return -1;
}

function analyzeRainWindowForDay(weather, dayOffset) {
  const idxs = getHourlyIndexesForDayOffset(weather.hourly.time, dayOffset);
  if (!idxs.length) return null;
  const rainy = idxs.filter((i) => isRain(weather.hourly.weather_code[i]) || (weather.hourly.precipitation_probability[i] || 0) >= 40);
  if (!rainy.length) return { rainy: false };
  const hours = rainy.map((i) => getApiHour(weather.hourly.time[i])).sort((a, b) => a - b);
  const showerHours = rainy.filter((i) => isShowerCode(weather.hourly.weather_code[i])).map((i) => getApiHour(weather.hourly.time[i]));
  const first = hours[0];
  const last = hours[hours.length - 1];
  const span = Math.max(0, last - first);
  const mostlyLateNight = last <= 6;
  const startsLateNight = first >= 22 || first <= 4;
  const endsMorning = last <= 9;
  const shortWindow = span <= 4;
  const segments = [];
  let segStart = hours[0];
  let prev = hours[0];
  for (let i = 1; i < hours.length; i += 1) {
    const h = hours[i];
    if (h <= prev + 1) {
      prev = h;
      continue;
    }
    segments.push({ start: segStart, end: prev, rainHours: (prev - segStart + 1) });
    segStart = h;
    prev = h;
  }
  segments.push({ start: segStart, end: prev, rainHours: (prev - segStart + 1) });
  let maxDryGapHours = 0;
  for (let i = 1; i < segments.length; i += 1) {
    const gap = Math.max(0, segments[i].start - segments[i - 1].end - 1);
    if (gap > maxDryGapHours) maxDryGapHours = gap;
  }
  const longestRainHours = Math.max(...segments.map((s) => s.rainHours));
  return {
    rainy: true, first, last, span, mostlyLateNight, startsLateNight, endsMorning, shortWindow,
    rainyHourCount: hours.length,
    showerHourCount: showerHours.length,
    segments,
    maxDryGapHours,
    longestRainHours,
  };
}

function buildWeekly(weather) {
  const todayKey = getNowZonedParts().dateKey;
  const allTimes = weather.daily.time || [];
  const todayAllIdx = allTimes.findIndex((d) => getApiDateKey(d) === todayKey);
  const fallbackTodayIdx = todayAllIdx >= 0 ? todayAllIdx : 1;
  const start = Math.max(0, fallbackTodayIdx - 6);
  const end = Math.min(allTimes.length, fallbackTodayIdx + 15);
  const todayIdx = fallbackTodayIdx - start;

  const days = allTimes.slice(start, end).map((d, i) => {
    const sourceIdx = start + i;
    const parsed = parseApiDateTime(d);
    const dateKey = parsed?.dateKey || getApiDateKey(d);
    const weekdayShort = weekdayShortKoFromDateKey(dateKey);
    const md = parsed ? `${parsed.month}/${parsed.day}` : String(d);
    const dayOffset = diffDateKeys(dateKey, todayKey);
    const max = Math.round(weather.daily.temperature_2m_max[sourceIdx]);
    const min = Math.round(weather.daily.temperature_2m_min[sourceIdx]);
    const mean = (max + min) / 2;
    const relativeLabel =
      dayOffset === -1 ? "어제"
      : dayOffset === 0 ? "오늘"
      : dayOffset === 1 ? "내일"
      : dayOffset < -1 ? `${Math.abs(dayOffset)}일 전`
      : `${dayOffset}일 후`;
    return {
      day: weekdayShort,
      weekdayShort,
      dayOffset,
      relativeLabel,
      weekdayIndex: weekdayIndexFromDateKey(dateKey),
      dateLabel: md,
      code: weather.daily.weather_code[sourceIdx],
      desc: weatherText(weather.daily.weather_code[sourceIdx]),
      max,
      min,
      mean,
      maxClass: "",
      minClass: "",
      dMax: 0,
      dMin: 0,
      dMean: 0,
      rainProb: Math.round(weather.daily.precipitation_probability_max[sourceIdx] || 0),
      annotation: null,
    };
  });

  for (let i = 1; i < days.length; i += 1) {
    const dMax = Math.round(days[i].max - days[i - 1].max);
    const dMin = Math.round(days[i].min - days[i - 1].min);
    const dMean = Math.round(days[i].mean - days[i - 1].mean);
    days[i].dMax = dMax;
    days[i].dMin = dMin;
    days[i].dMean = dMean;

    if (dMax >= 5) days[i].maxClass = "rise";
    else if (dMax <= -5) days[i].maxClass = "fall";
    if (dMin >= 5) days[i].minClass = "rise";
    else if (dMin <= -5) days[i].minClass = "fall";
  }

  if (days.length) {
    const means = days.map((d) => d.mean);
    const minMean = Math.min(...means);
    const maxMean = Math.max(...means);
    const meanRange = Math.max(1, maxMean - minMean);
    for (const d of days) {
      const normalized = (d.mean - minMean) / meanRange;
      d.offsetPx = Math.round((1 - normalized) * 44);
    }
  }

  const rainyIdx = days
    .map((d, i) => ((d.dayOffset >= 0 && (isRain(d.code) || d.rainProb >= 40)) ? i : -1))
    .filter((i) => i >= 0);
  const rainRuns = [];
  if (rainyIdx.length) {
    let startRun = rainyIdx[0];
    let prevRun = rainyIdx[0];
    for (let i = 1; i < rainyIdx.length; i += 1) {
      const cur = rainyIdx[i];
      const prevOffset = days[prevRun].dayOffset;
      const curOffset = days[cur].dayOffset;
      if (curOffset === prevOffset + 1) {
        prevRun = cur;
        continue;
      }
      rainRuns.push({ startPos: startRun, endPos: prevRun });
      startRun = cur;
      prevRun = cur;
    }
    rainRuns.push({ startPos: startRun, endPos: prevRun });
  }
  const annotations = [];
  const shortRainTimePhrase = (timing) => {
    if (!timing?.rainy || !timing.shortWindow) return "";
    if (timing.mostlyLateNight) return "새벽에만";
    if (timing.endsMorning) return "오전에만";
    if (timing.first >= 12 && timing.last <= 18) return "오후에만";
    if (timing.first >= 18) return "저녁에만";
    return "";
  };
  const precipNounForDay = (pos) => (isSnow(days[pos].code) ? "눈" : "비");
  const wetSignalForDay = (pos) => ((isRain(days[pos].code) || isSnow(days[pos].code)) ? "code" : "prob");
  const timeHeadlineToken = (timing) => {
    const p = shortRainTimePhrase(timing);
    if (p === "새벽에만") return "새벽";
    if (p === "오전에만") return "오전";
    if (p === "오후에만") return "오후";
    if (p === "저녁에만") return "저녁";
    return "";
  };
  const singleDayWetHeadline = (pos) => {
    const noun = precipNounForDay(pos);
    const timing = analyzeRainWindowForDay(weather, days[pos].dayOffset);
    const timeToken = timeHeadlineToken(timing);
    const byCode = wetSignalForDay(pos) === "code";
    if (timeToken) return byCode ? `${timeToken} ${noun}` : `${timeToken} ${noun} 가능`;
    return byCode ? `하루동안 ${noun}` : `하루동안 ${noun} 가능`;
  };
  const rainPart = (() => {
    if (!rainyIdx.length) return "이번 주는 비 소식이 거의 없어요.";
    const firstRun = rainRuns[0];
    const firstPos = firstRun.startPos;
    const lastPos = firstRun.endPos;
    const yesterdayPos = days.findIndex((d) => d.dayOffset === -1);
    const yesterdayAlsoRainy = yesterdayPos >= 0 && (isRain(days[yesterdayPos].code) || isSnow(days[yesterdayPos].code) || days[yesterdayPos].rainProb >= 40);
    const offsetFirst = days[firstPos].dayOffset;
    const offsetLast = days[lastPos].dayOffset;
    const rainyDuration = Math.max(1, offsetLast - offsetFirst + 1);
    const firstRainTiming = analyzeRainWindowForDay(weather, offsetFirst);
    const lastRainTiming = analyzeRainWindowForDay(weather, offsetLast);
    const firstShortNightRain = firstRainTiming?.rainy && firstRainTiming.shortWindow && firstRainTiming.startsLateNight && firstRainTiming.endsMorning;
    const lastVisiblePos = days.length - 1;
    const firstRunTouchesEnd = lastPos === lastVisiblePos;
    const isSingleRainDay = rainyDuration === 1;

    const precipNounForRange = (startPos, endPos) => {
      let snowCount = 0;
      let rainCount = 0;
      for (let i = startPos; i <= endPos; i += 1) {
        if (isSnow(days[i].code)) snowCount += 1;
        else if (isRain(days[i].code) || days[i].rainProb >= 40) rainCount += 1;
      }
      return snowCount > rainCount ? "눈" : "비";
    };
    const wetSignalForRange = (startPos, endPos) => {
      for (let i = startPos; i <= endPos; i += 1) {
        if (isRain(days[i].code) || isSnow(days[i].code)) return "code";
      }
      return "prob";
    };
    const dayName = (pos) => `${days[pos].day}요일`;
    const rangeRainLabel = (startPos, endPos) => {
      const noun = precipNounForRange(startPos, endPos);
      const span = Math.max(1, days[endPos].dayOffset - days[startPos].dayOffset + 1);
      const byCode = wetSignalForRange(startPos, endPos) === "code";
      if (span === 1) return singleDayWetHeadline(startPos);
      if (span <= 4) return byCode ? `${span}일 연속 ${noun}` : `${span}일 연속 ${noun} 가능`;
      return byCode ? `${span}일 연속 ${noun}` : `${span}일 연속 ${noun} 가능`;
    };
    const continuedFromYesterdayLabel = (startPos, endPos) => {
      const noun = precipNounForRange(startPos, endPos);
      const span = Math.max(1, days[endPos].dayOffset - days[startPos].dayOffset + 1);
      if (days[startPos].dayOffset !== 0 || !yesterdayAlsoRainy) return "";
      return `${noun} ${span + 1}일째`;
    };
    const findDryRunAfter = (endPos) => {
      let startPos = -1;
      let endDryPos = -1;
      for (let i = endPos + 1; i < days.length; i += 1) {
        if (days[i].dayOffset < 0) continue;
        const rainy = isRain(days[i].code) || days[i].rainProb >= 40;
        if (!rainy) {
          if (startPos === -1) startPos = i;
          endDryPos = i;
          continue;
        }
        if (startPos !== -1) break;
      }
      return startPos === -1 ? null : { startPos, endPos: endDryPos };
    };
    const dryRunLabel = (dryRun) => {
      if (!dryRun) return "";
      const span = Math.max(1, days[dryRun.endPos].dayOffset - days[dryRun.startPos].dayOffset + 1);
      const startsToday = days[dryRun.startPos].dayOffset === 0;
      if (span === 1) return "비 소강";
      if (span === 2) return startsToday ? "오늘부터 2일 비 소강" : `${dayName(dryRun.startPos)}부터 2일 비 소강`;
      return startsToday ? "오늘부터 비 소강" : `${dayName(dryRun.startPos)}부터 비 소강`;
    };

    if (isSingleRainDay) {
      const oneDayTime = shortRainTimePhrase(firstRainTiming);
      const noun = precipNounForDay(firstPos);
      const continued = continuedFromYesterdayLabel(firstPos, lastPos);
      if (continued) {
        annotations.push({ dayIndex: firstPos, type: isSnow(days[firstPos].code) ? "snow" : "rain", text: continued });
        return continued;
      }
      if (oneDayTime) {
        annotations.push({ dayIndex: firstPos, type: isSnow(days[firstPos].code) ? "snow" : "rain", text: singleDayWetHeadline(firstPos) });
        return `${oneDayTime} ${withSubjectParticle(noun)} 올 예정이에요.`;
      }
      annotations.push({ dayIndex: firstPos, type: isSnow(days[firstPos].code) ? "snow" : "rain", text: singleDayWetHeadline(firstPos) });
      return `하루 동안 ${withSubjectParticle(noun)} 올 예정이에요.`;
    }

    if (offsetFirst === 0 && firstRunTouchesEnd) {
      const noun = precipNounForRange(firstPos, lastPos);
      const continued = continuedFromYesterdayLabel(firstPos, lastPos);
      if (continued) {
        annotations.push({ dayIndex: firstPos, type: noun === "눈" ? "snow" : "rain", text: continued });
        return continued;
      }
      annotations.push({ dayIndex: firstPos, type: noun === "눈" ? "snow" : "rain", text: `${rainyDuration}일 연속 ${noun}` });
      return `이번 주는 ${withSubjectParticle(noun)} 자주 이어질 예정이에요.`;
    }
    const longRainStreak = rainyDuration >= 4;

    if (firstRunTouchesEnd) {
      const noun = precipNounForRange(firstPos, lastPos);
      const continued = continuedFromYesterdayLabel(firstPos, lastPos);
      if (continued) {
        annotations.push({ dayIndex: firstPos, type: noun === "눈" ? "snow" : "rain", text: continued });
        return continued;
      }
      if (firstShortNightRain) annotations.push({ dayIndex: firstPos, type: noun === "눈" ? "snow" : "rain", text: singleDayWetHeadline(firstPos) });
      else if (longRainStreak) annotations.push({ dayIndex: firstPos, type: noun === "눈" ? "snow" : "rain", text: `${rainyDuration}일 연속 ${noun}` });
      else if (rainyDuration >= 2) annotations.push({ dayIndex: firstPos, type: noun === "눈" ? "snow" : "rain", text: rangeRainLabel(firstPos, lastPos) });
      else annotations.push({ dayIndex: firstPos, type: noun === "눈" ? "snow" : "rain", text: singleDayWetHeadline(firstPos) });
      return `${weekdayStartPhrase(days[firstPos].day)} ${withSubjectParticle(noun)} 올 예정이에요.`;
    }
    if (offsetFirst === 0) {
      const continued = continuedFromYesterdayLabel(firstPos, lastPos);
      if (continued) {
        const noun = precipNounForRange(firstPos, lastPos);
        annotations.push({ dayIndex: firstPos, type: noun === "눈" ? "snow" : "rain", text: continued });
        if (rainyDuration >= 3) {
          const dryRun = findDryRunAfter(lastPos);
          if (dryRun) annotations.push({ dayIndex: dryRun.startPos, type: "rain-end", text: dryRunLabel(dryRun) });
        }
        return rangeRainLabel(firstPos, lastPos);
      }
      const lastDayOnlyPhrase = shortRainTimePhrase(lastRainTiming);
      const dryRun = rainyDuration >= 3 ? findDryRunAfter(lastPos) : null;
      if (rainyDuration <= 2) {
        if (lastDayOnlyPhrase) {
          const noun = precipNounForDay(lastPos);
          annotations.push({ dayIndex: lastPos, type: noun === "눈" ? "snow" : "rain", text: singleDayWetHeadline(lastPos) });
          return rangeRainLabel(firstPos, lastPos);
        }
        annotations.push({ dayIndex: lastPos, type: precipNounForDay(lastPos) === "눈" ? "snow" : "rain", text: singleDayWetHeadline(lastPos) });
        return rangeRainLabel(firstPos, lastPos);
      }
      if (dryRun) {
        annotations.push({ dayIndex: dryRun.startPos, type: "rain-end", text: dryRunLabel(dryRun) });
      } else if (lastRainTiming?.rainy && lastRainTiming.shortWindow && lastRainTiming.mostlyLateNight) {
        const noun = precipNounForDay(lastPos);
        annotations.push({ dayIndex: lastPos, type: noun === "눈" ? "snow" : "rain", text: singleDayWetHeadline(lastPos) });
      }
      return rangeRainLabel(firstPos, lastPos);
    }
    {
      const noun = precipNounForRange(firstPos, lastPos);
      const type = noun === "눈" ? "snow" : "rain";
      if (firstShortNightRain) annotations.push({ dayIndex: firstPos, type, text: singleDayWetHeadline(firstPos) });
      else if (longRainStreak) annotations.push({ dayIndex: firstPos, type, text: `${rainyDuration}일 연속 ${noun}` });
      else if (rainyDuration >= 2) annotations.push({ dayIndex: firstPos, type, text: rangeRainLabel(firstPos, lastPos) });
      else annotations.push({ dayIndex: firstPos, type, text: singleDayWetHeadline(firstPos) });
    }

    if (rainyDuration >= 3) {
      const dryRun = findDryRunAfter(lastPos);
      if (dryRun) annotations.push({ dayIndex: dryRun.startPos, type: "rain-end", text: dryRunLabel(dryRun) });
    } else if (lastRainTiming?.rainy && lastRainTiming.shortWindow && lastRainTiming.endsMorning) {
      const noun = precipNounForDay(lastPos);
      annotations.push({ dayIndex: lastPos, type: noun === "눈" ? "snow" : "rain", text: singleDayWetHeadline(lastPos) });
    }
    return rangeRainLabel(firstPos, lastPos);
  })();

  // Add compact rain/snow annotations for later runs so future wet periods are visible too.
  for (const run of rainRuns.slice(1, 4)) {
    const { startPos, endPos } = run;
    const noun = (() => {
      let snowCount = 0;
      let rainCount = 0;
      for (let i = startPos; i <= endPos; i += 1) {
        if (isSnow(days[i].code)) snowCount += 1;
        else if (isRain(days[i].code) || days[i].rainProb >= 40) rainCount += 1;
      }
      return snowCount > rainCount ? "눈" : "비";
    })();
    const span = Math.max(1, days[endPos].dayOffset - days[startPos].dayOffset + 1);
    const text =
      span === 1 ? singleDayWetHeadline(startPos)
      : `${span}일 연속 ${noun}`;
    annotations.push({ dayIndex: startPos, type: noun === "눈" ? "snow" : "rain", text });
  }

  const warmingStart = days.findIndex((d, i) => i > todayIdx && d.dMean >= 3);
  const coolingStart = days.findIndex((d, i) => i > todayIdx && d.dMean <= -3);
  const lastFuturePos = [...days.keys()].reverse().find((i) => days[i].dayOffset >= 0) ?? (days.length - 1);
  const totalDelta = (todayIdx >= 0 && days[todayIdx] && days[lastFuturePos])
    ? Math.round(days[lastFuturePos].mean - days[todayIdx].mean)
    : 0;
  const tempPart = (() => {
    if (warmingStart > 0 && totalDelta >= 3) {
      annotations.push({ dayIndex: warmingStart, type: "warm", text: `${days[warmingStart].day}요일부터 기온 오름` });
      return `${weekdayStartPhrase(days[warmingStart].day)} 기온이 확 따뜻해져요.`;
    }
    if (coolingStart > 0 && totalDelta <= -3) {
      annotations.push({ dayIndex: coolingStart, type: "cool", text: `${days[coolingStart].day}요일부터 기온 내림` });
      return `${weekdayStartPhrase(days[coolingStart].day)} 기온이 뚜렷하게 내려가요.`;
    }
    if (totalDelta >= 3) return "주 후반으로 갈수록 따뜻해져요.";
    if (totalDelta <= -3) return "주 후반으로 갈수록 쌀쌀해져요.";
    return "이번 주 기온은 전반적으로 비슷해요.";
  })();

  // 한 날짜당 1개, 전체 최대 2개만 유지
  const filtered = [];
  const usedDay = new Set();
  const priority = { rain: 4, snow: 4, warm: 3, cool: 3, "rain-end": 2 };
  annotations
    .sort((a, b) => (priority[b.type] || 0) - (priority[a.type] || 0))
    .forEach((a) => {
      if (filtered.length >= 4) return;
      if (usedDay.has(a.dayIndex)) return;
      usedDay.add(a.dayIndex);
      filtered.push(a);
    });
  filtered.forEach((a) => {
    if (days[a.dayIndex]) days[a.dayIndex].annotation = { type: a.type, text: a.text };
  });

  return { days, todayIdx, summary: `${rainPart} ${tempPart}`, hasAnnotations: filtered.length > 0 };
}

async function fetchWeatherByCoords(place) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(place.lat));
  url.searchParams.set("longitude", String(place.lon));
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "14");
  url.searchParams.set("past_days", "6");
  url.searchParams.set("current", "temperature_2m");
  url.searchParams.set("hourly", "temperature_2m,weather_code,precipitation_probability");
  url.searchParams.set("daily", "weather_code,temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  const res = await fetch(url);
  if (!res.ok) throw new Error("날씨 정보를 불러오지 못했습니다.");
  return res.json();
}

function render(weather) {
  const nowFeature = buildNowFeature(weather);
  const time = buildTimeFeature(weather);
  const yesterdayDailyIdx = getDailyIndexByOffset(weather.daily.time, -1);
  const todayDailyIdx = getDailyIndexByOffset(weather.daily.time, 0);
  const tomorrowDailyIdx = getDailyIndexByOffset(weather.daily.time, 1);
  const todayBrief = (todayDailyIdx >= 0 && yesterdayDailyIdx >= 0)
    ? buildOutfitForDay(weather, todayDailyIdx, yesterdayDailyIdx, "어제보다")
    : null;
  const tomorrowBrief = (tomorrowDailyIdx >= 0 && todayDailyIdx >= 0)
    ? buildOutfitForDay(weather, tomorrowDailyIdx, todayDailyIdx, "오늘보다")
    : null;
  const weekly = buildWeekly(weather);

  el.nowIcon.innerHTML = weatherIconSvg(nowFeature.code, true);
  el.nowTemp.textContent = `${nowFeature.now}°`;
  el.nowState.innerHTML = `${nowFeature.state} · <span class="precip-inline">${dropIconSvg(nowFeature.rainProb)} ${nowFeature.rainProb}%</span>`;
  if (nowFeature.compareChip?.text) {
    el.nowCompareChip.hidden = false;
    el.nowCompareChip.textContent = nowFeature.compareChip.text;
    el.nowCompareChip.className = `now-compare-chip${nowFeature.compareChip.dir ? ` ${nowFeature.compareChip.dir}` : ""}`;
  } else {
    el.nowCompareChip.hidden = true;
    el.nowCompareChip.textContent = "";
    el.nowCompareChip.className = "now-compare-chip";
  }
  if (nowFeature.summary && nowFeature.summary.trim()) {
    el.nowSummary.hidden = false;
    el.nowSummary.innerHTML = withLineBreaks(nowFeature.summary);
  } else {
    el.nowSummary.hidden = true;
    el.nowSummary.innerHTML = "";
  }

  el.timeSummary.innerHTML = withLineBreaks(`${nowFeature.trendLead} ${time.summary}`.trim());
  if (el.timeStepToggle) {
    el.timeStepToggle.querySelectorAll(".time-step-btn").forEach((btn) => {
      const hours = Number(btn.dataset.hours || "1");
      const active = hours === selectedTimeStepHours;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }
  {
    const parts = [];
    time.slots.forEach((s, i) => {
      const marker = i === 0
        ? dayMarkerLabel(s.dayOffset)
        : (s.dayOffset !== time.slots[i - 1].dayOffset ? dayMarkerLabel(s.dayOffset) : "");
      parts.push(
        `<article class="hour-card ${s.isNearNow ? "near-now" : ""} ${marker ? "day-start" : ""}" style="transform: translateY(${s.offsetPx || 0}px);">` +
          `${marker ? `<span class="hour-day-badge">${marker}</span>` : ""}` +
          `${s.note ? `<span class="hour-note-badge ${s.noteType || ""}">${s.note}</span>` : ""}` +
          `<p class="hour-time ${hourPhaseClass(s.hourNum)}">${s.hour}</p><div class="hour-icon">${weatherIconSvg(s.code)}</div><p class="hour-temp">${s.temp}°</p><p class="hour-delta ${s.deltaDir}">${s.deltaDir === "up" ? `↑ ${s.delta}°` : s.deltaDir === "down" ? `↓ ${Math.abs(s.delta)}°` : "&nbsp;"}</p><p class="hour-rain">${dropIconSvg(s.rainProb)} ${s.rainProb}%</p></article>`,
      );
    });
    el.timeSlots.innerHTML = parts.join("");
  }
  requestAnimationFrame(updateHourlyGuideBand);
  requestAnimationFrame(() => scrollCardToSecondSlot(el.timeSlots, ".hour-card.near-now"));
  requestAnimationFrame(updateScrollEdgeOpacity);

  el.weekList.innerHTML = weekly.days
    .map(
      (w, i) => {
        const hiColor = w.maxClass === "rise" ? "#ffb84d" : w.maxClass === "fall" ? "#6db8ff" : "inherit";
        const loColor = w.minClass === "rise" ? "#ffb84d" : w.minClass === "fall" ? "#6db8ff" : "inherit";
        const isToday = w.dayOffset === 0;
        const isTomorrow = w.dayOffset === 1;
        const itemClass = `${isToday ? "week-today" : ""} ${isTomorrow ? "week-tomorrow" : ""} ${isToday || isTomorrow ? "week-focus" : ""}`.trim();
        const weekendClass = w.weekdayIndex === 0 ? "sun" : w.weekdayIndex === 6 ? "sat" : "";
        const outfitBrief = isToday ? todayBrief : isTomorrow ? tomorrowBrief : null;
        const isRelativeFocusLabel = w.dayOffset >= -1 && w.dayOffset <= 1;
        const primaryDayLabel = isRelativeFocusLabel ? w.relativeLabel : w.day;
        const secondaryMeta = isRelativeFocusLabel ? `${w.day} · ${w.dateLabel}` : `${w.relativeLabel} · ${w.dateLabel}`;
        const leftCore = `<div class="week-head-row"><span class="week-day ${weekendClass}">${primaryDayLabel}<br /><small>${secondaryMeta}</small></span><span class="week-icon-lg">${weatherIconSvg(w.code, true)}</span></div><span class="week-desc">${w.desc}<br /><small>${dropIconSvg(w.rainProb)} ${w.rainProb}%</small></span><span class="week-temp"><em class="hi ${w.maxClass}" style="color:${hiColor}">${w.maxClass === "rise" ? "↑ " : w.maxClass === "fall" ? "↓ " : ""}${w.max}°</em> / <em class="lo ${w.minClass}" style="color:${loColor}">${w.minClass === "rise" ? "↑ " : w.minClass === "fall" ? "↓ " : ""}${w.min}°</em></span>`;
        const weekAnno = w.annotation
          ? `<div class="week-event-bubble ${w.annotation.type}">${w.annotation.text}</div>`
          : "";
        if (outfitBrief) {
          const outfitBlock = `<div class="week-card-bubble"><span class="week-focus-outfit-head"><span class="week-focus-outfit-name">${outfitBrief.outfitName}</span></span><span class="week-focus-outfit-action">${compactOutfitActionText(outfitBrief.actionText)}</span></div>`;
          return `<li class="${itemClass}" style="transform: translateY(${w.offsetPx || 0}px);">${outfitBlock}${leftCore}${weekAnno}</li>`;
        }
        return `<li class="${itemClass}" style="transform: translateY(${w.offsetPx || 0}px);">${leftCore}${weekAnno}</li>`;
      },
    )
    .join("");
  el.weekSummary.hidden = !!weekly.hasAnnotations;
  el.weekSummary.innerHTML = weekly.hasAnnotations ? "" : withLineBreaks(weekly.summary);
  requestAnimationFrame(updateWeekOutfitBubbleCollisionLift);
  requestAnimationFrame(updateWeekListSafePadding);
  requestAnimationFrame(() => scrollCardToSecondSlot(el.weekList, "li.week-today"));
  requestAnimationFrame(updateWeeklyGuideLines);
  requestAnimationFrame(updateScrollEdgeOpacity);

  const isMobile = window.matchMedia("(max-width: 1020px)").matches;
  el.updatedAt.textContent = formatUpdatedAtLabel(new Date(), activeWeatherTimezone, { timeOnly: isMobile });
  el.locationLabel.textContent = formatLocationLabel(currentPlace, { compact: isMobile });
  requestAnimationFrame(updateAdaptiveUiScale);
}

async function loadWeather() {
  el.refresh.disabled = true;
  el.refresh.classList.add("is-loading");
  if (el.searchBtn) el.searchBtn.disabled = true;
  setWeatherLoadingSkeleton(true);
  try {
    const weather = await fetchWeatherByCoords(currentPlace);
    activeWeatherTimezone = weather.timezone || activeWeatherTimezone;
    lastWeatherData = weather;
    render(weather);
    el.searchStatus.textContent = "";
  } catch (err) {
    el.nowSummary.textContent = err.message || "오류가 발생했습니다.";
  } finally {
    setWeatherLoadingSkeleton(false);
    el.refresh.disabled = false;
    el.refresh.classList.remove("is-loading");
    if (el.searchBtn) el.searchBtn.disabled = false;
  }
}

function getCurrentPositionOnce(options = { enableHighAccuracy: false, timeout: 5000, maximumAge: 600000 }) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("이 브라우저에서는 위치 기능을 지원하지 않아요."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function initDefaultPlaceFromGeolocation() {
  try {
    setWeatherLoadingSkeleton(true);
    el.searchStatus.textContent = "현재 위치 확인 중...";
    const pos = await getCurrentPositionOnce();
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    currentPlace = { ...currentPlace, lat, lon, city: "현재 위치", country: "" };
    const reverse = await reverseGeocodeNominatim(lat, lon).catch(() => null);
    if (reverse) {
      currentPlace.city = reverse.city || currentPlace.city;
      currentPlace.country = reverse.country || currentPlace.country;
    }
    el.searchStatus.textContent = "";
  } catch (err) {
    currentPlace = { ...DEFAULT_PLACE };
    if (err && typeof err.code === "number") {
      if (err.code === 1) el.searchStatus.textContent = "위치 권한이 꺼져 있어 서울 날씨를 표시해요.";
      else el.searchStatus.textContent = "현재 위치를 확인하지 못해 서울 날씨를 표시해요.";
    } else {
      el.searchStatus.textContent = "현재 위치를 확인하지 못해 서울 날씨를 표시해요.";
    }
  } finally {
    // Keep skeleton visible through the subsequent weather fetch if still loading.
    // It will be hidden in loadWeather() finally.
  }
}

async function handleSearchSubmit(e) {
  e.preventDefault();
  closeSuggestions();
  const q = el.searchInput.value.trim();
  if (!q) return;
  closeSearchModal();
  setWeatherLoadingSkeleton(true);
  el.searchStatus.textContent = "검색 중...";
  el.searchBtn.disabled = true;
  try {
    const place = await resolvePlaceByKoreanQuery(q);
    if (!place) throw new Error("검색 결과가 없어요. 다른 이름으로 시도해보세요.");
    applySelectedPlace(place, q);
    saveRecentSearch(place);
    await loadWeather();
  } catch (err) {
    setWeatherLoadingSkeleton(false);
    el.searchStatus.textContent = err.message || "검색 중 오류가 발생했어요.";
    el.searchBtn.disabled = false;
  }
}

async function handleSearchInput() {
  const q = el.searchInput.value.trim();
  if (searchSuggestTimer) clearTimeout(searchSuggestTimer);
  // Autocomplete disabled: only show recent searches when input is empty.
  if (q.length < 1) showRecentSuggestions();
  else closeSuggestions();
}

function handleSuggestionClick(e) {
  const btn = e.target.closest(".suggest-item");
  if (!btn) return;
  const idx = Number(btn.dataset.index);
  const picked = searchSuggestions[idx];
  if (!picked) return;
  el.searchInput.value = picked.name || el.searchInput.value;
  closeSuggestions();
  applySelectedPlace(picked, el.searchInput.value);
  saveRecentSearch(picked);
  loadWeather().then(closeSearchModal);
}

function handleSearchFocus() {
  showRecentSuggestions();
}

function handleTimeStepToggleClick(e) {
  const btn = e.target.closest(".time-step-btn");
  if (!btn) return;
  const next = Math.max(1, Math.min(3, Number(btn.dataset.hours || "1")));
  if (next === selectedTimeStepHours) return;
  if (isMobileViewport()) mobileTimeStepUnlocked = true;
  selectedTimeStepHours = next;
  rerenderCachedWeatherIfReady();
}

function unlockMobileTimeStepOnScrollIntent() {
  if (!isMobileViewport()) return;
  if (!mobileTimeStepAutoLocked || mobileTimeStepUnlocked) return;
  mobileTimeStepUnlocked = true;
  if (selectedTimeStepHours !== 1) {
    selectedTimeStepHours = 1;
    rerenderCachedWeatherIfReady();
  }
}

function handleTimeSlotsTouchStart(e) {
  if (!isMobileViewport()) return;
  if (e.touches.length !== 1) {
    timeSlotsTapState = null;
    return;
  }
  const t = e.touches[0];
  timeSlotsTapState = {
    x: t.clientX,
    y: t.clientY,
    moved: false,
    ts: Date.now(),
  };
}

function handleTimeSlotsTouchMove(e) {
  if (!isMobileViewport()) return;
  if (!timeSlotsTapState || e.touches.length !== 1) return;
  const t = e.touches[0];
  if (Math.abs(t.clientX - timeSlotsTapState.x) > 10 || Math.abs(t.clientY - timeSlotsTapState.y) > 10) {
    timeSlotsTapState.moved = true;
    suppressTimeSlotsTapUntil = Date.now() + 320;
  }
}

function cycleTimeStepHours() {
  const nowTs = Date.now();
  if (nowTs - lastMobileTimeStepCycleAt < 260) return;
  lastMobileTimeStepCycleAt = nowTs;
  unlockMobileTimeStepOnScrollIntent();
  const next = selectedTimeStepHours === 1 ? 2 : selectedTimeStepHours === 2 ? 3 : 1;
  selectedTimeStepHours = next;
  mobileTimeStepUnlocked = true;
  rerenderCachedWeatherIfReady();
}

function handleTimeSlotsTouchEnd() {
  if (!isMobileViewport()) {
    timeSlotsTapState = null;
    return;
  }
  const state = timeSlotsTapState;
  timeSlotsTapState = null;
  if (!state) return;
  const dt = Date.now() - state.ts;
  if (Date.now() < suppressTimeSlotsTapUntil) return;
  if (!state.moved && dt < 300) {
    cycleTimeStepHours();
  }
}

function handleTimeSlotsClickCycle(e) {
  if (!isMobileViewport()) return;
  if (e.target.closest("button, a, input")) return;
  if (Date.now() < suppressTimeSlotsTapUntil) return;
  cycleTimeStepHours();
}

function handleTimeSlotsScrollAutoUnlock() {
  updateHourlyGuideBand();
  updateScrollEdgeOpacity();
  if (isMobileViewport()) suppressTimeSlotsTapUntil = Date.now() + 220;
  unlockMobileTimeStepOnScrollIntent();
}

el.refresh.addEventListener("click", loadWeather);
el.searchForm.addEventListener("submit", handleSearchSubmit);
el.searchInput.addEventListener("input", handleSearchInput);
el.searchInput.addEventListener("focus", handleSearchFocus);
el.timeStepToggle?.addEventListener("click", handleTimeStepToggleClick);
el.searchSuggest.addEventListener("click", handleSuggestionClick);
document.addEventListener("click", (e) => {
  if (e.target === el.searchInput) return;
  if (el.searchSuggest.contains(e.target)) return;
  if (el.searchForm.contains(e.target)) return;
  closeSuggestions();
});
el.openSearchBtn.addEventListener("click", openSearchModal);
el.closeSearchBtn.addEventListener("click", closeSearchModal);
el.searchBackdrop.addEventListener("click", closeSearchModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && el.searchModal && !el.searchModal.hidden) closeSearchModal();
});
el.timeSlots.addEventListener("scroll", handleTimeSlotsScrollAutoUnlock, { passive: true });
el.timeSlots.addEventListener("wheel", handleHorizontalWheelScroll, { passive: false });
el.timeSlots.addEventListener("touchstart", handleTimeSlotsTouchStart, { passive: true });
el.timeSlots.addEventListener("touchmove", handleTimeSlotsTouchMove, { passive: true });
el.timeSlots.addEventListener("touchend", handleTimeSlotsTouchEnd, { passive: true });
el.timeSlots.addEventListener("touchcancel", handleTimeSlotsTouchEnd, { passive: true });
el.timeSlots.addEventListener("click", handleTimeSlotsClickCycle);
el.weekList.addEventListener("scroll", updateWeeklyGuideLines, { passive: true });
el.weekList.addEventListener("scroll", updateScrollEdgeOpacity, { passive: true });
el.weekList.addEventListener("wheel", handleHorizontalWheelScroll, { passive: false });
installDragScroll(el.timeSlots);
installDragScroll(el.weekList);
window.addEventListener("wheel", handleDesktopNearbyHorizontalWheel, { passive: false });
window.addEventListener("resize", () => {
  updateAdaptiveUiScale();
  updateWeekOutfitBubbleCollisionLift();
  updateWeekListSafePadding();
  updateWeeklyGuideLines();
  updateHourlyGuideBand();
  updateScrollEdgeOpacity();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

(async function init() {
  if (isMobileViewport()) {
    mobileTimeStepAutoLocked = true;
    mobileTimeStepUnlocked = false;
    selectedTimeStepHours = 3;
  }
  await initDefaultPlaceFromGeolocation();
  await loadWeather();
})();
