const state = {
  token: localStorage.getItem("token") || "",
  user: JSON.parse(localStorage.getItem("user") || "null"),
  mapInstance: null,
  properties: [],
  selectedGroup: [],
  selectedPropertyId: null,
  panelCollapsed: false,
  /** моб.: последний translateY трека (может быть < 0 при длинной ленте); null — взять по умолч. */
  panelSheetT: null,
  panelSheetInitialized: false,
  panelCollapsedBeforeCabinet: null,
  panelSheetTBeforeCabinet: null,
  areaPolygonCoords: null,
  areaPolygonObject: null,
  areaDrawMode: false,
  areaDrawInProgress: false,
  areaDrawCoords: [],
  areaDrawHandlers: null,
  areaDrawCanvas: null,
  mapView: null,
  viewportUpdateTimer: null,
  /** Не пересобирать панель при boundschange, если список тот же — иначе рвётся жест шторки */
  mapViewportListSig: "",
  demoViewportListSig: "",
  mapAreaListSig: "",
  demoAreaListSig: "",
  /** Не перерисовывать лист по boundschange, пока открыт список группы метки (иначе DOM и transform сбрасываются). */
  mapLeftPanelMode: null,
  demoLeftPanelMode: null,
  filters: {
    minPrice: "",
    maxPrice: "",
    bedrooms: "",
    floorMin: "",
    floorMax: "",
    totalFloorsMin: "",
    totalFloorsMax: "",
    ceilingHeightMin: "",
    finishing: "",
    readiness: "",
    partnerCommissionMinPct: "",
    partnerCommissionMinRub: "",
    minArea: "",
    maxArea: "",
    housingStatus: "",
    publishedFrom: "",
    metroWalkMax: ""
  },
  /** Фиксированный набор демо-объектов на сессию (фильтры не меняют «источник») */
  demoAllProperties: null,
  /** увеличивать, чтобы сбросить кэш демо после смены логики точек/адресов */
  demoDataVersion: 0,
  /** При входе/регистрации с демо-карты или карточки демо — куда вернуться после закрытия оверлея */
  authOverlayReturnHash: null
};

function emptyFilters() {
  return {
    minPrice: "",
    maxPrice: "",
    bedrooms: "",
    floorMin: "",
    floorMax: "",
    totalFloorsMin: "",
    totalFloorsMax: "",
    ceilingHeightMin: "",
    finishing: "",
    readiness: "",
    partnerCommissionMinPct: "",
    partnerCommissionMinRub: "",
    minArea: "",
    maxArea: "",
    housingStatus: "",
    publishedFrom: "",
    metroWalkMax: ""
  };
}

const CURRENT_DEMO_DATA_VERSION = 7;

let didSyncUserFromServer = false;

const app = document.getElementById("app");

if (state.token) {
  fetch("/api/auth/refresh-cookie", {
    method: "POST",
    headers: { Authorization: `Bearer ${state.token}` },
    credentials: "include"
  }).catch(() => {});
}

function money(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function formatSpacedNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? new Intl.NumberFormat("ru-RU").format(Number(digits)) : "";
}

function toRawNumberString(value) {
  return String(value || "").replace(/\D/g, "");
}

function toDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizePhoneForTel(phone) {
  return String(phone || "").replace(/[^\d+]/g, "");
}

function normalizeDecimalInput(value) {
  const normalized = String(value || "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  const [integerPart, ...rest] = normalized.split(".");
  if (!rest.length) return integerPart;
  return `${integerPart}.${rest.join("")}`;
}

function normalizeRussianPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  return digits ? `+7${digits}` : "";
}

function normalizeTelegramNickname(value) {
  const trimmed = String(value || "").trim().replace(/\s+/g, "");
  if (!trimmed) return "";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function finishingLabel(value) {
  if (value === true) return "С отделкой";
  if (value === false) return "Бетон";
  const map = {
    finished: "С отделкой",
    whitebox: "Вайт бокс",
    concrete: "Бетон"
  };
  return map[value] || "-";
}

function readinessLabel(value) {
  const map = {
    resale: "Вторичка",
    assignment: "Переуступка"
  };
  return map[value] || "-";
}

function housingStatusLabel(value) {
  const map = { flat: "Квартира", apartments: "Апартаменты" };
  return map[value] || map.flat;
}

function formatPublishedDateRu(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function publishedAtTimeMs(item) {
  const s = item.publishedAt || item.createdAt;
  const t = Date.parse(String(s || ""));
  return Number.isNaN(t) ? 0 : t;
}

function propertyRoomsShortLabel(bedrooms) {
  const b = Number(bedrooms || 0);
  if (!b) return "Квартира";
  if (b >= 5) return "5+-комн. кв.";
  return `${b}-комн. кв.`;
}

function propertySpecSummaryLine(property) {
  const parts = [
    propertyRoomsShortLabel(property.bedrooms),
    property.area ? `${Number(property.area)} м²` : "",
    property.floor && property.totalFloors
      ? `${Number(property.floor)}/${Number(property.totalFloors)} этаж`
      : property.floor
        ? `${Number(property.floor)} этаж`
        : ""
  ].filter(Boolean);
  return parts.join(" · ");
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function getMoscowMetroStationList() {
  const g = typeof globalThis !== "undefined" ? globalThis : null;
  if (g && Array.isArray(g.MOSCOW_METRO_STATIONS) && g.MOSCOW_METRO_STATIONS.length) {
    return g.MOSCOW_METRO_STATIONS;
  }
  return [];
}

/** Ближайшая станция метро по координатам (данные OSM, см. moscowMetroStations.js). */
function nearestMoscowMetroName(lat, lon) {
  const stations = getMoscowMetroStationList();
  if (!stations.length || !Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  let best = null;
  let bestD = Infinity;
  for (const s of stations) {
    const d = haversineMeters(lat, lon, s.lat, s.lon);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best?.name ? String(best.name) : "";
}

function propertyMetroLabel(property) {
  const explicit = String(property?.metro || "").trim();
  if (explicit) return explicit;
  const lat = Number(property?.lat);
  const lon = Number(property?.lon);
  return nearestMoscowMetroName(lat, lon);
}

function propertyMetroHtml(property) {
  const metro = propertyMetroLabel(property).trim();
  const walk =
    property.metroWalkMinutes != null && Number.isFinite(Number(property.metroWalkMinutes))
      ? `${Number(property.metroWalkMinutes)} мин пешком`
      : "";
  if (!metro && !walk) return "";
  const line = [metro, walk].filter(Boolean).join(" · ");
  return `<div class="card-metro"><span class="card-metro__dot" aria-hidden="true"></span><span class="card-metro__name">${escapeHtml(
    line
  )}</span></div>`;
}

function propertyFeedPhotoDots(property) {
  const photos = Array.isArray(property.photos) ? property.photos : [];
  if (photos.length <= 1) return "";
  return `<div class="card-photo-dots" aria-hidden="true">${photos
    .map((_, i) => `<span class="card-photo-dot${i === 0 ? " card-photo-dot--active" : ""}"></span>`)
    .join("")}</div>`;
}

function downloadBlobAsFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "file.pdf";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function canOwnerRegeneratePropertyPdf(property) {
  return Boolean(state.user && property?.ownerId && property.ownerId === state.user.id);
}

async function fetchPropertyPresentationBlob(property, id) {
  let pdfUrl = property.pdfUrl;
  if (!pdfUrl) {
    if (!canOwnerRegeneratePropertyPdf(property)) {
      throw new Error("Презентация PDF ещё не сформирована. Попросите владельца объекта сгенерировать её в карточке.");
    }
    const data = await api(`/api/my/properties/${id}/generate-pdf`, { method: "POST" });
    pdfUrl = data.pdfUrl;
  }
  const absoluteUrl = new URL(pdfUrl, window.location.origin).toString();
  return fetchPdfBlobWithAuth(absoluteUrl);
}

function formatRussianPhoneMasked(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
  if (!digits) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  if (digits.length <= 8) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
}

const PLACEHOLDER_IMAGE_URL = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#eef2ff"/>
        <stop offset="100%" stop-color="#e2e8f0"/>
      </linearGradient>
    </defs>
    <rect width="900" height="600" fill="url(#g)"/>
    <g fill="#94a3b8">
      <rect x="240" y="170" width="420" height="260" rx="20" ry="20" fill="none" stroke="#94a3b8" stroke-width="16"/>
      <circle cx="350" cy="260" r="36"/>
      <path d="M280 390l95-95 70 70 55-55 120 120H280z"/>
    </g>
    <text x="450" y="490" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" fill="#64748b">Фото недоступно</text>
  </svg>`
)}`;

/** Сжатие превью для карточек (меньше трафика на мобильных). */
function optimizePhotoSrc(url, mode = "card") {
  const u = String(url || "").trim();
  if (!u || u.startsWith("data:") || u === PLACEHOLDER_IMAGE_URL) return u || PLACEHOLDER_IMAGE_URL;
  try {
    const parsed = new URL(u, typeof location !== "undefined" ? location.origin : undefined);
    if (/images\.unsplash\.com$/i.test(parsed.hostname)) {
      const w = mode === "gallery" ? "1200" : "720";
      parsed.search = "";
      parsed.searchParams.set("w", w);
      parsed.searchParams.set("q", "80");
      parsed.searchParams.set("auto", "format");
      parsed.searchParams.set("fit", "max");
      return parsed.toString();
    }
  } catch (_e) {
    /* ignore */
  }
  return u;
}

/** Абсолютный URL превью — на части клиентов относительный путь внутри ленты резолвился неверно. */
function absoluteMediaUrl(url) {
  const u = String(url || "").trim();
  if (!u || u.startsWith("data:")) return u;
  try {
    if (typeof location === "undefined") return u;
    return new URL(u, location.href).href;
  } catch {
    return u;
  }
}

function photoUrlWithFallback(url, opts = {}) {
  const mode = opts.gallery ? "gallery" : "card";
  const raw = url || PLACEHOLDER_IMAGE_URL;
  let src = optimizePhotoSrc(raw === PLACEHOLDER_IMAGE_URL ? raw : raw, mode);
  if (raw !== PLACEHOLDER_IMAGE_URL && !src.startsWith("data:")) {
    src = absoluteMediaUrl(src);
  }
  return escapeHtml(src);
}

function imgLazyAttrs(extra = {}) {
  const eager = extra.priority === "high" || extra.feedCard === true;
  const loading = eager ? 'loading="eager"' : 'loading="lazy"';
  const fetchPr = extra.priority === "high" ? ' fetchpriority="high"' : "";
  return `${loading} decoding="async"${fetchPr}`;
}

function photoOnErrorAttr() {
  return `this.onerror=null;this.src='${PLACEHOLDER_IMAGE_URL}';`;
}

function getPropertyPreviewPhoto(property) {
  if (!property || typeof property !== "object") return "";
  if (Array.isArray(property.photos) && property.photos[0]) return property.photos[0];
  if (typeof property.photo === "string" && property.photo) return property.photo;
  if (typeof property.photoUrl === "string" && property.photoUrl) return property.photoUrl;
  return "";
}

async function fetchPdfBlobWithAuth(url) {
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers
  });
  if (!res.ok) throw new Error("Не удалось загрузить PDF");
  return res.blob();
}

async function api(url, options = {}) {
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const response = await fetch(url, { ...options, headers, credentials: "include" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) {
      logout();
      state.authOverlayReturnHash = null;
      removeAuthDemoOverlay();
      location.hash = "#/auth";
    }
    if (response.status === 403) {
      throw new Error(data.message || "Нет доступа");
    }
    throw new Error(data.message || "Ошибка запроса");
  }
  return data;
}

const adminButtonHtml = () =>
  state.user?.isAdmin
    ? `<button type="button" class="top-action" id="adminBtn">Админка</button>`
    : "";

const agencyButtonHtml = () =>
  state.user?.isAgencyOwner
    ? `<button type="button" class="top-action" id="agencyBtn">Агентство</button>`
    : "";

const SUPPORT_EMAIL = "support@brokermap.ru";

function bindFiltersModalNumericFormatting() {
  const wireInt = (id) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.spacedBound === "1") return;
    el.dataset.spacedBound = "1";
    el.addEventListener("input", (e) => {
      const raw = toRawNumberString(e.target.value);
      e.target.value = formatSpacedNumber(raw);
    });
  };
  [
    "filterFloorMin",
    "filterFloorMax",
    "filterTotalFloorsMin",
    "filterTotalFloorsMax",
    "filterPartnerRub",
    "filterMetroWalkMax"
  ].forEach(wireInt);
  const pct = document.getElementById("filterPartnerPct");
  if (pct && pct.dataset.decBound !== "1") {
    pct.dataset.decBound = "1";
    pct.addEventListener("input", (e) => {
      e.target.value = normalizeDecimalInput(e.target.value);
    });
  }
  const ceil = document.getElementById("filterCeilingMin");
  if (ceil && ceil.dataset.ceilBound !== "1") {
    ceil.dataset.ceilBound = "1";
    ceil.addEventListener("input", (e) => {
      const cleaned = String(e.target.value || "")
        .replace(",", ".")
        .replace(/[^\d.]/g, "");
      const [integerPart, ...rest] = cleaned.split(".");
      const decimalPart = rest.join("").slice(0, 2);
      const formattedInteger = formatSpacedNumber(integerPart);
      e.target.value = decimalPart ? `${formattedInteger},${decimalPart}` : formattedInteger;
    });
  }
  const bindAreaFilterInput = (id) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.areaFilterBound === "1") return;
    el.dataset.areaFilterBound = "1";
    el.addEventListener("input", (e) => {
      const cleaned = String(e.target.value || "")
        .replace(",", ".")
        .replace(/[^\d.]/g, "");
      const [integerPart, ...rest] = cleaned.split(".");
      const decimalPart = rest.join("").slice(0, 2);
      const formattedInteger = formatSpacedNumber(integerPart);
      e.target.value = decimalPart ? `${formattedInteger},${decimalPart}` : formattedInteger;
    });
  };
  bindAreaFilterInput("filterAreaMin");
  bindAreaFilterInput("filterAreaMax");
}

function moreFiltersModalHtml() {
  return `
    <div class="modal" id="filtersModal">
      <div class="modal-card filters-modal-card">
        <div class="panel-head">
          <h3>Дополнительные фильтры</h3>
          <button class="close-panel-action" id="closeFiltersXBtn" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="form-grid">
          <div class="field-block">
            <label class="field-label" for="modalMinPrice">Цена от</label>
            <input id="modalMinPrice" type="text" inputmode="numeric" value="${formatSpacedNumber(state.filters.minPrice)}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="modalMaxPrice">Цена до</label>
            <input id="modalMaxPrice" type="text" inputmode="numeric" value="${formatSpacedNumber(state.filters.maxPrice)}" />
          </div>
          <div class="field-block field-span-2">
            <label class="field-label" for="modalBedrooms">Спален</label>
            <select id="modalBedrooms">
              <option value="">Любое</option>
              <option value="1" ${state.filters.bedrooms === "1" ? "selected" : ""}>1</option>
              <option value="2" ${state.filters.bedrooms === "2" ? "selected" : ""}>2</option>
              <option value="3" ${state.filters.bedrooms === "3" ? "selected" : ""}>3</option>
              <option value="4" ${state.filters.bedrooms === "4" ? "selected" : ""}>4+</option>
            </select>
          </div>
          <div class="field-block">
            <label class="field-label" for="filterFloorMin">Этаж от</label>
            <input id="filterFloorMin" type="text" inputmode="numeric" value="${formatSpacedNumber(state.filters.floorMin)}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="filterFloorMax">Этаж до</label>
            <input id="filterFloorMax" type="text" inputmode="numeric" value="${formatSpacedNumber(state.filters.floorMax)}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="filterTotalFloorsMin">Этажей в доме от</label>
            <input id="filterTotalFloorsMin" type="text" inputmode="numeric" value="${formatSpacedNumber(state.filters.totalFloorsMin)}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="filterTotalFloorsMax">Этажей в доме до</label>
            <input id="filterTotalFloorsMax" type="text" inputmode="numeric" value="${formatSpacedNumber(state.filters.totalFloorsMax)}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="filterCeilingMin">Потолки от (м)</label>
            <input id="filterCeilingMin" type="text" inputmode="decimal" value="${escapeHtml(
              String(state.filters.ceilingHeightMin || "").replace(".", ",")
            )}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="filterPartnerPct">Комиссия партнёру от (%)</label>
            <input id="filterPartnerPct" type="text" inputmode="decimal" value="${escapeHtml(state.filters.partnerCommissionMinPct)}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="filterPartnerRub">Комиссия партнёру от (₽)</label>
            <input id="filterPartnerRub" type="text" inputmode="numeric" value="${formatSpacedNumber(
              state.filters.partnerCommissionMinRub
            )}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="filterFinishing">Отделка</label>
            <select id="filterFinishing">
              <option value="">Любая</option>
              <option value="finished" ${state.filters.finishing === "finished" ? "selected" : ""}>С отделкой</option>
              <option value="whitebox" ${state.filters.finishing === "whitebox" ? "selected" : ""}>Вайт бокс</option>
              <option value="concrete" ${state.filters.finishing === "concrete" ? "selected" : ""}>Бетон</option>
            </select>
          </div>
          <div class="field-block">
            <label class="field-label" for="filterReadiness">Готовность дома</label>
            <select id="filterReadiness">
              <option value="">Любая</option>
              <option value="resale" ${state.filters.readiness === "resale" ? "selected" : ""}>Вторичка</option>
              <option value="assignment" ${state.filters.readiness === "assignment" ? "selected" : ""}>Переуступка</option>
            </select>
          </div>
          <div class="field-block">
            <label class="field-label" for="filterAreaMin">Площадь от (м²)</label>
            <input id="filterAreaMin" type="text" inputmode="decimal" value="${escapeHtml(
              String(state.filters.minArea || "").replace(".", ",")
            )}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="filterAreaMax">Площадь до (м²)</label>
            <input id="filterAreaMax" type="text" inputmode="decimal" value="${escapeHtml(
              String(state.filters.maxArea || "").replace(".", ",")
            )}" />
          </div>
          <div class="field-block field-span-2">
            <label class="field-label" for="filterHousingStatus">Статус жилья</label>
            <select id="filterHousingStatus">
              <option value="">Любой</option>
              <option value="flat" ${state.filters.housingStatus === "flat" ? "selected" : ""}>Квартира</option>
              <option value="apartments" ${state.filters.housingStatus === "apartments" ? "selected" : ""}>Апартаменты</option>
            </select>
          </div>
          <div class="field-block field-span-2">
            <label class="field-label" for="filterPublishedFrom">Дата публикации от</label>
            <input id="filterPublishedFrom" type="date" value="${escapeHtml(state.filters.publishedFrom || "")}" />
          </div>
          <div class="field-block field-span-2">
            <label class="field-label" for="filterMetroWalkMax">До метро пешком, не более (мин)</label>
            <input id="filterMetroWalkMax" type="text" inputmode="numeric" value="${formatSpacedNumber(
              state.filters.metroWalkMax
            )}" />
          </div>
        </div>
        <p>
          <button class="btn primary" id="applyMoreFilters" type="button">Применить</button>
          <button class="btn" id="resetMoreFilters" type="button">Сбросить доп. фильтры</button>
        </p>
      </div>
    </div>
  `;
}

function demoPublicTopbar() {
  return `
    <header class="topbar topbar-demo">
      <button type="button" class="brand brand-home-btn" id="brandHomeBtn">BrokerMap</button>
      <div class="filters">
        <input
          id="minPrice"
          class="price-input"
          type="text"
          inputmode="numeric"
          placeholder="Цена от"
          value="${formatSpacedNumber(state.filters.minPrice)}"
        />
        <input
          id="maxPrice"
          class="price-input"
          type="text"
          inputmode="numeric"
          placeholder="Цена до"
          value="${formatSpacedNumber(state.filters.maxPrice)}"
        />
        <select id="bedroomsFilter" class="bedrooms-select">
          <option value="">Спален</option>
          <option value="1" ${state.filters.bedrooms === "1" ? "selected" : ""}>1</option>
          <option value="2" ${state.filters.bedrooms === "2" ? "selected" : ""}>2</option>
          <option value="3" ${state.filters.bedrooms === "3" ? "selected" : ""}>3</option>
          <option value="4" ${state.filters.bedrooms === "4" ? "selected" : ""}>4+</option>
        </select>
        <button type="button" id="moreFilters">Ещё фильтры</button>
        <button type="button" id="resetFilters">Сброс</button>
      </div>
      <div class="auth">
        <button type="button" class="top-action primary" id="demoAuthLogin">Войти</button>
        <button type="button" class="top-action primary" id="demoAuthRegister">Регистрация</button>
      </div>
    </header>
  `;
}

function topbar(options = {}) {
  if (options.slim) {
    return `
    <header class="topbar topbar-slim">
      <button type="button" class="brand brand-home-btn" id="brandHomeBtn">BrokerMap</button>
      <div class="auth">
        ${adminButtonHtml()}
        ${agencyButtonHtml()}
        <button type="button" class="top-action" id="toMapBtn">На карту</button>
        <button type="button" class="top-action" id="cabinetBtn">
          <span class="cabinet-btn-long">Личный кабинет</span>
          <span class="cabinet-btn-short">Кабинет</span>
        </button>
      </div>
    </header>`;
  }
  const hideFilters = Boolean(options.hideFilters);
  return `
    <header class="topbar ${hideFilters ? "topbar--no-filters" : ""}">
      <button type="button" class="brand brand-home-btn" id="brandHomeBtn">BrokerMap</button>
      <div class="filters">
        <input
          id="minPrice"
          class="price-input"
          type="text"
          inputmode="numeric"
          placeholder="Цена от"
          value="${formatSpacedNumber(state.filters.minPrice)}"
        />
        <input
          id="maxPrice"
          class="price-input"
          type="text"
          inputmode="numeric"
          placeholder="Цена до"
          value="${formatSpacedNumber(state.filters.maxPrice)}"
        />
        <select id="bedroomsFilter" class="bedrooms-select">
          <option value="">Спален</option>
          <option value="1" ${state.filters.bedrooms === "1" ? "selected" : ""}>1</option>
          <option value="2" ${state.filters.bedrooms === "2" ? "selected" : ""}>2</option>
          <option value="3" ${state.filters.bedrooms === "3" ? "selected" : ""}>3</option>
          <option value="4" ${state.filters.bedrooms === "4" ? "selected" : ""}>4+</option>
        </select>
        <button id="moreFilters">Еще фильтры</button>
        <button id="resetFilters">Сброс</button>
      </div>
      <div class="auth">
        ${adminButtonHtml()}
        ${agencyButtonHtml()}
        <button id="cabinetBtn" class="top-action" type="button">
          <span class="cabinet-btn-long">Личный кабинет</span>
          <span class="cabinet-btn-short">Кабинет</span>
        </button>
      </div>
    </header>
  `;
}

function mobileMapChromeHtml(isDemo) {
  return `
    <div class="mobile-map-top">
      <button type="button" class="btn" id="${isDemo ? "demoMobileFiltersBtn" : "mapMobileFiltersBtn"}">Фильтры</button>
    </div>
    ${isDemo ? `<div class="mobile-map-title">Демо</div>` : ""}
    ${mobileBottomNavHtml("search")}
  `;
}

function mobileBottomNavHtml(activeTab = "search") {
  return `
    <nav class="mobile-map-bottom-nav" aria-label="Навигация">
      <button type="button" class="mobile-map-bottom-nav__btn ${activeTab === "search" ? "active" : ""}" id="mobileNavSearchBtn">Поиск</button>
      <button type="button" class="mobile-map-bottom-nav__btn ${activeTab === "cabinet" ? "active" : ""}" id="mobileNavCabinetBtn">Личный кабинет</button>
    </nav>
  `;
}

function getActiveMobileNavTab() {
  const hash = location.hash || "#/";
  if (
    hash.startsWith("#/cabinet") ||
    (hash.startsWith("#/auth") && !hash.startsWith("#/auth-agency-invite")) ||
    hash.startsWith("#/admin") ||
    hash.startsWith("#/agency")
  ) {
    return "cabinet";
  }
  return "search";
}

function mapDrawToolsHtml() {
  return `<div class="map-draw-tools">
    <button class="map-draw-btn" type="button" id="mapDrawAreaBtn" title="Выделить область на карте" aria-label="Выделить область на карте"><span class="map-draw-btn__icon" aria-hidden="true">✍</span></button>
    <div class="map-draw-hint" id="mapDrawHint">
      <button type="button" class="map-draw-hint__close" id="mapDrawHintCloseBtn" aria-label="Скрыть подсказку">×</button>
      Выделите кистью район на карте, чтобы показать объекты только в этой зоне.
    </div>
  </div>`;
}

function updateMobileNavMetrics() {
  if (!window.matchMedia("(max-width: 900px)").matches) return;
  const nav = document.querySelector(".mobile-map-bottom-nav");
  if (nav) {
    document.documentElement.style.setProperty("--mobile-bottom-nav-height", `${Math.round(nav.offsetHeight)}px`);
  }
  refreshMobileSheetLayoutVars(null);
}

function bindBrandHomeButton() {
  document.getElementById("brandHomeBtn")?.addEventListener("click", () => {
    location.hash = "#/";
  });
}

function ensureMapDrawControls() {
  const mapWrap = document.querySelector(".map-wrap");
  if (!mapWrap) return;
  const toolsParent = mapWrap.querySelector(".map-stage") || mapWrap;
  let tools = mapWrap.querySelector(".map-draw-tools");
  if (!tools) {
    tools = document.createElement("div");
    tools.className = "map-draw-tools";
    toolsParent.appendChild(tools);
  }
  let drawBtn = document.getElementById("mapDrawAreaBtn");
  if (!drawBtn) {
    drawBtn = document.createElement("button");
    drawBtn.id = "mapDrawAreaBtn";
    drawBtn.className = "map-draw-btn";
    drawBtn.title = "Рисовать область";
    drawBtn.innerHTML = `<span class="map-draw-btn__icon" aria-hidden="true">✍</span>`;
    tools.appendChild(drawBtn);
    drawBtn.addEventListener("click", startAreaDrawing);
  }
  let hint = tools.querySelector(".map-draw-hint");
  if (!hint) {
    hint = document.createElement("div");
    hint.className = "map-draw-hint";
    hint.id = "mapDrawHint";
    hint.innerHTML = `
      <button type="button" class="map-draw-hint__close" id="mapDrawHintCloseBtn" aria-label="Скрыть подсказку">×</button>
      Выделите кистью район на карте, чтобы показать объекты только в этой зоне.
    `;
    tools.appendChild(hint);
  }
  tools.style.display = "flex";
  drawBtn.style.display = "inline-flex";
  bindMapDrawHint();
  syncDrawButtons();
}

function bindMapDrawHint() {
  const hint = document.getElementById("mapDrawHint");
  const closeBtn = document.getElementById("mapDrawHintCloseBtn");
  if (!hint || !closeBtn) return;
  const hidden = localStorage.getItem("mapDrawHintDismissed") === "1";
  hint.classList.toggle("hidden", hidden);
  closeBtn.onclick = () => {
    hint.classList.add("hidden");
    localStorage.setItem("mapDrawHintDismissed", "1");
  };
}

function cardMarkup(property) {
  const pct = Number(property.commissionPartner || 0);
  const commissionRub = (Number(property.price || 0) * pct) / 100;
  const premium = property.commissionPartner >= 4;
  return `
    <article class="card card--feed ${premium ? "premium" : ""}">
      <div class="card-media">
        <img class="card-media__img" ${imgLazyAttrs({ feedCard: true })} src="${photoUrlWithFallback(property.photos?.[0])}" onerror="${photoOnErrorAttr()}" alt="" />
        ${propertyFeedPhotoDots(property)}
      </div>
      <div class="card-badges">
        <span class="card-badge card-badge--partner">Партнёру ${escapeHtml(String(pct))}%</span>
        <span class="card-badge card-badge--amount">${money(commissionRub)} ₽ партнёру</span>
      </div>
      <div class="card-body">
        <div class="card-price">${money(property.price)} ₽</div>
        <div class="card-spec">${escapeHtml(propertySpecSummaryLine(property))}</div>
        <div class="card-address muted">${escapeHtml(property.address || "")}</div>
        ${propertyMetroHtml(property)}
        <p class="card-actions"><button class="btn primary full open-object" type="button" data-id="${escapeHtml(
          property.id
        )}">Подробнее</button></p>
      </div>
    </article>
  `;
}

function setMapBodyClass(isMap) {
  document.body.classList.toggle("view-map", Boolean(isMap));
}

/** Стартовый вид карты: центр Москвы, заметно ближе, чем зум 5–9 (вся область). */
const MOSCOW_DEFAULT_CENTER = [55.751244, 37.618423];
const MOSCOW_DEFAULT_ZOOM = 11;

const FALLBACK_MOSCOW_DEMO = [
  { lat: 55.7527, lon: 37.6154, address: "Москва, улица Варварка, 4" },
  { lat: 55.7895, lon: 37.5556, address: "Москва, Ленинградский проспект, 80" },
  { lat: 55.6785, lon: 37.7125, address: "Москва, Нагатинская набережная, 10" }
];

function shuffleArrayInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getMoscowRealDemoPicks() {
  const g = typeof globalThis !== "undefined" ? globalThis : null;
  if (g && Array.isArray(g.MOSCOW_REAL_DEMO_PICKS) && g.MOSCOW_REAL_DEMO_PICKS.length) {
    return g.MOSCOW_REAL_DEMO_PICKS;
  }
  return FALLBACK_MOSCOW_DEMO;
}

/**
 * 100 (или count) демо-объектов: адрес = координаты из списка; порядок случайный;
 * если точек < count — добираем дубликатами (2–3 объекта в одной точке).
 */
function buildShuffledMoscowDemoSlots(count) {
  const source = getMoscowRealDemoPicks().map((p) => ({ address: p.address, lat: p.lat, lon: p.lon }));
  if (!source.length) return [];
  const shuffled = shuffleArrayInPlace(source.slice());
  const out = shuffled.slice(0, Math.min(count, shuffled.length));
  while (out.length < count) {
    const pick = shuffled[Math.floor(Math.random() * shuffled.length)];
    out.push({ address: pick.address, lat: pick.lat, lon: pick.lon });
  }
  shuffleArrayInPlace(out);
  return out.slice(0, count);
}

function priceRoundedThousands(value) {
  return Math.round(Number(value) / 1000) * 1000;
}

function createDemoProperties(count = 100) {
  const residentialPhotos = [
    "https://images.unsplash.com/photo-1494526585095-c41746248156?w=1600",
    "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1600",
    "https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1600",
    "https://images.unsplash.com/photo-1460317442991-0ec209397118?w=1600",
    "https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=1600",
    "https://images.unsplash.com/photo-1600607686527-6fb886090705?w=1600"
  ];
  const planPhotos = [
    "https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=1600",
    "https://images.unsplash.com/photo-1600607687644-c7171b42498f?w=1600",
    "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1600",
    "https://images.unsplash.com/photo-1600585152220-90363fe7e115?w=1600"
  ];
  const finishingOptions = ["finished", "whitebox", "concrete"];
  const readinessOptions = ["resale", "assignment"];
  const slots = buildShuffledMoscowDemoSlots(count);
  const demo = [];
  for (let i = 0; i < count; i++) {
    const { lat, lon, address } = slots[i] || slots[0];
    const priceBase = priceRoundedThousands(12_000_000 + (i * 601_001) % 59_000_000);
    const partnerPct = Number((1 + (i % 8) * 0.5).toFixed(1));
    const daysAgo = 1 + (i % 120);
    const pub = new Date();
    pub.setDate(pub.getDate() - daysAgo);
    demo.push({
      id: `demo-${i + 1}`,
      title: `Квартира в Москве #${i + 1}`,
      address,
      lat,
      lon,
      metro: nearestMoscowMetroName(lat, lon),
      price: priceBase,
      area: 28 + (i % 9) * 6,
      bedrooms: (i % 4) + 1,
      floor: 1 + (i % 20),
      totalFloors: 9 + (i % 20),
      ceilingHeight: Math.round((2.6 + (i % 5) * 0.1) * 10) / 10,
      finishing: finishingOptions[i % finishingOptions.length],
      readiness: readinessOptions[i % readinessOptions.length],
      housingStatus: i % 4 === 0 ? "apartments" : "flat",
      publishedAt: pub.toISOString(),
      metroWalkMinutes: 3 + (i % 22),
      commissionTotal: 3,
      commissionPartner: partnerPct,
      contacts: {
        phone: "+7 (9••) •••-••-••",
        telegram: "@••••••••"
      },
      description:
        "Современный жилой комплекс в Москве. Панорамные окна, продуманная планировка, закрытый двор и развитая инфраструктура.",
      photos: [residentialPhotos[i % residentialPhotos.length], planPhotos[i % planPhotos.length]]
    });
  }
  return demo;
}

function demoCardMarkup(item) {
  const pct = Number(item.commissionPartner || 0);
  const commissionRub = (Number(item.price || 0) * pct) / 100;
  const premium = item.commissionPartner >= 4;
  return `
    <article class="card card--feed ${premium ? "premium" : ""}">
      <div class="card-media">
        <img class="card-media__img" ${imgLazyAttrs({ feedCard: true })} src="${photoUrlWithFallback(item.photos?.[0])}" onerror="${photoOnErrorAttr()}" alt="" />
        ${propertyFeedPhotoDots(item)}
      </div>
      <div class="card-badges">
        <span class="card-badge card-badge--partner">Партнёру ${escapeHtml(String(pct))}%</span>
        <span class="card-badge card-badge--amount">${money(commissionRub)} ₽ партнёру</span>
      </div>
      <div class="card-body">
        <div class="card-price">${money(item.price)} ₽</div>
        <div class="card-spec">${escapeHtml(propertySpecSummaryLine(item))}</div>
        <div class="card-address muted">${escapeHtml(item.address || "")}</div>
        ${propertyMetroHtml(item)}
        <p class="card-actions card-actions--split">
          <button class="btn full open-demo-contacts" type="button">Открыть контакты</button>
          <button class="btn primary full open-demo-object" type="button" data-id="${escapeHtml(item.id)}">Подробнее</button>
        </p>
      </div>
    </article>
  `;
}

function bindDemoCardButtons(root = document) {
  root.querySelectorAll(".open-demo-object").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#/demo/property/${encodeURIComponent(btn.dataset.id)}`;
    });
  });
  root.querySelectorAll(".open-demo-contacts").forEach((btn) => {
    btn.addEventListener("click", () => {
      goToAuthFromGuestDemo("#/auth-register");
    });
  });
}

function leftPanelHandleHtml(handleAreaId) {
  return `<div class="left-panel-handle-wrap" id="${handleAreaId}" role="presentation">
    <div class="left-panel-handle" aria-hidden="true"></div>
  </div>`;
}

/** Один трек без внутр. scroll — положение ленты задаётся transform на всём блоке, палец 1:1 */
function leftPanelTrackWrap(innerHtml) {
  return `<div class="left-panel__track" data-sheet-track>${innerHtml}</div>`;
}

function leftPanelMobileBlock(handleAreaId, headHtml, bodyHtml) {
  const body = bodyHtml ? `<div class="left-panel-scroll" data-sheet-scroll>${bodyHtml}</div>` : "";
  return leftPanelTrackWrap(leftPanelHandleHtml(handleAreaId) + headHtml + body);
}

function sheetObjectsListFooterHtml() {
  return `<div class="left-panel-list-footer"><p class="muted">${escapeHtml("Сейчас это все объекты по вашему поиску")}</p></div>`;
}

/** Узел с transform: внутр. трек (контент), не внешний clip — тогда «окно» стоит, едет лента */
function getSheetNode(panel) {
  if (!panel) return null;
  return panel.querySelector("[data-sheet-track]") || panel;
}

function getPanelTranslateY(el) {
  if (!el) return 0;
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  if (t.startsWith("matrix3d(")) {
    const v = t
      .slice(9, -1)
      .split(/\s*,\s*/)
      .map(Number);
    return v[13] || 0;
  }
  if (t.startsWith("matrix(")) {
    const v = t
      .slice(7, -1)
      .split(/\s*,\s*/)
      .map(Number);
    return v[5] || 0;
  }
  return 0;
}

function setPanelTranslateY(el, y, withTransition, durationMs) {
  if (!el) return;
  if (withTransition) {
    el.classList.add("left-panel--sheet-anim");
    if (durationMs != null) {
      const ms = Math.max(120, Math.round(durationMs));
      el.style.transition = `transform ${ms}ms cubic-bezier(0.32, 0.72, 0, 1)`;
    } else {
      el.style.removeProperty("transition");
    }
  } else {
    el.classList.remove("left-panel--sheet-anim");
    el.style.removeProperty("transition");
  }
  el.style.transform = `translate3d(0, ${y}px, 0)`;
}

/** Видимая высота (iOS Safari URL bar / клавиатура) — стабильнее, чем innerHeight. */
function mobileViewportInnerHeight() {
  const vv = window.visualViewport;
  if (vv && vv.height > 32) return Math.round(vv.height);
  return Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
}

function ensureMobileSheetVisualViewportReflow() {
  if (typeof window === "undefined" || window.__bmVVSheetBound === "1") return;
  const vv = window.visualViewport;
  if (!vv) return;
  window.__bmVVSheetBound = "1";
  let resizeTimer = null;
  vv.addEventListener(
    "resize",
    () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (!window.matchMedia("(max-width: 900px)").matches) return;
        const settle = (panel, layout) => {
          if (!panel || !layout || !layout.classList.contains("map-layout--app-sheet")) return;
          const node = getSheetNode(panel);
          if (!node?.querySelector(".left-panel-head") || node.classList.contains("left-panel--sheet-live")) return;
          mobileSheetSettleAfterRender(panel, layout);
        };
        settle(document.getElementById("leftPanel"), document.getElementById("mapLayout"));
        settle(document.getElementById("demoLeftPanel"), document.getElementById("demoMapLayout"));
      }, 100);
    },
    { passive: true }
  );
}

function refreshMobileSheetLayoutVars(panel) {
  if (!window.matchMedia("(max-width: 900px)").matches) return;
  const root = document.documentElement;
  const navEl = document.querySelector(".mobile-map-bottom-nav");
  const navH = navEl
    ? Math.max(48, Math.round(navEl.getBoundingClientRect().height || navEl.offsetHeight || 56))
    : 56;
  root.style.setProperty("--mobile-bottom-nav-height", `${navH}px`);

  let topGap = 104;
  if ((panel && panel.closest(".demo-page")) || document.querySelector("#demoLeftPanel")) {
    const strip = document.getElementById("demoTopStrip");
    const mobTop = document.querySelector(".demo-page .mobile-map-top");
    const topbarDemo = document.querySelector(".demo-page .topbar");
    const stripH = strip ? strip.getBoundingClientRect().height : 0;
    const mobH = mobTop ? mobTop.getBoundingClientRect().height : 0;
    const tbH = topbarDemo ? topbarDemo.getBoundingClientRect().height : 0;
    topGap = Math.ceil(stripH + mobH + tbH + 14);
    if (topGap < 108) topGap = 120;
    if (topGap > 220) topGap = 220;
  } else if (document.querySelector(".map-page")) {
    const tb = document.querySelector(".map-page .topbar");
    const mobTop = document.querySelector(".map-page .mobile-map-top");
    topGap = Math.ceil((tb?.getBoundingClientRect().height || 76) + (mobTop?.getBoundingClientRect().height || 44) + 12);
    if (topGap < 92) topGap = 100;
    if (topGap > 200) topGap = 200;
  }
  root.style.setProperty("--mobile-sheet-top-gap", `${topGap}px`);
}

/**
 * Рулон снизу. Трек прижат к низу .left-panel; translateY вниз прячет контент.
 * Видимая высота белого блока ≈ min(W, max(0, H − t)) при t ≥ 0 (H — scrollHeight трека, W — высота .map-wrap).
 * Свёртка «полоска»: t = H − peekVisible. Нельзя брать yPeek = usable − peekVisible — при длинном списке
 * шторка как будто «не сворачивалась». Старт «~полэкрана»: t = H − targetVis по viewport/wrap, не процент от (yMax−yMin).
 */
function getSheetGeometry(panel) {
  if (!window.matchMedia("(max-width: 900px)").matches) return null;
  refreshMobileSheetLayoutVars(panel);
  const vh = mobileViewportInnerHeight();
  const track = panel.querySelector("[data-sheet-track]");
  const wrap = panel.closest(".map-wrap");
  const bottomNav = document.querySelector(".mobile-map-bottom-nav");
  const navH = bottomNav
    ? Math.max(56, Math.round(bottomNav.getBoundingClientRect().height || bottomNav.offsetHeight || 56))
    : 56;
  const baseUsable = Math.max(120, vh - navH);
  let W = baseUsable;
  if (wrap) {
    const rh = Math.round(wrap.getBoundingClientRect().height);
    if (rh > 80 && rh >= baseUsable * 0.3) {
      W = Math.min(baseUsable, rh);
    }
  }
  let H =
    track && Math.max(track.scrollHeight, track.offsetHeight, track.getBoundingClientRect().height)
      ? Math.round(Math.max(track.scrollHeight, track.offsetHeight, track.getBoundingClientRect().height))
      : 0;
  if (!Number.isFinite(H) || H < 88) {
    H = Math.round(Math.min(vh, W) * 0.52);
  }
  H = Math.max(92, H);
  const handleWrap = track?.querySelector(".left-panel-handle-wrap");
  const head = track?.querySelector(".left-panel-head");
  const scrollEl = track?.querySelector("[data-sheet-scroll]");
  const handleH = handleWrap ? Math.round(handleWrap.offsetHeight) : 24;
  const headH = head ? Math.round(head.offsetHeight) : 52;
  const scrollPad = scrollEl ? Math.ceil(parseFloat(getComputedStyle(scrollEl).paddingTop) || 0) : 0;
  const firstCard =
    scrollEl?.querySelector("article.card, .card") || scrollEl?.querySelector(".card");

  /** Только ручка + заголовок (верх списка карточек не входит). */
  let chromeOnlyH = handleH + headH + 12;
  if (scrollEl) {
    chromeOnlyH = Math.max(chromeOnlyH, Math.round(scrollEl.offsetTop + scrollPad));
  }
  /**
   * Свёрнуто: только ручка + заголовок. Ни одного пикселя медиа между шапкой и fixed-навбаром.
   * Видимая полоска ≈ peekCollapsedPx; верх обрезается выше .card-media (не только article.card).
   */
  let peekCollapsedPx = Math.round(chromeOnlyH + 2);
  if (scrollEl && firstCard) {
    const media = firstCard.querySelector(".card-media");
    const innerTop = media ? media.offsetTop || 0 : 0;
    const pixelsToMediaTop = firstCard.offsetTop + innerTop + scrollEl.offsetTop + scrollPad;
    peekCollapsedPx = Math.min(Math.round(chromeOnlyH + 2), Math.round(pixelsToMediaTop - 42));
  }
  peekCollapsedPx = Math.max(56, Math.min(118, peekCollapsedPx));

  const peekT = Math.max(0, Math.round(H - peekCollapsedPx));

  let cardH = 0;
  if (firstCard) {
    const cs = getComputedStyle(firstCard);
    const mb = Math.ceil(parseFloat(cs.marginBottom) || 0);
    cardH = Math.round(
      Math.max(firstCard.offsetHeight || 0, firstCard.getBoundingClientRect().height || 0) + mb
    );
  }
  if (!cardH) {
    cardH = Math.round(Math.min(W * 0.44, baseUsable * 0.46));
  }
  let targetOpenVis;
  if (firstCard && scrollEl) {
    const cs = getComputedStyle(firstCard);
    const mb = Math.ceil(parseFloat(cs.marginBottom) || 0);
    const firstBottomFromTrackTop =
      firstCard.offsetTop + scrollEl.offsetTop + scrollPad + firstCard.offsetHeight + mb;
    const cards = scrollEl.querySelectorAll("article.card, .card");
    const secondCard = cards[1] || null;
    const lo = Math.ceil(firstBottomFromTrackTop + 16);
    const secondTopFromTrack = secondCard
      ? secondCard.offsetTop + scrollEl.offsetTop + scrollPad
      : Infinity;
    /** Большой зазор перед второй карточкой — иначе торчит превью во «втором» ряду (овал на скрине). */
    const gapBefore2ndCard = 46;
    const hi = secondCard ? Math.max(lo, secondTopFromTrack - gapBefore2ndCard) : H;
    const navTapPad = Math.min(44, Math.round(navH * 0.5));
    const floorCard = Math.ceil(firstBottomFromTrackTop + 20) + navTapPad;
    const aimStart = Math.round(baseUsable * 0.615);
    let merged = Math.min(hi, Math.max(floorCard, Math.min(aimStart, hi)));
    if (secondCard) {
      const hardCeil = secondTopFromTrack - gapBefore2ndCard - 4;
      merged = Math.min(merged, hardCeil);
    }
    targetOpenVis = Math.min(H, merged);
  } else {
    const headStrip = scrollEl ? Math.round(scrollEl.offsetTop + scrollPad) : chromeOnlyH;
    const navTapPad = Math.min(40, Math.round(navH * 0.45));
    const floorList = Math.round(headStrip + cardH + 16) + navTapPad;
    const aimStart = Math.round(baseUsable * 0.615);
    targetOpenVis = Math.min(H, Math.max(floorList, Math.min(aimStart, H)));
  }
  const halfT = Math.max(0, Math.round(H - targetOpenVis));

  const tabClear = Math.max(96, Math.round(navH + 48));
  const maxPullRaw = Math.max(0, H - peekCollapsedPx);
  const maxPullCap = Math.round(baseUsable * 10 + tabClear + navH);
  const maxPull = Math.min(maxPullRaw, maxPullCap);
  const yLiftExtra = Math.min(100, Math.max(44, Math.round(vh * 0.045)));
  const yPeek = peekT;
  let yMin = Math.min(0, Math.round(yPeek - maxPull - yLiftExtra));
  const yMax = Number.isFinite(yPeek) ? yPeek : 0;
  if (yMax < yMin) yMin = yMax;

  const yHalf = Math.min(yPeek - 10, Math.max(yMin + 16, Math.min(halfT, yPeek)));
  return { h: H, yMin, yMax, yPeek: yMax, yHalf, yMid: yHalf, yFirst: yHalf, vh, navH, peekVisible: peekCollapsedPx, wWrap: W };
}

/** Сразу после innerHTML выставить translate, чтобы не было кадра с transform 0 (шторка «на весь рост»). */
function primeMobileSheetAfterPanelHtml(panel) {
  if (!panel || !window.matchMedia("(max-width: 900px)").matches) return;
  const root = panel.closest(".map-layout");
  if (!root || !root.classList.contains("map-layout--app-sheet")) return;
  const s = getSheetNode(panel);
  if (!s || !s.querySelector(".left-panel-head")) return;
  void panel.offsetHeight;
  const g = getSheetGeometry(panel);
  if (!g) return;
  let t;
  if (state.panelCollapsed) t = clampSheetT(g.yPeek, g);
  else if (state.panelSheetT != null && Number.isFinite(state.panelSheetT)) t = clampSheetT(state.panelSheetT, g);
  else if (!state.panelSheetInitialized) t = clampSheetT(g.yHalf, g);
  else t = clampSheetT(g.yHalf, g);
  s.classList.remove("left-panel--sheet-anim");
  setPanelTranslateY(s, t, false);
}

function bindSheetReflowOnImages(panel, layoutId) {
  if (!panel) return;
  const layout = document.getElementById(layoutId);
  panel.querySelectorAll("img").forEach((img) => {
    if (img.complete) return;
    img.addEventListener(
      "load",
      () => {
        mobileSheetSettleAfterRender(panel, layout);
      },
      { once: true }
    );
  });
}

function sheetRubber(t, g) {
  if (!g) return t;
  if (t < g.yMin) return g.yMin;
  if (t > g.yMax) return g.yMax;
  return t;
}

function clampSheetT(t, g) {
  if (!g) return 0;
  return Math.min(g.yMax, Math.max(g.yMin, t));
}

function rememberSheetPosition(panel) {
  if (!panel) return;
  if (!window.matchMedia("(max-width: 900px)").matches) return;
  if (state.panelCollapsed) return;
  const s = getSheetNode(panel);
  if (!s) return;
  const y = getPanelTranslateY(s);
  if (Number.isFinite(y)) {
    state.panelSheetT = y;
  }
}

/** Старт / возврат на карту или демо: всегда применяем «пол-экрана», не тянем старый translate с пустой панели. */
function resetMobileSheetLandingState() {
  if (!window.matchMedia("(max-width: 900px)").matches) return;
  state.panelSheetInitialized = false;
  state.panelSheetT = null;
  state.panelCollapsed = false;
  state.mapViewportListSig = "";
  state.demoViewportListSig = "";
  state.mapAreaListSig = "";
  state.demoAreaListSig = "";
  state.mapLeftPanelMode = null;
  state.demoLeftPanelMode = null;
}

/** Лёгкое «резиновое» сопротивление у краёв жеста (как шторки iOS). */
function sheetDragRubberTranslate(t, g) {
  if (!g) return t;
  const k = 0.32;
  if (t < g.yMin) return g.yMin + (t - g.yMin) * k;
  if (t > g.yMax) return g.yMax + (t - g.yMax) * k;
  return t;
}

/**
 * После отпускания: медленный жест — остаёмся там, где палец (можно «перелистывать» объекты по одному).
 * Быстрый свайп — инерция (friction), как раскручивание рулона; без жёсткого снапа на середину диапазона.
 */
/**
 * Моб. нижний лист: шторка и карточки — один блок без внутреннего скролла списка.
 * Двигается только transform всего трека; жест с любой точки трека (кроме ссылок/полей).
 */
function bindMobileBottomSheet({ panelId, layoutId, isDemo }) {
  const panel = document.getElementById(panelId);
  if (!panel || panel.dataset.mobileSheetBound === "1") return;
  const layout = () => document.getElementById(layoutId);
  const sheetNode = () => getSheetNode(panel);
  const mq = () => window.matchMedia("(max-width: 900px)").matches;

  let startY = 0;
  let startSheetT = 0;
  let mode = "idle";
  let activeId = null;
  let lastMoveY = 0;
  let lastMoveTs = 0;
  let velocityY = 0;
  let gestureGeometry = null;
  let lastCollapsedUi = state.panelCollapsed;
  let dragMaxAbsDy = 0;
  let capturingTrack = null;
  /** Новое касание отменяет текущую инерцию (fling). */
  let sheetDragInterruptGen = 0;

  const commitSheetState = (y, g) => {
    const atPeek = Math.abs(y - g.yPeek) < 10;
    state.panelCollapsed = atPeek;
    if (!atPeek) {
      state.panelSheetT = y;
    }
    const lay = layout();
    if (lay) {
      if (atPeek) lay.classList.add("collapsed");
      else lay.classList.remove("collapsed");
    }
    if (lastCollapsedUi !== atPeek) {
      lastCollapsedUi = atPeek;
    }
  };

  /** Медленное отпускание — остаёмся на текущем translate (листаем объекты). Быстрый свайп — инерция до остановки. */
  const finishMobileSheetRelease = (s, normalizedT, vy, g) => {
    const gen = sheetDragInterruptGen;
    const V_STAY = 0.32;
    s.classList.remove("left-panel--sheet-live");
    const ty0 = clampSheetT(normalizedT, g);
    if (!Number.isFinite(vy) || Math.abs(vy) < V_STAY) {
      setPanelTranslateY(s, ty0, false);
      commitSheetState(ty0, g);
      if (state.panelCollapsed) state.panelSheetT = g.yPeek;
      else state.panelSheetT = ty0;
      return;
    }
    let t = ty0;
    let v = vy * 0.64;
    let lastTs = performance.now();
    const tStart = lastTs;
    const step = (now) => {
      if (sheetDragInterruptGen !== gen) return;
      const dt = Math.min(44, Math.max(0, now - lastTs));
      lastTs = now;
      t += v * dt;
      if (t < g.yMin) {
        t = g.yMin;
        v *= 0.32;
      } else if (t > g.yPeek) {
        t = g.yPeek;
        v *= 0.32;
      }
      setPanelTranslateY(s, t, false);
      commitSheetState(t, g);
      if (state.panelCollapsed) state.panelSheetT = g.yPeek;
      else state.panelSheetT = t;
      v *= Math.pow(0.972, dt / 16.67);
      if (Math.abs(v) < 0.048) {
        const settle = clampSheetT(t, g);
        setPanelTranslateY(s, settle, false);
        commitSheetState(settle, g);
        if (state.panelCollapsed) state.panelSheetT = g.yPeek;
        else state.panelSheetT = settle;
        return;
      }
      if (now - tStart > 5200) {
        const settle = clampSheetT(t, g);
        setPanelTranslateY(s, settle, false);
        commitSheetState(settle, g);
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const onPointerDown = (e) => {
    if (!mq() || e.button !== 0) return;
    const track = panel.querySelector("[data-sheet-track]");
    if (!track || !track.contains(e.target)) return;
    if (e.target.closest("button.close-left-panel")) return;
    if (e.target.closest("a[href], input, textarea, select, label")) return;

    const s = sheetNode();
    if (!s) return;
    sheetDragInterruptGen += 1;
    capturingTrack = track;

    s.classList.remove("left-panel--sheet-anim");
    gestureGeometry = getSheetGeometry(panel);
    const frozen = getPanelTranslateY(s);
    setPanelTranslateY(s, frozen, false);
    startY = e.clientY;
    startSheetT = frozen;
    lastMoveY = e.clientY;
    lastMoveTs = performance.now();
    velocityY = 0;
    dragMaxAbsDy = 0;
    mode = "decide";
    activeId = e.pointerId;
  };

  const onPointerMove = (e) => {
    if (mode === "idle") return;
    if (e.pointerId != null && e.pointerId !== activeId) return;
    if (!mq()) return;

    const dy = e.clientY - startY;
    if (mode === "decide" && Math.abs(dy) < 8) return;

    if (mode === "decide") {
      mode = "drag";
      e.preventDefault();
      try {
        capturingTrack?.setPointerCapture(e.pointerId);
      } catch (_) {
        /* Safari: capture на треке, у aside pointer-events:none */
      }
      sheetNode()?.classList.add("left-panel--sheet-live");
    }

    if (mode !== "drag") return;
    const s = sheetNode();
    const g = gestureGeometry || getSheetGeometry(panel);
    if (!s || !g) return;

    dragMaxAbsDy = Math.max(dragMaxAbsDy, Math.abs(e.clientY - startY));
    e.preventDefault();
    const tRaw = startSheetT + (e.clientY - startY);
    const tRub = sheetDragRubberTranslate(tRaw, g);
    setPanelTranslateY(s, tRub, false);

    const snappedInner = clampSheetT(tRub, g);
    state.panelSheetT = snappedInner;
    if (snappedInner < g.yPeek - 4) {
      state.panelCollapsed = false;
      const lay = layout();
      lay?.classList.remove("collapsed");
      if (lastCollapsedUi) lastCollapsedUi = false;
    }

    const now = performance.now();
    const dt = Math.max(1, now - lastMoveTs);
    const vy = (e.clientY - lastMoveY) / dt;
    velocityY = velocityY * 0.25 + vy * 0.75;
    lastMoveY = e.clientY;
    lastMoveTs = now;
  };

  const onPointerUp = (e) => {
    const L = layout();
    const s = sheetNode();
    const g = gestureGeometry || getSheetGeometry(panel);

    if (
      mode === "decide" &&
      e.pointerId === activeId &&
      L?.classList.contains("collapsed") &&
      Math.abs(e.clientY - startY) < 12
    ) {
      if (g) {
        L.classList.remove("collapsed");
        const tOpen = clampSheetT(g.yHalf, g);
        const s0 = getSheetNode(panel);
        if (s0) {
          setPanelTranslateY(s0, tOpen, true, 460);
          commitSheetState(tOpen, g);
          state.panelSheetT = tOpen;
        }
      }
      finishPointer(e.pointerId);
      return;
    }

    if (mode === "drag" && s && g) {
      e.preventDefault();
      const nowUp = performance.now();
      const dtUp = Math.max(1, nowUp - lastMoveTs);
      const vyLast = (e.clientY - lastMoveY) / dtUp;
      const vyRelease = Number.isFinite(vyLast)
        ? velocityY * 0.38 + vyLast * 0.62
        : velocityY;
      const rawT = getPanelTranslateY(s);
      const normalizedT = clampSheetT(rawT, g);
      finishMobileSheetRelease(s, normalizedT, vyRelease, g);
    }

    finishPointer(e.pointerId);
  };

  const finishPointer = (pointerId) => {
    if (dragMaxAbsDy > 14) {
      panel.dataset.sheetJustDragged = "1";
      window.setTimeout(() => panel.removeAttribute("data-sheet-just-dragged"), 380);
    }
    dragMaxAbsDy = 0;
    if (pointerId === activeId && activeId != null) {
      try {
        capturingTrack?.releasePointerCapture(pointerId);
      } catch (_) {
        /* */
      }
    }
    capturingTrack = null;
    activeId = null;
    mode = "idle";
    gestureGeometry = null;
    sheetNode()?.classList.remove("left-panel--sheet-live");
  };

  panel.addEventListener(
    "click",
    (ev) => {
      if (panel.dataset.sheetJustDragged !== "1") return;
      if (ev.target.closest(".open-object, .open-demo-object")) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    },
    true
  );

  const onPointerCancel = (e) => {
    const pid = activeId;
    if (mode === "drag" && e.pointerId === pid) {
      const s = sheetNode();
      const g = gestureGeometry || getSheetGeometry(panel);
      if (s && g) {
        const rawT = getPanelTranslateY(s);
        const normalizedT = clampSheetT(rawT, g);
        finishMobileSheetRelease(s, normalizedT, velocityY, g);
      }
    }
    finishPointer(e.pointerId);
  };

  panel.addEventListener("pointerdown", onPointerDown);
  panel.addEventListener("pointermove", onPointerMove, { passive: false });
  panel.addEventListener("pointerup", onPointerUp);
  panel.addEventListener("pointercancel", onPointerCancel);
  panel.dataset.mobileSheetBound = "1";
  ensureMobileSheetVisualViewportReflow();
}

function snapSheetToPeek(panelId, layoutId, isDemo) {
  const panel = document.getElementById(panelId);
  const layout = document.getElementById(layoutId);
  if (!panel || !layout) return;
  const g = getSheetGeometry(panel);
  const s = getSheetNode(panel);
  if (!g || !s) return;
  state.panelCollapsed = true;
  state.panelSheetT = g.yPeek;
  layout.classList.add("collapsed");
  setPanelTranslateY(s, g.yPeek, false);
  if (isDemo) updateDemoOpenPanelButton();
  else updateMapOpenPanelButton();
}

function updateDemoOpenPanelButton() {
  const btn = document.getElementById("openDemoLeftPanelBtn");
  if (!btn) return;
  if (window.matchMedia("(max-width: 900px)").matches) return;
  if (state.panelCollapsed) {
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-hidden", "false");
  } else {
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-hidden", "true");
  }
}

function updateMapOpenPanelButton() {
  const btn = document.getElementById("openLeftPanelBtn");
  if (!btn) return;
  if (window.matchMedia("(max-width: 900px)").matches) return;
  if (state.panelCollapsed) {
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-hidden", "false");
  } else {
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-hidden", "true");
  }
}

function bindMapZoomGuards() {
  if (!window.matchMedia("(max-width: 900px)").matches) return;
  const els = [document.getElementById("map"), document.getElementById("demoMap")].filter(Boolean);
  for (const el of els) {
    if (el.dataset.zoomGuardBound === "1") continue;
    const prevent = (ev) => ev.preventDefault();
    el.addEventListener("gesturestart", prevent, { passive: false });
    el.addEventListener("gesturechange", prevent, { passive: false });
    el.addEventListener("gestureend", prevent, { passive: false });
    el.dataset.zoomGuardBound = "1";
  }
}

function bindMobileBottomNavActions() {
  const searchBtn = document.getElementById("mobileNavSearchBtn");
  const cabinetBtn = document.getElementById("mobileNavCabinetBtn");
  const setActive = (tab) => {
    searchBtn?.classList.toggle("active", tab === "search");
    cabinetBtn?.classList.toggle("active", tab === "cabinet");
  };
  setActive(getActiveMobileNavTab());
  if (searchBtn) {
    const onSearch = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setActive("search");
      const fromCabinetArea =
        location.hash.startsWith("#/cabinet") ||
        location.hash.startsWith("#/auth") ||
        location.hash.startsWith("#/admin") ||
        location.hash.startsWith("#/agency");
      if (fromCabinetArea) {
        // Return to map/search with default half-open sheet position.
        state.panelCollapsed = false;
        state.panelSheetT = null;
        state.panelSheetInitialized = false;
        state.panelCollapsedBeforeCabinet = null;
        state.panelSheetTBeforeCabinet = null;
      }
      if (
        state.panelCollapsedBeforeCabinet != null ||
        state.panelSheetTBeforeCabinet != null
      ) {
        state.panelCollapsed = Boolean(state.panelCollapsedBeforeCabinet);
        state.panelSheetT = state.panelSheetTBeforeCabinet;
        state.panelCollapsedBeforeCabinet = null;
        state.panelSheetTBeforeCabinet = null;
      }
      if (!state.token) {
        if (document.getElementById("authDemoOverlay")) {
          dismissDemoAuthOverlay();
          return;
        }
        if (location.hash !== "#/") location.hash = "#/";
      } else if (location.hash !== "#/map") {
        location.hash = "#/map";
      }
    };
    searchBtn.onclick = onSearch;
    searchBtn.onpointerup = onSearch;
  }
  if (cabinetBtn) {
    const onCabinet = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setActive("cabinet");
      state.panelCollapsedBeforeCabinet = state.panelCollapsed;
      state.panelSheetTBeforeCabinet = state.panelSheetT;
      if (state.token) {
        location.hash = "#/cabinet";
      } else if (location.hash === "#/" || location.hash.startsWith("#/demo/property/")) {
        goToAuthFromGuestDemo("#/auth");
      } else {
        location.hash = "#/auth";
      }
    };
    cabinetBtn.onclick = onCabinet;
    cabinetBtn.onpointerup = onCabinet;
  }
}

function mobileSheetSettleAfterRender(panel, layout, animate = false) {
  if (!panel) return;
  const s = getSheetNode(panel);
  if (!s) return;
  if (!s.querySelector(".left-panel-head")) return;
  if (s.classList.contains("left-panel--sheet-live")) return;
  if (!window.matchMedia("(max-width: 900px)").matches) {
    setPanelTranslateY(s, 0, false);
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const g = getSheetGeometry(panel);
      if (!g) return;
      let t;
      if (state.panelCollapsed) {
        t = clampSheetT(g.yPeek, g);
      } else if (state.panelSheetT != null && Number.isFinite(state.panelSheetT)) {
        t = clampSheetT(state.panelSheetT, g);
      } else if (!state.panelSheetInitialized) {
        t = clampSheetT(g.yHalf, g);
        state.panelSheetT = t;
        state.panelCollapsed = false;
        state.panelSheetInitialized = true;
      } else {
        t = clampSheetT(g.yHalf, g);
      }
      setPanelTranslateY(s, t, animate, animate ? 480 : undefined);
      if (state.panelCollapsed) {
        state.panelSheetT = clampSheetT(g.yPeek, g);
      } else {
        state.panelSheetT = t;
        state.panelCollapsed = false;
        state.panelSheetInitialized = true;
      }
    });
  });
}

/** Карта / flex после первого кадра меняют высоту .map-wrap — без повторного settle шторка остаётся с неверным translate (как в «старой» рабочей версии после reflow). */
function scheduleMobileSheetReflow(panel, layout, opts = {}) {
  if (!panel || !layout || !window.matchMedia("(max-width: 900px)").matches) return;
  let landingResetOnce = opts.resetLandingOnce === true;
  const run = () => {
    const node = getSheetNode(panel);
    if (!node?.querySelector(".left-panel-head") || node.classList.contains("left-panel--sheet-live")) return;
    if (landingResetOnce) {
      landingResetOnce = false;
      state.panelSheetInitialized = false;
      state.panelSheetT = null;
    }
    mobileSheetSettleAfterRender(panel, layout, false);
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      run();
      window.setTimeout(run, 90);
      window.setTimeout(run, 280);
    });
  });
}

/** После создания карты пересчитываем геометрию шторки с нуля (до этого был рендер без карты / с неверной высотой wrap). */
function resetMobileSheetForMapReady() {
  if (!window.matchMedia("(max-width: 900px)").matches) return;
  state.panelSheetInitialized = false;
  state.panelSheetT = null;
}

function mapCollapseLeftPanel() {
  if (state.mapLeftPanelMode === "group") {
    state.mapLeftPanelMode = null;
    state.mapViewportListSig = "";
    state.mapAreaListSig = "";
    state.panelCollapsed = true;
    state.panelSheetT = null;
    const layout = document.getElementById("mapLayout");
    layout?.classList.add("collapsed");
    const p0 = document.getElementById("leftPanel");
    if (p0) getSheetNode(p0)?.classList.remove("left-panel--sheet-live");
    if (state.areaPolygonCoords?.length) {
      renderAreaSelectionPanel(getAreaFilteredProperties());
    } else {
      renderViewportPanel();
    }
    updateMapOpenPanelButton();
    ensureMapDrawControls();
    refreshMapViewport();
    return;
  }
  state.panelCollapsed = true;
  const layout = document.getElementById("mapLayout");
  const p = document.getElementById("leftPanel");
  layout?.classList.add("collapsed");
  if (p) {
    getSheetNode(p)?.classList.remove("left-panel--sheet-live");
    const g = getSheetGeometry(p);
    if (g) {
      const s = getSheetNode(p);
      if (s) {
        setPanelTranslateY(s, g.yPeek, true, 460);
      }
    }
  }
  updateMapOpenPanelButton();
  ensureMapDrawControls();
  refreshMapViewport();
}

function openMapLeftPanel() {
  state.panelCollapsed = false;
  state.panelSheetT = null;
  state.mapLeftPanelMode = null;
  state.mapViewportListSig = "";
  state.mapAreaListSig = "";
  const layout = document.getElementById("mapLayout");
  layout?.classList.remove("collapsed");
  const p = document.getElementById("leftPanel");
  if (p) {
    getSheetNode(p)?.classList.remove("left-panel--sheet-live");
  }
  if (state.areaPolygonCoords?.length) {
    renderAreaSelectionPanel(getAreaFilteredProperties());
  } else {
    renderViewportPanel();
  }
  mobileSheetSettleAfterRender(p, layout, true);
  updateMapOpenPanelButton();
  ensureMapDrawControls();
  refreshMapViewport();
}

function setMapDefaultLeftPanel() {
  const panel = document.getElementById("leftPanel");
  if (!panel) return;
  state.mapViewportListSig = "";
  state.mapAreaListSig = "";
  state.mapLeftPanelMode = null;
  panel.innerHTML = leftPanelMobileBlock(
    "mapLeftPanelHandleArea",
    `<div class="left-panel-head">
      <h3>Выберите объект на карте</h3>
      <button class="close-left-panel" id="closeLeftPanel" aria-label="Свернуть панель">×</button>
    </div>`,
    ""
  );
  document.getElementById("closeLeftPanel")?.addEventListener("click", () => {
    mapCollapseLeftPanel();
  });
  const lp = document.getElementById("leftPanel");
  primeMobileSheetAfterPanelHtml(lp);
  mobileSheetSettleAfterRender(lp, document.getElementById("mapLayout"));
}

function demoCollapseLeftPanel() {
  if (state.demoLeftPanelMode === "group") {
    state.demoLeftPanelMode = null;
    state.demoViewportListSig = "";
    state.demoAreaListSig = "";
    state.panelCollapsed = true;
    state.panelSheetT = null;
    const layout = document.getElementById("demoMapLayout");
    layout?.classList.add("collapsed");
    const p0 = document.getElementById("demoLeftPanel");
    if (p0) getSheetNode(p0)?.classList.remove("left-panel--sheet-live");
    if (state.areaPolygonCoords?.length) {
      renderDemoAreaSelectionPanel();
    } else {
      renderDemoViewportPanel();
    }
    updateDemoOpenPanelButton();
    ensureMapDrawControls();
    refreshMapViewport();
    return;
  }
  state.panelCollapsed = true;
  const layout = document.getElementById("demoMapLayout");
  const p = document.getElementById("demoLeftPanel");
  layout?.classList.add("collapsed");
  if (p) {
    getSheetNode(p)?.classList.remove("left-panel--sheet-live");
    const g = getSheetGeometry(p);
    if (g) {
      const s = getSheetNode(p);
      if (s) {
        setPanelTranslateY(s, g.yPeek, true, 460);
      }
    }
  }
  updateDemoOpenPanelButton();
  ensureMapDrawControls();
  refreshMapViewport();
}

/**
 * Моб. демо — сценарий шторки (спека для поддержки):
 * Открытие демо: карта + нижний рулон (~половина экрана), заголовок со счётчиком, объекты по видимой области.
 * Жест: только transform [data-sheet-track], без скролла карточек внутри белого блока.
 * Тап по метке: другой контент («Объектов в точке») — не подставлять старый translateY после смены DOM (иначе шторка пропадает).
 * Свёртка: до полосы со счётчиком; карта не должна перекрывать шторку (см. z-index в CSS).
 */
function renderDemoPanel(list, title, opts = {}) {
  const resetSheetPosition = opts.resetSheetPosition === true;
  const panel = document.getElementById("demoLeftPanel");
  if (!panel) return;
  if (opts.listKind === "viewport" || opts.listKind === "area" || opts.listKind === "group") {
    state.demoLeftPanelMode = opts.listKind;
  }
  if (!resetSheetPosition) rememberSheetPosition(panel);
  else {
    state.panelSheetT = null;
    if (window.matchMedia("(max-width: 900px)").matches) {
      state.panelSheetInitialized = false;
    }
  }
  const cards = list.length ? list.map(demoCardMarkup).join("") : `<p class="muted">Объекты не найдены.</p>`;
  const bodyHtml = list.length ? `${cards}${sheetObjectsListFooterHtml()}` : cards;
  panel.innerHTML = leftPanelMobileBlock(
    "demoLeftPanelHandleArea",
    `<div class="left-panel-head"><h3>${title}: ${list.length}</h3><button class="close-left-panel" id="closeDemoLeftPanel" aria-label="Свернуть панель">×</button></div>`,
    bodyHtml
  );
  document.getElementById("closeDemoLeftPanel")?.addEventListener("click", () => {
    demoCollapseLeftPanel();
  });
  bindDemoCardButtons(panel);
  primeMobileSheetAfterPanelHtml(panel);
  bindSheetReflowOnImages(panel, "demoMapLayout");
  mobileSheetSettleAfterRender(panel, document.getElementById("demoMapLayout"), resetSheetPosition);
}

function getDemoViewportPropertyList() {
  const list = getAreaFilteredProperties();
  if (!state.mapInstance) return list;
  const bounds = state.mapInstance.getBounds();
  if (!bounds) return list;
  return list.filter((item) => isPointInsideBounds(Number(item.lat), Number(item.lon), bounds));
}

function renderDemoViewportPanel() {
  if (state.demoLeftPanelMode === "group") return;
  const panel = document.getElementById("demoLeftPanel");
  const list = getDemoViewportPropertyList().sort((a, b) => b.commissionPartner - a.commissionPartner);
  const sig = `dv:${list.map((i) => i.id).join(",")}|n:${list.length}`;
  const hasTrack = Boolean(panel?.querySelector("[data-sheet-track]"));
  if (hasTrack && sig === state.demoViewportListSig && state.demoLeftPanelMode === "viewport") return;
  state.demoViewportListSig = sig;
  renderDemoPanel(list, "Объекты в видимой области", { listKind: "viewport" });
}

function renderDemoAreaSelectionPanel() {
  if (state.demoLeftPanelMode === "group") return;
  const panel = document.getElementById("demoLeftPanel");
  const list = getAreaFilteredProperties().sort((a, b) => b.commissionPartner - a.commissionPartner);
  const poly = state.areaPolygonCoords || [];
  const polyKey = poly.length ? `${poly.length}:${Math.round((poly[0]?.[0] || 0) * 1e5)}` : "0";
  const sig = `da:${polyKey}:${list.map((i) => i.id).join(",")}|n:${list.length}`;
  const hasTrack = Boolean(panel?.querySelector("[data-sheet-track]"));
  if (hasTrack && sig === state.demoAreaListSig && state.demoLeftPanelMode === "area") return;
  state.demoAreaListSig = sig;
  renderDemoPanel(list, "Объекты в выделенной области", { listKind: "area" });
}

function showDemoGroup(properties) {
  state.demoViewportListSig = "";
  state.demoAreaListSig = "";
  state.panelCollapsed = false;
  document.getElementById("demoMapLayout")?.classList.remove("collapsed");
  updateDemoOpenPanelButton();
  const sorted = properties.slice().sort((a, b) => b.commissionPartner - a.commissionPartner);
  const [focusLat, focusLon] = groupCentroid(sorted);
  renderDemoPanel(sorted, "Объектов в точке", { resetSheetPosition: true, listKind: "group" });
  scheduleMobileSheetReflow(document.getElementById("demoLeftPanel"), document.getElementById("demoMapLayout"));
  requestAnimationFrame(() => {
    requestAnimationFrame(() => focusMapOnPlacemark(focusLat, focusLon, "demoLeftPanel"));
  });
}

function applyDemoFilters() {
  if (!state.demoAllProperties || !state.demoAllProperties.length) {
    state.demoAllProperties = createDemoProperties(100);
  }
  state.properties = filterPropertiesByState(state.demoAllProperties);
  state.demoViewportListSig = "";
  state.demoAreaListSig = "";
  state.demoLeftPanelMode = null;
  if (window.ymaps) {
    ymaps.ready(() => initDemoMap());
  } else {
    setTimeout(applyDemoFilters, 200);
  }
}

function renderPublicDemoPage() {
  setMapBodyClass(true);
  resetMobileSheetLandingState();
  if (state.demoDataVersion !== CURRENT_DEMO_DATA_VERSION) {
    state.demoAllProperties = null;
    state.demoDataVersion = CURRENT_DEMO_DATA_VERSION;
  }
  if (!state.demoAllProperties || !state.demoAllProperties.length) {
    state.demoAllProperties = createDemoProperties(100);
  }
  state.properties = filterPropertiesByState(state.demoAllProperties);

  app.innerHTML = `
    <section class="demo-page">
      ${demoPublicTopbar()}
      ${mobileMapChromeHtml(true)}
      <div class="demo-top-strip" id="demoTopStrip" aria-label="Справка по демо">
        <p class="demo-top-strip__line">
          <strong>Демо</strong> · 100 точек · список снизу: тяните панель, нажмите метку или обведите район ✍
        </p>
        <button type="button" class="btn demo-top-strip__open" id="demoAboutOpen">О демо</button>
      </div>
      <main class="map-layout demo-map-layout map-layout--app-sheet ${state.panelCollapsed ? "collapsed" : ""}" id="demoMapLayout">
        <div class="map-wrap demo-map-wrap">
          <aside class="left-panel" id="demoLeftPanel"></aside>
          <div class="map-stage">
            <div id="demoMap" class="map"></div>
            <canvas id="mapDrawCanvas" class="map-draw-canvas"></canvas>
            <button
              class="open-left-panel-btn open-left-panel-btn--sheet"
              type="button"
              id="openDemoLeftPanelBtn"
              aria-label="Открыть список объектов"
              aria-controls="demoLeftPanel"
              aria-expanded="false"
              aria-hidden="true"
            >
              <span class="open-left-panel-ico open-left-panel-ico--mob" aria-hidden="true">▲</span>
              <span class="open-left-panel-ico open-left-panel-ico--desk" aria-hidden="true">❯</span>
              <span class="open-left-panel-label">Список</span>
            </button>
            ${mapDrawToolsHtml()}
            <div class="map-sheet-left-scrim" id="demoLeftPanelScrim" aria-hidden="true"></div>
          </div>
        </div>
      </main>
      <div class="demo-hero demo-float-desktop">
        <h1>Демо BrokerMap</h1>
        <p>100 объектов по Москве. Сверху — те же фильтры, что в сервисе. Нажмите на <strong>точку на карте</strong>, откройте карточку или обведите район кистью.</p>
        <p class="demo-hero-hint">После рисования область в приоритете над видимой частью карты (как в рабочей версии).</p>
      </div>
      <div class="demo-list panel demo-float-desktop">
        <div class="panel-head">
          <h3>Что внутри платформы</h3>
          <span class="muted">Карта · Фильтры · Карточки · Галереи · PDF · Личный кабинет</span>
        </div>
        <p class="muted">Сначала посмотрите демо, затем зарегистрируйтесь — чтобы публиковать свои объекты и находить на карте объекты с комиссией от партнёров.</p>
      </div>
      <div class="modal" id="demoAboutModal" role="dialog" aria-modal="true" aria-labelledby="demoAboutTitle">
        <div class="modal-card demo-about-card">
          <div class="demo-about-head">
            <h2 id="demoAboutTitle">Демо BrokerMap</h2>
            <button type="button" class="close-left-panel" id="demoAboutClose" aria-label="Закрыть">×</button>
          </div>
          <div class="demo-about-body">
            <h3>Как пользоваться</h3>
            <p class="muted">100 объектов по Москве. Сверху — те же фильтры, что в сервисе. Нажмите на <strong>точку на карте</strong>, откройте карточку или обведите район кистью.</p>
            <p class="muted">После рисования область в приоритете над видимой частью карты (как в рабочей версии).</p>
            <h3>Что внутри платформы</h3>
            <p class="muted">Карта · Фильтры · Карточки · Галереи · PDF · Личный кабинет</p>
            <p class="muted">Сначала посмотрите демо, затем зарегистрируйтесь — чтобы публиковать свои объекты и находить на карте объекты с комиссией от партнёров.</p>
          </div>
        </div>
      </div>
      ${moreFiltersModalHtml()}
    </section>
  `;

  bindBrandHomeButton();
  document.getElementById("demoMobileFiltersBtn")?.addEventListener("click", () => {
    document.getElementById("filtersModal")?.classList.add("open");
  });
  bindMobileBottomNavActions();
  updateMobileNavMetrics();
  document.getElementById("mapDrawAreaBtn")?.addEventListener("click", startAreaDrawing);
  bindMapDrawHint();
  ensureMapDrawControls();

  document.getElementById("moreFilters")?.addEventListener("click", () => {
    document.getElementById("filtersModal")?.classList.add("open");
  });
  document.getElementById("closeFiltersXBtn")?.addEventListener("click", () => {
    document.getElementById("filtersModal")?.classList.remove("open");
  });
  document.getElementById("filtersModal")?.addEventListener("click", (e) => {
    if (e.target?.id === "filtersModal") {
      document.getElementById("filtersModal")?.classList.remove("open");
    }
  });
  const demoAbout = document.getElementById("demoAboutModal");
  const openAbout = () => demoAbout?.classList.add("open");
  const closeAbout = () => demoAbout?.classList.remove("open");
  document.getElementById("demoAboutOpen")?.addEventListener("click", openAbout);
  document.getElementById("demoAboutClose")?.addEventListener("click", closeAbout);
  demoAbout?.addEventListener("click", (e) => {
    if (e.target === demoAbout) closeAbout();
  });
  document.getElementById("applyMoreFilters")?.addEventListener("click", () => {
    const modalMin = document.getElementById("modalMinPrice")?.value || "";
    const modalMax = document.getElementById("modalMaxPrice")?.value || "";
    const modalBedrooms = document.getElementById("modalBedrooms")?.value || "";
    state.filters.minPrice = toRawNumberString(modalMin);
    state.filters.maxPrice = toRawNumberString(modalMax);
    state.filters.bedrooms = modalBedrooms;
    state.filters.floorMin = toRawNumberString(document.getElementById("filterFloorMin")?.value || "");
    state.filters.floorMax = toRawNumberString(document.getElementById("filterFloorMax")?.value || "");
    state.filters.totalFloorsMin = toRawNumberString(document.getElementById("filterTotalFloorsMin")?.value || "");
    state.filters.totalFloorsMax = toRawNumberString(document.getElementById("filterTotalFloorsMax")?.value || "");
    state.filters.ceilingHeightMin = normalizeDecimalInput(
      String(document.getElementById("filterCeilingMin")?.value || "").replace(",", ".")
    );
    state.filters.partnerCommissionMinPct = normalizeDecimalInput(document.getElementById("filterPartnerPct")?.value || "");
    state.filters.partnerCommissionMinRub = toRawNumberString(document.getElementById("filterPartnerRub")?.value || "");
    state.filters.finishing = document.getElementById("filterFinishing")?.value || "";
    state.filters.readiness = document.getElementById("filterReadiness")?.value || "";
    state.filters.minArea = normalizeDecimalInput(
      String(document.getElementById("filterAreaMin")?.value || "").replace(",", ".")
    );
    state.filters.maxArea = normalizeDecimalInput(
      String(document.getElementById("filterAreaMax")?.value || "").replace(",", ".")
    );
    state.filters.housingStatus = document.getElementById("filterHousingStatus")?.value || "";
    state.filters.publishedFrom = document.getElementById("filterPublishedFrom")?.value || "";
    state.filters.metroWalkMax = toRawNumberString(document.getElementById("filterMetroWalkMax")?.value || "");
    document.getElementById("filtersModal")?.classList.remove("open");
    applyDemoFilters();
  });
  document.getElementById("resetMoreFilters")?.addEventListener("click", () => {
    state.filters = emptyFilters();
    if (document.getElementById("modalMinPrice")) document.getElementById("modalMinPrice").value = "";
    if (document.getElementById("modalMaxPrice")) document.getElementById("modalMaxPrice").value = "";
    if (document.getElementById("modalBedrooms")) document.getElementById("modalBedrooms").value = "";
    document.getElementById("filterFloorMin").value = "";
    document.getElementById("filterFloorMax").value = "";
    document.getElementById("filterTotalFloorsMin").value = "";
    document.getElementById("filterTotalFloorsMax").value = "";
    document.getElementById("filterCeilingMin").value = "";
    document.getElementById("filterPartnerPct").value = "";
    document.getElementById("filterPartnerRub").value = "";
    document.getElementById("filterFinishing").value = "";
    document.getElementById("filterReadiness").value = "";
    if (document.getElementById("filterAreaMin")) document.getElementById("filterAreaMin").value = "";
    if (document.getElementById("filterAreaMax")) document.getElementById("filterAreaMax").value = "";
    if (document.getElementById("filterHousingStatus")) document.getElementById("filterHousingStatus").value = "";
    if (document.getElementById("filterPublishedFrom")) document.getElementById("filterPublishedFrom").value = "";
    if (document.getElementById("filterMetroWalkMax")) document.getElementById("filterMetroWalkMax").value = "";
    document.getElementById("filtersModal")?.classList.remove("open");
    applyDemoFilters();
  });
  bindFiltersModalNumericFormatting();

  document.getElementById("maxPrice")?.addEventListener("input", (e) => {
    const raw = toRawNumberString(e.target.value);
    state.filters.maxPrice = raw;
    e.target.value = formatSpacedNumber(raw);
    applyDemoFilters();
  });
  document.getElementById("minPrice")?.addEventListener("input", (e) => {
    const raw = toRawNumberString(e.target.value);
    state.filters.minPrice = raw;
    e.target.value = formatSpacedNumber(raw);
    applyDemoFilters();
  });
  document.getElementById("bedroomsFilter")?.addEventListener("change", (e) => {
    state.filters.bedrooms = e.target.value;
    applyDemoFilters();
  });
  document.getElementById("resetFilters")?.addEventListener("click", () => {
    state.filters = emptyFilters();
    if (state.demoAllProperties && state.demoAllProperties.length) {
      state.properties = filterPropertiesByState(state.demoAllProperties);
    }
    clearAreaFilter();
    document.getElementById("minPrice").value = "";
    document.getElementById("maxPrice").value = "";
    document.getElementById("bedroomsFilter").value = "";
    if (document.getElementById("filterFloorMin")) {
      document.getElementById("filterFloorMin").value = "";
      document.getElementById("filterFloorMax").value = "";
      document.getElementById("filterTotalFloorsMin").value = "";
      document.getElementById("filterTotalFloorsMax").value = "";
      document.getElementById("filterCeilingMin").value = "";
      document.getElementById("filterPartnerPct").value = "";
      document.getElementById("filterPartnerRub").value = "";
      document.getElementById("filterFinishing").value = "";
      document.getElementById("filterReadiness").value = "";
      if (document.getElementById("filterAreaMin")) document.getElementById("filterAreaMin").value = "";
      if (document.getElementById("filterAreaMax")) document.getElementById("filterAreaMax").value = "";
      if (document.getElementById("filterHousingStatus")) document.getElementById("filterHousingStatus").value = "";
      if (document.getElementById("filterPublishedFrom")) document.getElementById("filterPublishedFrom").value = "";
      if (document.getElementById("filterMetroWalkMax")) document.getElementById("filterMetroWalkMax").value = "";
    }
  });

  document.getElementById("demoAuthLogin")?.addEventListener("click", () => {
    goToAuthFromGuestDemo("#/auth-form");
  });
  document.getElementById("demoAuthRegister")?.addEventListener("click", () => {
    goToAuthFromGuestDemo("#/auth-register");
  });

  applyDemoFilters();
  /** Шторка: до готовности карты панель не заполнялась async initDemoMap — на мобилке пустой экран. */
  if (window.matchMedia("(max-width: 900px)").matches) {
    renderDemoViewportPanel();
  }
  function openDemoLeftPanel() {
    state.panelCollapsed = false;
    state.panelSheetT = null;
    state.demoLeftPanelMode = null;
    state.demoViewportListSig = "";
    state.demoAreaListSig = "";
    const layout = document.getElementById("demoMapLayout");
    layout?.classList.remove("collapsed");
    const p = document.getElementById("demoLeftPanel");
    if (p) {
      getSheetNode(p)?.classList.remove("left-panel--sheet-live");
    }
    if (state.areaPolygonCoords?.length) {
      renderDemoAreaSelectionPanel();
    } else {
      renderDemoViewportPanel();
    }
    const pAfter = document.getElementById("demoLeftPanel");
    mobileSheetSettleAfterRender(pAfter, layout, true);
    updateDemoOpenPanelButton();
    ensureMapDrawControls();
    refreshMapViewport();
  }

  document.getElementById("openDemoLeftPanelBtn")?.addEventListener("click", openDemoLeftPanel);
  document.getElementById("demoLeftPanelScrim")?.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      demoCollapseLeftPanel();
    }
  });

  updateDemoOpenPanelButton();
  bindMobileBottomSheet({ panelId: "demoLeftPanel", layoutId: "demoMapLayout", isDemo: true });
  bindMapZoomGuards();
}

function renderDemoPropertyPage(id) {
  setMapBodyClass(false);
  if (!state.demoAllProperties || !state.demoAllProperties.length) {
    state.demoAllProperties = createDemoProperties(100);
  }
  const property = state.demoAllProperties.find((item) => item.id === id) || state.demoAllProperties[0];
  const galleryPhotos = (property.photos || []).length ? property.photos : [PLACEHOLDER_IMAGE_URL];
  const demoMetroLine = propertyMetroLabel(property);
  app.innerHTML = `
    <section class="page">
      <p><button class="btn" id="backToDemoBtn">← Назад к демо-карте</button></p>
      <div class="grid-2">
        <div class="panel">
          <h2>${property.title}</h2>
          <div class="gallery">
            ${galleryPhotos
              .map(
                (photo, gi) =>
                  `<img class="gallery__img" ${imgLazyAttrs({ priority: gi === 0 ? "high" : undefined })} src="${photoUrlWithFallback(
                    photo,
                    { gallery: true }
                  )}" onerror="${photoOnErrorAttr()}" alt="Фото демо-объекта" />`
              )
              .join("")}
          </div>
          <p>${property.description || ""}</p>
        </div>
        <aside class="panel">
          <h3>${money(property.price)} ₽</h3>
          <p><strong>Адрес:</strong> ${property.address}</p>
          ${demoMetroLine ? `<p><strong>Метро:</strong> ${escapeHtml(demoMetroLine)}</p>` : ""}
          ${
            property.metroWalkMinutes != null && Number.isFinite(Number(property.metroWalkMinutes))
              ? `<p><strong>Пешком до метро:</strong> ${Number(property.metroWalkMinutes)} мин</p>`
              : ""
          }
          <p><strong>Статус жилья:</strong> ${housingStatusLabel(property.housingStatus)}</p>
          <p><strong>Дата публикации:</strong> ${escapeHtml(formatPublishedDateRu(property.publishedAt || property.createdAt))}</p>
          <p><strong>Площадь:</strong> ${property.area} м²</p>
          <p><strong>Спален:</strong> ${property.bedrooms}</p>
          <p><strong>Общая комиссия:</strong> ${property.commissionTotal}%</p>
          <p><strong>Партнеру:</strong> ${property.commissionPartner}%</p>
          <p><button class="btn" id="demoOpenContactsBtn">Открыть контакты</button></p>
          <p><button class="btn primary" id="demoToAuthBtn">Начать делать сделки</button></p>
        </aside>
      </div>
    </section>
    ${mobileBottomNavHtml("search")}
  `;
  document.getElementById("backToDemoBtn")?.addEventListener("click", () => {
    location.hash = "#/";
  });
  document.getElementById("demoToAuthBtn")?.addEventListener("click", () => {
    goToAuthFromGuestDemo("#/auth-register");
  });
  document.getElementById("demoOpenContactsBtn")?.addEventListener("click", () => {
    goToAuthFromGuestDemo("#/auth-register");
  });
  bindMobileBottomNavActions();
  updateMobileNavMetrics();
}

function renderMapPage() {
  setMapBodyClass(true);
  resetMobileSheetLandingState();
  app.innerHTML = `
    <section class="map-page">
    ${topbar()}
    ${mobileMapChromeHtml(false)}
    <main class="map-layout map-layout--app-sheet ${state.panelCollapsed ? "collapsed" : ""}" id="mapLayout">
      <div class="map-wrap">
        <aside class="left-panel" id="leftPanel">
          ${leftPanelMobileBlock(
            "mapLeftPanelHandleArea",
            `<div class="left-panel-head">
            <h3>Выберите объект на карте</h3>
            <button class="close-left-panel" id="closeLeftPanel" aria-label="Свернуть панель">×</button>
          </div>`,
            ""
          )}
        </aside>
        <div class="map-stage">
          <div id="map" class="map"></div>
          <canvas id="mapDrawCanvas" class="map-draw-canvas"></canvas>
          <button
            class="open-left-panel-btn open-left-panel-btn--sheet"
            type="button"
            id="openLeftPanelBtn"
            aria-label="Открыть список объектов"
            aria-controls="leftPanel"
            aria-expanded="false"
            aria-hidden="true"
          >
            <span class="open-left-panel-ico open-left-panel-ico--mob" aria-hidden="true">▲</span>
            <span class="open-left-panel-ico open-left-panel-ico--desk" aria-hidden="true">❯</span>
            <span class="open-left-panel-label">Список</span>
          </button>
          ${mapDrawToolsHtml()}
          <div class="map-sheet-left-scrim" id="mapLeftPanelScrim" aria-hidden="true"></div>
        </div>
      </div>
    </main>
    </section>
    ${moreFiltersModalHtml()}
  `;

  bindBrandHomeButton();
  document.getElementById("mapMobileFiltersBtn")?.addEventListener("click", () => {
    document.getElementById("filtersModal")?.classList.add("open");
  });
  bindMobileBottomNavActions();
  updateMobileNavMetrics();
  document.getElementById("cabinetBtn")?.addEventListener("click", () => {
    location.hash = state.user ? "#/cabinet" : "#/auth";
  });
  document.getElementById("adminBtn")?.addEventListener("click", () => {
    location.hash = "#/admin";
  });
  document.getElementById("agencyBtn")?.addEventListener("click", () => {
    location.hash = "#/agency";
  });
  document.getElementById("moreFilters").addEventListener("click", () => {
    document.getElementById("filtersModal").classList.add("open");
  });
  document.getElementById("closeFiltersXBtn").addEventListener("click", () => {
    document.getElementById("filtersModal").classList.remove("open");
  });
  document.getElementById("filtersModal")?.addEventListener("click", (e) => {
    if (e.target?.id === "filtersModal") {
      document.getElementById("filtersModal")?.classList.remove("open");
    }
  });
  document.getElementById("applyMoreFilters").addEventListener("click", () => {
    state.filters.minPrice = toRawNumberString(document.getElementById("modalMinPrice")?.value || "");
    state.filters.maxPrice = toRawNumberString(document.getElementById("modalMaxPrice")?.value || "");
    state.filters.bedrooms = document.getElementById("modalBedrooms")?.value || "";
    state.filters.floorMin = toRawNumberString(document.getElementById("filterFloorMin")?.value || "");
    state.filters.floorMax = toRawNumberString(document.getElementById("filterFloorMax")?.value || "");
    state.filters.totalFloorsMin = toRawNumberString(document.getElementById("filterTotalFloorsMin")?.value || "");
    state.filters.totalFloorsMax = toRawNumberString(document.getElementById("filterTotalFloorsMax")?.value || "");
    state.filters.ceilingHeightMin = normalizeDecimalInput(
      String(document.getElementById("filterCeilingMin")?.value || "").replace(",", ".")
    );
    state.filters.partnerCommissionMinPct = normalizeDecimalInput(document.getElementById("filterPartnerPct")?.value || "");
    state.filters.partnerCommissionMinRub = toRawNumberString(document.getElementById("filterPartnerRub")?.value || "");
    state.filters.finishing = document.getElementById("filterFinishing").value;
    state.filters.readiness = document.getElementById("filterReadiness").value;
    state.filters.minArea = normalizeDecimalInput(
      String(document.getElementById("filterAreaMin")?.value || "").replace(",", ".")
    );
    state.filters.maxArea = normalizeDecimalInput(
      String(document.getElementById("filterAreaMax")?.value || "").replace(",", ".")
    );
    state.filters.housingStatus = document.getElementById("filterHousingStatus")?.value || "";
    state.filters.publishedFrom = document.getElementById("filterPublishedFrom")?.value || "";
    state.filters.metroWalkMax = toRawNumberString(document.getElementById("filterMetroWalkMax")?.value || "");
    document.getElementById("filtersModal").classList.remove("open");
    loadMapData();
  });
  document.getElementById("resetMoreFilters").addEventListener("click", () => {
    state.filters = emptyFilters();
    document.getElementById("filtersModal").classList.remove("open");
    renderMapPage();
  });
  bindFiltersModalNumericFormatting();
  document.getElementById("closeLeftPanel")?.addEventListener("click", mapCollapseLeftPanel);
  document.getElementById("openLeftPanelBtn")?.addEventListener("click", openMapLeftPanel);
  document.getElementById("mapLeftPanelScrim")?.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      mapCollapseLeftPanel();
    }
  });
  bindMobileBottomSheet({ panelId: "leftPanel", layoutId: "mapLayout", isDemo: false });
  bindMapZoomGuards();
  document.getElementById("mapDrawAreaBtn")?.addEventListener("click", startAreaDrawing);
  bindMapDrawHint();
  ensureMapDrawControls();
  updateMapOpenPanelButton();

  document.getElementById("maxPrice").addEventListener("input", (e) => {
    const raw = toRawNumberString(e.target.value);
    state.filters.maxPrice = raw;
    e.target.value = formatSpacedNumber(raw);
    loadMapData();
  });

  document.getElementById("minPrice").addEventListener("input", (e) => {
    const raw = toRawNumberString(e.target.value);
    state.filters.minPrice = raw;
    e.target.value = formatSpacedNumber(raw);
    loadMapData();
  });
  document.getElementById("bedroomsFilter").addEventListener("change", (e) => {
    state.filters.bedrooms = e.target.value;
    loadMapData();
  });
  document.getElementById("resetFilters").addEventListener("click", () => {
    state.filters = emptyFilters();
    state.panelCollapsed = false;
    state.panelSheetT = null;
    clearAreaFilter();
    renderMapPage();
  });

  loadMapData();
}

function pointInPolygon(point, polygon) {
  const x = point[1];
  const y = point[0];
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1];
    const yi = polygon[i][0];
    const xj = polygon[j][1];
    const yj = polygon[j][0];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function getAreaFilteredProperties() {
  if (!state.areaPolygonCoords || !state.areaPolygonCoords.length) return state.properties;
  const polygon = state.areaPolygonCoords[0] || [];
  if (!polygon.length) return state.properties;
  return state.properties.filter((item) => pointInPolygon([item.lat, item.lon], polygon));
}

function renderAreaSelectionPanel(list) {
  if (state.mapLeftPanelMode === "group") return;
  const panel = document.getElementById("leftPanel");
  if (!panel) return;
  const poly = state.areaPolygonCoords || [];
  const polyKey = poly.length ? `${poly.length}:${Math.round((poly[0]?.[0] || 0) * 1e5)}` : "0";
  const sig = `a:${polyKey}:${list.map((i) => i.id).join(",")}|n:${list.length}`;
  const hasTrack = Boolean(panel.querySelector("[data-sheet-track]"));
  if (hasTrack && sig === state.mapAreaListSig && state.mapLeftPanelMode === "area") return;
  state.mapAreaListSig = sig;
  rememberSheetPosition(panel);
  const cards = list.length ? list.map(cardMarkup).join("") : `<p class="muted">Внутри области объекты не найдены.</p>`;
  const bodyHtml = list.length ? `${cards}${sheetObjectsListFooterHtml()}` : cards;
  panel.innerHTML = leftPanelMobileBlock(
    "mapLeftPanelHandleArea",
    `<div class="left-panel-head"><h3>Объекты в выделенной области: ${list.length}</h3><button class="close-left-panel" id="closeLeftPanel" aria-label="Свернуть панель">×</button></div>`,
    bodyHtml
  );
  document.getElementById("closeLeftPanel")?.addEventListener("click", () => {
    mapCollapseLeftPanel();
  });
  panel.querySelectorAll(".open-object").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#/property/${btn.dataset.id}`;
    });
  });
  bindSheetReflowOnImages(panel, "mapLayout");
  primeMobileSheetAfterPanelHtml(panel);
  mobileSheetSettleAfterRender(panel, document.getElementById("mapLayout"), false);
  state.mapLeftPanelMode = "area";
}

function isPointInsideBounds(lat, lon, bounds) {
  if (!bounds || bounds.length < 2) return true;
  const south = bounds[0][0];
  const west = bounds[0][1];
  const north = bounds[1][0];
  const east = bounds[1][1];
  return lat >= south && lat <= north && lon >= west && lon <= east;
}

function getViewportProperties() {
  const list = getAreaFilteredProperties();
  if (!state.mapInstance) return list;
  const bounds = state.mapInstance.getBounds();
  if (!bounds) return list;
  return list.filter((item) => isPointInsideBounds(Number(item.lat), Number(item.lon), bounds));
}

function renderViewportPanel() {
  if (state.mapLeftPanelMode === "group") return;
  const panel = document.getElementById("leftPanel");
  if (!panel) return;
  const list = getViewportProperties().sort((a, b) => b.commissionPartner - a.commissionPartner);
  const sig = `v:${list.map((i) => i.id).join(",")}|n:${list.length}`;
  const hasTrack = Boolean(panel.querySelector("[data-sheet-track]"));
  if (hasTrack && sig === state.mapViewportListSig && state.mapLeftPanelMode === "viewport") return;
  state.mapViewportListSig = sig;
  rememberSheetPosition(panel);
  const cards = list.length ? list.map(cardMarkup).join("") : `<p class="muted">В текущей области объекты не найдены.</p>`;
  const bodyHtml = list.length ? `${cards}${sheetObjectsListFooterHtml()}` : cards;
  panel.innerHTML = leftPanelMobileBlock(
    "mapLeftPanelHandleArea",
    `<div class="left-panel-head"><h3>Объекты в видимой области: ${list.length}</h3><button class="close-left-panel" id="closeLeftPanel" aria-label="Свернуть панель">×</button></div>`,
    bodyHtml
  );
  document.getElementById("closeLeftPanel")?.addEventListener("click", () => {
    mapCollapseLeftPanel();
  });
  panel.querySelectorAll(".open-object").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#/property/${btn.dataset.id}`;
    });
  });
  bindSheetReflowOnImages(panel, "mapLayout");
  primeMobileSheetAfterPanelHtml(panel);
  mobileSheetSettleAfterRender(panel, document.getElementById("mapLayout"), false);
  state.mapLeftPanelMode = "viewport";
}

function syncDrawButtons() {
  const drawBtn = document.getElementById("mapDrawAreaBtn");
  const drawCanvas = document.getElementById("mapDrawCanvas");
  if (!drawBtn) return;
  drawBtn.classList.toggle("active", state.areaDrawMode);
  drawBtn.title = state.areaDrawMode ? "Режим рисования включен" : "Рисовать область";
  if (state.areaDrawMode) {
    const hint = document.getElementById("mapDrawHint");
    if (hint) hint.classList.add("hidden");
    localStorage.setItem("mapDrawHintDismissed", "1");
  }
  if (drawCanvas) {
    drawCanvas.classList.toggle("active", state.areaDrawMode);
  }
}

function setDemoDefaultLeftPanel() {
  const panel = document.getElementById("demoLeftPanel");
  if (!panel) return;
  state.demoViewportListSig = "";
  state.demoAreaListSig = "";
  state.demoLeftPanelMode = null;
  panel.innerHTML = leftPanelMobileBlock(
    "demoLeftPanelHandleArea",
    `<div class="left-panel-head">
      <h3>Нажмите на точку на карте</h3>
      <button class="close-left-panel" id="closeDemoLeftPanel" aria-label="Свернуть панель">×</button>
    </div>`,
    ""
  );
  document.getElementById("closeDemoLeftPanel")?.addEventListener("click", () => {
    demoCollapseLeftPanel();
  });
  primeMobileSheetAfterPanelHtml(panel);
  mobileSheetSettleAfterRender(panel, document.getElementById("demoMapLayout"));
}

function clearAreaFilter() {
  stopAreaDrawing();
  state.areaPolygonCoords = null;
  if (state.mapInstance && state.areaPolygonObject) {
    state.mapInstance.geoObjects.remove(state.areaPolygonObject);
  }
  state.areaPolygonObject = null;
  const isDemo = Boolean(document.getElementById("demoMapLayout"));
  const panel = isDemo ? document.getElementById("demoLeftPanel") : document.getElementById("leftPanel");
  if (panel) {
    if (isDemo) {
      setDemoDefaultLeftPanel();
    } else {
      setMapDefaultLeftPanel();
    }
  }
  if (state.mapInstance && (document.getElementById("map") || document.getElementById("demoMap"))) {
    reinitActiveMap();
  }
}

function stopAreaDrawing() {
  if (state.areaDrawCanvas && state.areaDrawHandlers) {
    state.areaDrawCanvas.removeEventListener("pointerdown", state.areaDrawHandlers.onPointerDown);
    state.areaDrawCanvas.removeEventListener("pointermove", state.areaDrawHandlers.onPointerMove);
    state.areaDrawCanvas.removeEventListener("pointerup", state.areaDrawHandlers.onPointerUp);
    state.areaDrawCanvas.removeEventListener("pointercancel", state.areaDrawHandlers.onPointerUp);
  }
  state.areaDrawHandlers = null;
  state.areaDrawCanvas = null;
  state.areaDrawInProgress = false;
  state.areaDrawCoords = [];
  state.areaDrawMode = false;
  if (state.mapInstance) {
    state.mapInstance.behaviors.enable("drag");
    state.mapInstance.behaviors.enable("scrollZoom");
    state.mapInstance.behaviors.enable("dblClickZoom");
  }
  syncDrawButtons();
}

function resetDrawCanvas() {
  const canvas = document.getElementById("mapDrawCanvas");
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
}

function drawPathOnCanvas(points) {
  const canvas = document.getElementById("mapDrawCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (points.length < 2) return;
  ctx.strokeStyle = "#1760ff";
  ctx.fillStyle = "rgba(23,96,255,0.16)";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.stroke();
}

function canvasPointToGeo(canvasPoint) {
  const canvas = document.getElementById("mapDrawCanvas");
  if (!canvas || !state.mapInstance) return null;
  const rect = canvas.getBoundingClientRect();
  const pagePoint = [rect.left + canvasPoint[0], rect.top + canvasPoint[1]];
  const globalPixels = state.mapInstance.converter.pageToGlobal(pagePoint);
  const zoom = state.mapInstance.getZoom();
  return state.mapInstance.options.get("projection").fromGlobalPixels(globalPixels, zoom);
}

function startAreaDrawing() {
  ensureMapDrawControls();
  if (!state.mapInstance || !window.ymaps) return;
  if (state.areaDrawMode) {
    stopAreaDrawing();
    return;
  }
  stopAreaDrawing();
  const canvas = document.getElementById("mapDrawCanvas");
  if (!canvas) return;
  if (state.areaPolygonObject) {
    state.mapInstance.geoObjects.remove(state.areaPolygonObject);
    state.areaPolygonObject = null;
  }

  resetDrawCanvas();
  state.areaPolygonCoords = null;
  state.areaDrawCanvas = canvas;
  state.areaDrawMode = true;
  state.mapInstance.behaviors.disable("drag");
  state.mapInstance.behaviors.disable("scrollZoom");
  state.mapInstance.behaviors.disable("dblClickZoom");
  syncDrawButtons();

  const onPointerDown = (event) => {
    if (!state.areaDrawMode) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    state.areaDrawInProgress = true;
    state.areaDrawCoords = [[event.offsetX, event.offsetY]];
    drawPathOnCanvas(state.areaDrawCoords);
  };

  const onPointerMove = (event) => {
    if (!state.areaDrawMode || !state.areaDrawInProgress) return;
    event.preventDefault();
    const coords = [event.offsetX, event.offsetY];
    const prev = state.areaDrawCoords[state.areaDrawCoords.length - 1];
    if (!prev) return;
    const distance = Math.abs(coords[0] - prev[0]) + Math.abs(coords[1] - prev[1]);
    if (distance < 2) return;
    state.areaDrawCoords.push(coords);
    drawPathOnCanvas(state.areaDrawCoords);
  };

  const onPointerUp = (event) => {
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (!state.areaDrawMode || !state.areaDrawInProgress) return;
    state.areaDrawInProgress = false;
    if (state.areaDrawCoords.length < 3) {
      clearAreaFilter();
      return;
    }
    const closedPoints = state.areaDrawCoords.slice();
    const first = closedPoints[0];
    const last = closedPoints[closedPoints.length - 1];
    if (Math.abs(first[0] - last[0]) + Math.abs(first[1] - last[1]) > 1) {
      closedPoints.push(first);
    }
    const polygonGeo = closedPoints.map(canvasPointToGeo).filter(Boolean);
    if (polygonGeo.length < 3) {
      clearAreaFilter();
      return;
    }
    state.areaPolygonCoords = [polygonGeo];
    resetDrawCanvas();
    stopAreaDrawing();
    reinitActiveMap();
  };

  state.areaDrawHandlers = { onPointerDown, onPointerMove, onPointerUp };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
}

function filterPropertiesByState(list) {
  const rawMin = toRawNumberString(state.filters.minPrice);
  const rawMax = toRawNumberString(state.filters.maxPrice);
  const minP = rawMin ? Number(rawMin) : 0;
  const maxP = rawMax ? Number(rawMax) : Number.MAX_SAFE_INTEGER;
  const floorMin = Number(toRawNumberString(state.filters.floorMin) || 0);
  const floorMaxRaw = toRawNumberString(state.filters.floorMax);
  const floorMax = floorMaxRaw ? Number(floorMaxRaw) : Number.MAX_SAFE_INTEGER;
  const totalFloorsMin = Number(toRawNumberString(state.filters.totalFloorsMin) || 0);
  const totalFloorsMaxRaw = toRawNumberString(state.filters.totalFloorsMax);
  const totalFloorsMax = totalFloorsMaxRaw ? Number(totalFloorsMaxRaw) : Number.MAX_SAFE_INTEGER;
  const ceilingHeightMin = Number(normalizeDecimalInput(String(state.filters.ceilingHeightMin || "").replace(",", ".")) || 0);
  const partnerPctMin = Number(normalizeDecimalInput(state.filters.partnerCommissionMinPct || ""));
  const partnerRubMinRaw = toRawNumberString(state.filters.partnerCommissionMinRub || "");
  const partnerRubMin = partnerRubMinRaw ? Number(partnerRubMinRaw) : 0;
  const areaMinRaw = normalizeDecimalInput(String(state.filters.minArea || "").replace(",", "."));
  const areaMaxRaw = normalizeDecimalInput(String(state.filters.maxArea || "").replace(",", "."));
  const areaMin = areaMinRaw ? Number(areaMinRaw) : 0;
  const areaMax = areaMaxRaw ? Number(areaMaxRaw) : Number.POSITIVE_INFINITY;
  const metroMaxRaw = toRawNumberString(state.filters.metroWalkMax || "");
  const metroWalkMax = metroMaxRaw ? Number(metroMaxRaw) : 0;
  const pubFrom = String(state.filters.publishedFrom || "").trim();
  const pubFromMs = pubFrom ? Date.parse(`${pubFrom}T00:00:00`) : null;
  return list.filter((item) => {
    const price = Number(item.price || 0);
    if (price < minP || price > maxP) return false;
    const area = Number(item.area || 0);
    if (areaMinRaw && (Number.isNaN(area) || area < areaMin)) return false;
    if (areaMaxRaw && (Number.isNaN(area) || area > areaMax)) return false;
    if (state.filters.housingStatus) {
      const hs = item.housingStatus || "flat";
      if (hs !== state.filters.housingStatus) return false;
    }
    if (pubFromMs != null && !Number.isNaN(pubFromMs)) {
      if (publishedAtTimeMs(item) < pubFromMs) return false;
    }
    if (metroWalkMax > 0) {
      const m = item.metroWalkMinutes;
      if (m != null && Number.isFinite(Number(m)) && Number(m) > metroWalkMax) return false;
    }
    const brF = state.filters.bedrooms;
    if (brF) {
      const n = Number(item.bedrooms || 0);
      if (brF === "4") {
        if (n < 4) return false;
      } else if (String(n) !== brF) return false;
    }
    const floor = Number(item.floor || 0);
    const totalFloors = Number(item.totalFloors || 0);
    const ceilingHeight = Number(item.ceilingHeight || 0);
    const byFloor = floor >= floorMin && floor <= floorMax;
    const byTotalFloors = totalFloors >= totalFloorsMin && totalFloors <= totalFloorsMax;
    const byCeiling = ceilingHeight >= ceilingHeightMin;
    const byFinishing = state.filters.finishing ? item.finishing === state.filters.finishing : true;
    const byReadiness = state.filters.readiness ? item.readiness === state.filters.readiness : true;
    const cp = Number(item.commissionPartner || 0);
    if (partnerPctMin > 0 && cp < partnerPctMin) return false;
    if (partnerRubMin > 0) {
      const partnerRub = (price * cp) / 100;
      if (partnerRub < partnerRubMin) return false;
    }
    return byFloor && byTotalFloors && byCeiling && byFinishing && byReadiness;
  });
}

async function loadMapData() {
  const query = new URLSearchParams();
  if (state.filters.minPrice) query.append("minPrice", toRawNumberString(state.filters.minPrice));
  if (state.filters.maxPrice) query.append("maxPrice", toRawNumberString(state.filters.maxPrice));
  if (state.filters.bedrooms) query.append("bedrooms", state.filters.bedrooms);
  const partnerPctMin = Number(normalizeDecimalInput(state.filters.partnerCommissionMinPct || ""));
  if (partnerPctMin > 0) query.append("partnerCommissionMin", String(partnerPctMin));
  const list = await api(`/api/properties?${query.toString()}`);
  state.properties = filterPropertiesByState(list);
  state.mapViewportListSig = "";
  state.mapAreaListSig = "";
  initMap();
}

function normalizeAddressKey(address) {
  return String(address || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .trim();
}

/** Макс. расстояние между точками (м), чтобы считать объекты одним зданием — одна метка, цифра только при 2+. */
const SAME_BUILDING_MAX_METERS = 38;

function groupByProximity(list) {
  const valid = list.filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)));
  if (!valid.length) return [];
  const n = valid.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i) {
    return parent[i] === i ? i : (parent[i] = find(parent[i]));
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (haversineMeters(valid[i].lat, valid[i].lon, valid[j].lat, valid[j].lon) <= SAME_BUILDING_MAX_METERS) {
        union(i, j);
      }
    }
  }
  const clusters = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(valid[i]);
  }
  return Array.from(clusters.values());
}

function groupByHouse(list) {
  return groupByProximity(list);
}

function groupCentroid(group) {
  if (!group.length) return [0, 0];
  let slat = 0;
  let slon = 0;
  for (const p of group) {
    slat += Number(p.lat);
    slon += Number(p.lon);
  }
  return [slat / group.length, slon / group.length];
}

/**
 * После выбора метки: без fitToViewport; на моб. — нижний лист в margin, объект в верхней зоне карты между топбаром и лентой.
 */
function focusMapOnPlacemark(lat, lon, panelId = "leftPanel") {
  const map = state.mapInstance;
  if (!map || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const isMobile = window.matchMedia("(max-width: 900px)").matches;
  const targetZoom = Math.max(map.getZoom(), 17);

  if (!isMobile) {
    map.setCenter([lat, lon], targetZoom, { duration: 320, checkZoomRange: true });
    return;
  }

  const mapEl =
    typeof map.container?.getElement === "function" ? map.container.getElement() : document.getElementById("map") || document.getElementById("demoMap");
  if (!mapEl) return;
  const mr = mapEl.getBoundingClientRect();

  let marginTop = Math.max(56, Math.round(mr.height * 0.08));
  let marginBottom = Math.round(mr.height * 0.42);
  const topbar =
    panelId === "demoLeftPanel"
      ? document.querySelector(".demo-page .demo-top-strip") || document.querySelector(".demo-page .topbar")
      : document.querySelector(".map-page .topbar");
  if (topbar) {
    marginTop = Math.max(48, Math.round(topbar.getBoundingClientRect().bottom - mr.top + 8));
  }
  const panel = document.getElementById(panelId);
  if (panel) {
    const track = panel.querySelector("[data-sheet-track]");
    if (track) {
      const tr = track.getBoundingClientRect();
      marginBottom = Math.min(Math.round(mr.height - marginTop - 32), Math.max(marginBottom, Math.round(mr.bottom - tr.top + 24)));
    }
  }

  marginTop = Math.max(40, Math.min(marginTop, Math.round(mr.height * 0.42)));
  marginBottom = Math.max(80, Math.min(marginBottom, Math.round(mr.height - marginTop - 48)));

  const spanLat = 0.00085;
  const spanLon = 0.0011;
  const bounds = [
    [lat - spanLat / 2, lon - spanLon / 2],
    [lat + spanLat / 2, lon + spanLon / 2]
  ];
  map.setBounds(bounds, {
    checkZoomRange: true,
    duration: 360,
    zoomMargin: [marginTop, 20, marginBottom, 20],
    preciseZoom: true
  });
}

function showGroup(properties) {
  state.mapViewportListSig = "";
  state.mapAreaListSig = "";
  state.panelCollapsed = false;
  document.getElementById("mapLayout")?.classList.remove("collapsed");
  const panel = document.getElementById("leftPanel");
  if (!panel) return;
  state.mapLeftPanelMode = "group";
  state.panelSheetT = null;
  if (window.matchMedia("(max-width: 900px)").matches) {
    state.panelSheetInitialized = false;
  }
  properties.sort((a, b) => b.commissionPartner - a.commissionPartner);
  const bodyHtml = `${properties.map(cardMarkup).join("")}${sheetObjectsListFooterHtml()}`;
  const [focusLat, focusLon] = groupCentroid(properties);
  panel.innerHTML = leftPanelMobileBlock(
    "mapLeftPanelHandleArea",
    `<div class="left-panel-head"><h3>Объектов в точке: ${properties.length}</h3><button class="close-left-panel" id="closeLeftPanel" aria-label="Свернуть панель">×</button></div>`,
    bodyHtml
  );
  document.getElementById("closeLeftPanel")?.addEventListener("click", () => {
    mapCollapseLeftPanel();
  });
  primeMobileSheetAfterPanelHtml(panel);
  updateMapOpenPanelButton();
  mobileSheetSettleAfterRender(panel, document.getElementById("mapLayout"), true);
  ensureMapDrawControls();
  panel.querySelectorAll(".open-object").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#/property/${btn.dataset.id}`;
    });
  });
  bindSheetReflowOnImages(panel, "mapLayout");
  scheduleMobileSheetReflow(panel, document.getElementById("mapLayout"));
  requestAnimationFrame(() => {
    requestAnimationFrame(() => focusMapOnPlacemark(focusLat, focusLon, "leftPanel"));
  });
}

function initMap() {
  const ensureMap = () => {
    if (state.mapInstance) {
      state.mapView = {
        center: state.mapInstance.getCenter(),
        zoom: state.mapInstance.getZoom()
      };
    }
    const grouped = groupByHouse(getAreaFilteredProperties());
    if (state.mapInstance) {
      state.mapInstance.destroy();
      state.mapInstance = null;
      state.mapLeftPanelMode = null;
    }

    const map = new ymaps.Map("map", {
      center: state.mapView?.center || MOSCOW_DEFAULT_CENTER,
      zoom: state.mapView?.zoom ?? MOSCOW_DEFAULT_ZOOM,
      controls: ["zoomControl"]
    });
    state.mapInstance = map;
    map.events.add("boundschange", () => {
      state.mapView = {
        center: map.getCenter(),
        zoom: map.getZoom()
      };
      if (state.areaDrawMode) return;
      if (state.viewportUpdateTimer) {
        clearTimeout(state.viewportUpdateTimer);
      }
      state.viewportUpdateTimer = setTimeout(() => {
        const p = document.getElementById("leftPanel");
        if (getSheetNode(p)?.classList.contains("left-panel--sheet-live")) return;
        if (state.mapLeftPanelMode === "group") {
          state.mapLeftPanelMode = null;
          state.mapViewportListSig = "";
        }
        if (state.areaPolygonCoords?.length) {
          renderAreaSelectionPanel(getAreaFilteredProperties());
        } else {
          renderViewportPanel();
        }
      }, 420);
    });

    grouped.forEach((group) => {
      const sorted = group.slice().sort((a, b) => b.commissionPartner - a.commissionPartner);
      const top = sorted[0];
      const [plat, plon] = groupCentroid(group);
      const multi = group.length >= 2;
      const premium = top.commissionPartner >= 4;
      const placemark = new ymaps.Placemark(
        [plat, plon],
        multi
          ? {
              balloonContent: `${group.length} объект(а)`,
              hintContent: `${group.length} объекта по адресу / в одном здании`,
              iconContent: String(group.length)
            }
          : { hintContent: String(top.address || top.title || "").slice(0, 120) },
        {
          preset: multi
            ? premium
              ? "islands#orangeCircleIcon"
              : "islands#blueCircleIcon"
            : premium
              ? "islands#orangeIcon"
              : "islands#blueIcon"
        }
      );
      placemark.events.add("click", () => showGroup(group));
      map.geoObjects.add(placemark);
    });

    if (state.areaPolygonCoords?.length) {
      const polygon = new ymaps.Polygon(
        state.areaPolygonCoords,
        {},
        {
          fillColor: "rgba(23,96,255,0.15)",
          strokeColor: "#1760ff",
          strokeWidth: 2
        }
      );
      map.geoObjects.add(polygon);
      state.areaPolygonObject = polygon;
      resetMobileSheetForMapReady();
      state.mapAreaListSig = "";
      renderAreaSelectionPanel(getAreaFilteredProperties());
    } else {
      state.areaPolygonObject = null;
      resetMobileSheetForMapReady();
      state.mapViewportListSig = "";
      renderViewportPanel();
    }
    refreshMapViewport();
    {
      const lp = document.getElementById("leftPanel");
      const ml = document.getElementById("mapLayout");
      if (lp && ml) {
        scheduleMobileSheetReflow(lp, ml, { resetLandingOnce: true });
      }
    }
    ensureMapDrawControls();
  };

  if (window.ymaps) {
    ymaps.ready(ensureMap);
  }
}

function reinitActiveMap() {
  if (document.getElementById("demoMap")) {
    initDemoMap();
  } else {
    initMap();
  }
}

function initDemoMap() {
  const ensureMap = () => {
    if (state.mapInstance) {
      state.mapView = {
        center: state.mapInstance.getCenter(),
        zoom: state.mapInstance.getZoom()
      };
    }
    const grouped = groupByHouse(getAreaFilteredProperties());
    if (state.mapInstance) {
      state.mapInstance.destroy();
      state.mapInstance = null;
      state.demoLeftPanelMode = null;
    }

    const map = new ymaps.Map("demoMap", {
      center: state.mapView?.center || MOSCOW_DEFAULT_CENTER,
      zoom: state.mapView?.zoom ?? MOSCOW_DEFAULT_ZOOM,
      controls: ["zoomControl"]
    });
    state.mapInstance = map;
    map.events.add("boundschange", () => {
      state.mapView = {
        center: map.getCenter(),
        zoom: map.getZoom()
      };
      if (state.areaDrawMode) return;
      if (state.viewportUpdateTimer) {
        clearTimeout(state.viewportUpdateTimer);
      }
      state.viewportUpdateTimer = setTimeout(() => {
        const p = document.getElementById("demoLeftPanel");
        if (getSheetNode(p)?.classList.contains("left-panel--sheet-live")) return;
        if (state.demoLeftPanelMode === "group") {
          state.demoLeftPanelMode = null;
          state.demoViewportListSig = "";
        }
        if (state.areaPolygonCoords?.length) {
          renderDemoAreaSelectionPanel();
        } else {
          renderDemoViewportPanel();
        }
      }, 420);
    });

    grouped.forEach((group) => {
      const sorted = group.slice().sort((a, b) => b.commissionPartner - a.commissionPartner);
      const top = sorted[0];
      const [plat, plon] = groupCentroid(group);
      const multi = group.length >= 2;
      const premium = top.commissionPartner >= 4;
      const placemark = new ymaps.Placemark(
        [plat, plon],
        multi
          ? {
              balloonContent: `${group.length} объект(а)`,
              hintContent: `${group.length} объекта по адресу / в одном здании`,
              iconContent: String(group.length)
            }
          : { hintContent: String(top.address || top.title || "").slice(0, 120) },
        {
          preset: multi
            ? premium
              ? "islands#orangeCircleIcon"
              : "islands#blueCircleIcon"
            : premium
              ? "islands#orangeIcon"
              : "islands#blueIcon"
        }
      );
      placemark.events.add("click", () => showDemoGroup(group));
      map.geoObjects.add(placemark);
    });

    if (state.areaPolygonCoords?.length) {
      const polygon = new ymaps.Polygon(
        state.areaPolygonCoords,
        {},
        {
          fillColor: "rgba(23,96,255,0.15)",
          strokeColor: "#1760ff",
          strokeWidth: 2
        }
      );
      map.geoObjects.add(polygon);
      state.areaPolygonObject = polygon;
      resetMobileSheetForMapReady();
      state.demoAreaListSig = "";
      renderDemoAreaSelectionPanel();
    } else {
      state.areaPolygonObject = null;
      resetMobileSheetForMapReady();
      state.demoViewportListSig = "";
      renderDemoViewportPanel();
    }
    refreshMapViewport();
    {
      const lp = document.getElementById("demoLeftPanel");
      const ml = document.getElementById("demoMapLayout");
      if (lp && ml) {
        scheduleMobileSheetReflow(lp, ml, { resetLandingOnce: true });
      }
    }
    ensureMapDrawControls();
  };

  if (window.ymaps) {
    ymaps.ready(ensureMap);
  }
}

function refreshMapViewport() {
  if (!state.mapInstance) return;
  setTimeout(() => state.mapInstance.container.fitToViewport(), 0);
  setTimeout(() => state.mapInstance.container.fitToViewport(), 120);
}

async function renderPropertyPage(id) {
  setMapBodyClass(false);
  if (!state.token) {
    renderAuthPage();
    return;
  }
  const property = await api(`/api/properties/${id}`);
  const galleryPhotos = (property.photos || []).length
    ? property.photos
    : [PLACEHOLDER_IMAGE_URL];
  const metroLine = propertyMetroLabel(property);
  app.innerHTML = `
    ${topbar({ hideFilters: window.matchMedia("(max-width: 900px)").matches })}
    <section class="page">
      <p><button class="btn" id="goBack">← На карту</button></p>
      <div class="grid-2">
        <div class="panel">
          <h2>${property.title || "Объект"}</h2>
          <div class="gallery">
            ${galleryPhotos
              .map(
                (photo, index) =>
                  `<img class="gallery__img" ${imgLazyAttrs({ priority: index === 0 ? "high" : undefined })} src="${photoUrlWithFallback(photo, { gallery: true })}" onerror="${photoOnErrorAttr()}" alt="Фото объекта" data-gallery-index="${index}" />`
              )
              .join("")}
          </div>
          <p>${property.description || ""}</p>
        </div>
        <aside class="panel">
          <h3>${money(property.price)} ₽</h3>
          <p><strong>Адрес:</strong> ${property.address}</p>
          ${metroLine ? `<p><strong>Метро:</strong> ${escapeHtml(metroLine)}</p>` : ""}
          ${
            property.metroWalkMinutes != null && Number.isFinite(Number(property.metroWalkMinutes))
              ? `<p><strong>Пешком до метро:</strong> ${Number(property.metroWalkMinutes)} мин</p>`
              : ""
          }
          <p><strong>Статус жилья:</strong> ${housingStatusLabel(property.housingStatus)}</p>
          <p><strong>Дата публикации:</strong> ${escapeHtml(formatPublishedDateRu(property.publishedAt || property.createdAt))}</p>
          <p><strong>Площадь:</strong> ${property.area} м²</p>
          <p><strong>Этаж:</strong> ${property.floor || "-"}</p>
          <p><strong>Этажность:</strong> ${property.totalFloors || "-"}</p>
          <p><strong>Высота потолков:</strong> ${property.ceilingHeight ? `${property.ceilingHeight} м` : "-"}</p>
          <p><strong>Отделка:</strong> ${finishingLabel(property.finishing)}</p>
          <p><strong>Готовность дома:</strong> ${readinessLabel(property.readiness)}</p>
          <p><strong>Спален:</strong> ${property.bedrooms}</p>
          <p><strong>Комиссия:</strong> ${property.commissionTotal}%</p>
          <p><strong>Партнеру:</strong> ${property.commissionPartner}%</p>
          ${
            property.pdfUrl
              ? `<p>
                  <a href="${property.pdfUrl}?v=${encodeURIComponent(property.id || "")}-${Date.now()}" class="btn" id="downloadPdfBtn" download>Скачать презентацию PDF</a>
                  <button class="btn" id="sharePdfBtn" type="button">Отправить клиенту</button>
                </p>`
              : `<p><button class="btn" id="generatePdfBtn">Сгенерировать презентацию PDF</button></p>`
          }
          <hr />
          <p><strong>Телефон:</strong> ${property.contacts.phone || "-"}</p>
          <p><strong>Telegram:</strong> ${property.contacts.telegram || "-"}</p>
          <p>
            <a class="btn primary contact-call-btn" href="tel:${escapeHtml(normalizePhoneForTel(property.contacts.phone))}">
              Связаться с брокером
            </a>
          </p>
        </aside>
      </div>
    </section>
    ${mobileBottomNavHtml("search")}
    <div class="gallery-lightbox" id="galleryLightbox">
      <button class="gallery-lightbox-close" id="galleryCloseBtn" aria-label="Закрыть">×</button>
      <button class="gallery-lightbox-nav" id="galleryPrevBtn" aria-label="Предыдущее фото">‹</button>
      <img id="galleryLightboxImage" class="gallery-lightbox-image" ${imgLazyAttrs({ priority: "high" })} src="${photoUrlWithFallback(galleryPhotos[0], { gallery: true })}" alt="Фото объекта" />
      <button class="gallery-lightbox-nav" id="galleryNextBtn" aria-label="Следующее фото">›</button>
      <div class="gallery-lightbox-counter" id="galleryCounter">1 / ${galleryPhotos.length}</div>
    </div>
  `;
  bindBrandHomeButton();
  document.getElementById("goBack").addEventListener("click", () => {
    location.hash = "#/";
  });
  document.getElementById("generatePdfBtn")?.addEventListener("click", async () => {
    const button = document.getElementById("generatePdfBtn");
    if (!button) return;
    button.disabled = true;
    button.textContent = "Генерация...";
    try {
      await api(`/api/my/properties/${id}/generate-pdf`, { method: "POST" });
      await renderPropertyPage(id);
    } catch (_error) {
      button.disabled = false;
      button.textContent = "Сгенерировать презентацию PDF";
    }
  });
  document.getElementById("downloadPdfBtn")?.addEventListener("click", async (event) => {
    event.preventDefault();
    const link = document.getElementById("downloadPdfBtn");
    if (!link) return;
    const originalText = link.textContent;
    link.textContent = "Скачивание...";
    link.style.pointerEvents = "none";
    try {
      const latest = await api(`/api/properties/${id}`);
      const blob = await fetchPropertyPresentationBlob(latest, id);
      downloadBlobAsFile(blob, `presentation-${id}.pdf`);
      await renderPropertyPage(id);
    } catch (error) {
      alert(error?.message || "Не удалось скачать PDF");
    } finally {
      link.textContent = originalText || "Скачать презентацию PDF";
      link.style.pointerEvents = "";
    }
  });
  document.getElementById("sharePdfBtn")?.addEventListener("click", async () => {
    const shareBtn = document.getElementById("sharePdfBtn");
    if (!shareBtn) return;
    const originalText = shareBtn.textContent;
    shareBtn.disabled = true;
    shareBtn.textContent = "Подготовка...";
    try {
      const latest = await api(`/api/properties/${id}`);
      const blob = await fetchPropertyPresentationBlob(latest, id);
      const file = new File([blob], `presentation-${id}.pdf`, { type: "application/pdf" });
      if (navigator.share) {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: "Презентация объекта",
            text: "Отправляю PDF презентацию объекта",
            files: [file]
          });
        } else {
          const blobUrl = URL.createObjectURL(blob);
          try {
            await navigator.share({
              title: "Презентация объекта",
              text: "Отправляю PDF презентацию объекта",
              url: blobUrl
            });
          } finally {
            URL.revokeObjectURL(blobUrl);
          }
        }
      } else {
        downloadBlobAsFile(blob, `presentation-${id}.pdf`);
      }
      await renderPropertyPage(id);
    } catch (error) {
      const aborted =
        error?.name === "AbortError" ||
        (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") ||
        /abort|cancel|отмен/i.test(String(error?.message || ""));
      if (!aborted) {
        alert(error?.message || "Не удалось подготовить PDF");
      }
    } finally {
      shareBtn.disabled = false;
      shareBtn.textContent = originalText || "Отправить клиенту";
    }
  });
  document.getElementById("addObjectBtn")?.addEventListener("click", () => {
    location.hash = state.user ? "#/cabinet/add" : "#/auth";
  });
  document.getElementById("cabinetBtn")?.addEventListener("click", () => (location.hash = "#/cabinet"));
  document.getElementById("adminBtn")?.addEventListener("click", () => (location.hash = "#/admin"));
  document.getElementById("agencyBtn")?.addEventListener("click", () => (location.hash = "#/agency"));
  bindMobileBottomNavActions();
  updateMobileNavMetrics();

  let currentGalleryIndex = 0;
  const lightbox = document.getElementById("galleryLightbox");
  const lightboxImage = document.getElementById("galleryLightboxImage");
  const galleryCounter = document.getElementById("galleryCounter");
  const updateLightbox = () => {
    lightboxImage.src = optimizePhotoSrc(galleryPhotos[currentGalleryIndex] || PLACEHOLDER_IMAGE_URL, "gallery");
    galleryCounter.textContent = `${currentGalleryIndex + 1} / ${galleryPhotos.length}`;
  };
  const openLightbox = (index) => {
    currentGalleryIndex = index;
    updateLightbox();
    lightbox.classList.add("open");
  };
  const closeLightbox = () => {
    lightbox.classList.remove("open");
  };
  const showPrev = () => {
    currentGalleryIndex = (currentGalleryIndex - 1 + galleryPhotos.length) % galleryPhotos.length;
    updateLightbox();
  };
  const showNext = () => {
    currentGalleryIndex = (currentGalleryIndex + 1) % galleryPhotos.length;
    updateLightbox();
  };

  app.querySelectorAll(".gallery img").forEach((img) => {
    img.addEventListener("click", () => {
      openLightbox(Number(img.dataset.galleryIndex || 0));
    });
  });
  document.getElementById("galleryCloseBtn").addEventListener("click", closeLightbox);
  document.getElementById("galleryPrevBtn").addEventListener("click", showPrev);
  document.getElementById("galleryNextBtn").addEventListener("click", showNext);
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) closeLightbox();
  });
}

function authFormsInnerHtml() {
  return `
      <div class="login-wrapper">
        <div class="login-box">
          <h3>Вход</h3>
          <p class="auth-notice" id="authNotice"></p>
          <label class="field-label" for="loginEmail">Логин (email)</label>
          <input id="loginEmail" placeholder="Email" type="email" autocomplete="username email" />
          <label class="field-label" for="loginPassword">Пароль</label>
          <input id="loginPassword" type="password" placeholder="Пароль" autocomplete="current-password" />
          <button class="btn primary full" id="login">Войти</button>
          <button class="btn full" type="button" id="toDemoMapBtn">К демо без входа</button>
          <button class="btn full" id="openRegister">Регистрация</button>
          <button class="btn full" id="openReset">Забыли пароль?</button>
          <p class="muted" id="authStatus"></p>
        </div>
      </div>
      <div class="contact-us-card">
        <h4>Связаться с нами</h4>
        <p class="muted">По предложениям и вопросам пишите на почту:</p>
        <p><a class="btn" href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
      </div>

      <div class="auth-modal" id="registerModal">
        <div class="auth-modal-content auth-modal-content--register">
          <div class="panel-head">
            <h3 id="registerModalTitle">Регистрация</h3>
            <button class="close-panel-action" id="closeRegisterXBtn" type="button" aria-label="Закрыть">×</button>
          </div>
          <div id="registerFormWrap">
            <label class="field-label" for="accountType">Тип аккаунта</label>
            <select id="accountType">
              <option value="broker">Частный брокер</option>
              <option value="agency_owner">Агентство</option>
            </select>
            <input id="lastName" placeholder="Фамилия (обязательно)" autocomplete="family-name" />
            <input id="firstName" placeholder="Имя (обязательно)" autocomplete="given-name" />
            <input id="email" placeholder="Email (обязательно)" type="email" autocomplete="email" />
            <div class="phone-group">
              <span>+7</span>
              <input id="phone" placeholder="9991234567" maxlength="10" inputmode="numeric" autocomplete="tel-national" />
            </div>
            <input id="password" placeholder="Пароль (мин 6)" type="password" autocomplete="new-password" />
            <label class="field-label" for="agency" id="agencyFieldLabel">ФИО ИП/самозанятого (обязательно)</label>
            <input id="agency" placeholder="Название агентства или ФИО ИП/самозанятого" />
            <p class="note">* ИП / юрлица должны иметь соответствующие ОКВЭД для операций с недвижимостью</p>
            <label class="checkbox-line">
              <input type="checkbox" id="agree" />
              <span>
                Я соглашаюсь с
                <a href="/privacy.html" target="_blank" rel="noopener noreferrer">обработкой персональных данных</a>
              </span>
            </label>
            <label class="checkbox-line">
              <input type="checkbox" id="marketing" />
              <span>Я согласен получать рекламные сообщения</span>
            </label>
            <p>
              <button class="btn primary full" id="register" type="button">Создать аккаунт</button>
            </p>
          </div>
          <div id="registerDoneWrap" class="auth-result-wrap" hidden>
            <p class="auth-result-text" id="registerDoneText"></p>
            <p><button class="btn primary full" type="button" id="registerDoneClose">Понятно</button></p>
          </div>
        </div>
      </div>

      <div class="auth-modal" id="resetModal">
        <div class="auth-modal-content">
          <div class="panel-head">
            <h3 id="resetModalTitle">Восстановление пароля</h3>
            <button class="close-panel-action" id="closeResetXBtn" type="button" aria-label="Закрыть">×</button>
          </div>
          <div id="resetFormWrap">
            <label class="field-label" for="resetEmail">Email</label>
            <input id="resetEmail" placeholder="Введите email" type="email" />
            <p>
              <button class="btn primary full" id="forgot" type="button">Отправить ссылку</button>
              <button class="btn full" id="closeReset" type="button">Закрыть</button>
            </p>
          </div>
          <div id="resetDoneWrap" class="auth-result-wrap" hidden>
            <p class="auth-result-text" id="resetDoneText"></p>
            <p><button class="btn primary full" type="button" id="resetDoneClose">Понятно</button></p>
          </div>
        </div>
      </div>
  `;
}

function removeAuthDemoOverlay() {
  document.getElementById("authDemoOverlay")?.remove();
}

function dismissDemoAuthOverlay() {
  document.getElementById("registerModal")?.classList.remove("active");
  document.getElementById("resetModal")?.classList.remove("active");
  document.body.classList.remove("auth-modal-open");
  removeAuthDemoOverlay();
  const target = state.authOverlayReturnHash || "#/";
  state.authOverlayReturnHash = null;
  if (location.hash !== target) {
    location.hash = target;
  } else {
    router();
  }
}

/** С демо-карты или карточки демо — открыть вход/регистрацию оверлеем с возвратом по «×». */
function goToAuthFromGuestDemo(nextHash) {
  const cur = location.hash || "#/";
  if (cur === "#/" || cur.startsWith("#/demo/property/")) {
    state.authOverlayReturnHash = cur;
  } else if (!cur.startsWith("#/auth")) {
    state.authOverlayReturnHash = null;
  }
  location.hash = nextHash;
}

function renderDemoAuthOverlay(initialHash) {
  removeAuthDemoOverlay();
  const shell = document.createElement("div");
  shell.id = "authDemoOverlay";
  shell.className = "auth-demo-overlay";
  shell.innerHTML = `
    <div class="auth-demo-overlay__backdrop" data-auth-overlay-dismiss role="presentation"></div>
    <div class="auth-demo-overlay__panel login-page login-page--overlay">
      <button type="button" class="auth-demo-overlay__x" id="authDemoOverlayClose" aria-label="Закрыть">×</button>
      ${authFormsInnerHtml()}
    </div>
  `;
  document.body.appendChild(shell);
  attachAuthDomListeners(true);
  if (initialHash === "#/auth-register") {
    requestAnimationFrame(() => document.getElementById("openRegister")?.click());
  }
}

function renderAuthPage() {
  removeAuthDemoOverlay();
  state.authOverlayReturnHash = null;
  setMapBodyClass(false);
  app.innerHTML = `
    <section class="login-page">
      ${authFormsInnerHtml()}
    </section>
    ${mobileBottomNavHtml(state.token ? "cabinet" : "search")}
  `;
  attachAuthDomListeners(false);
}

function attachAuthDomListeners(demoOverlay) {
  const setAuthModalOpen = (open) => {
    document.body.classList.toggle("auth-modal-open", Boolean(open));
  };
  const resetRegisterModalUi = () => {
    document.getElementById("registerFormWrap")?.removeAttribute("hidden");
    document.getElementById("registerDoneWrap")?.setAttribute("hidden", "");
    const title = document.getElementById("registerModalTitle");
    if (title) title.textContent = "Регистрация";
    const btn = document.getElementById("register");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Создать аккаунт";
    }
  };
  const resetPasswordModalUi = () => {
    document.getElementById("resetFormWrap")?.removeAttribute("hidden");
    document.getElementById("resetDoneWrap")?.setAttribute("hidden", "");
    const title = document.getElementById("resetModalTitle");
    if (title) title.textContent = "Восстановление пароля";
    const btn = document.getElementById("forgot");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Отправить ссылку";
    }
  };
  const toDemoEl = document.getElementById("toDemoMapBtn");
  if (toDemoEl) {
    toDemoEl.textContent = state.token ? "На карту" : "К демо без входа";
    toDemoEl.addEventListener("click", () => {
      if (demoOverlay) {
        dismissDemoAuthOverlay();
        return;
      }
      if (
        state.panelCollapsedBeforeCabinet != null ||
        state.panelSheetTBeforeCabinet != null
      ) {
        state.panelCollapsed = Boolean(state.panelCollapsedBeforeCabinet);
        state.panelSheetT = state.panelSheetTBeforeCabinet;
        state.panelCollapsedBeforeCabinet = null;
        state.panelSheetTBeforeCabinet = null;
      }
      location.hash = "#/";
    });
  }
  document.getElementById("openRegister").addEventListener("click", () => {
    resetRegisterModalUi();
    document.getElementById("registerModal").classList.add("active");
    setAuthModalOpen(true);
  });
  document.getElementById("closeRegisterXBtn")?.addEventListener("click", () => {
    if (demoOverlay) {
      dismissDemoAuthOverlay();
      return;
    }
    document.getElementById("registerModal").classList.remove("active");
    setAuthModalOpen(false);
    resetRegisterModalUi();
  });
  document.getElementById("openReset").addEventListener("click", () => {
    resetPasswordModalUi();
    document.getElementById("resetModal").classList.add("active");
    setAuthModalOpen(true);
  });
  document.getElementById("closeReset").addEventListener("click", () => {
    document.getElementById("resetModal").classList.remove("active");
    setAuthModalOpen(false);
    resetPasswordModalUi();
  });
  document.getElementById("closeResetXBtn")?.addEventListener("click", () => {
    document.getElementById("resetModal").classList.remove("active");
    setAuthModalOpen(false);
    resetPasswordModalUi();
  });
  document.getElementById("registerModal")?.addEventListener("click", (event) => {
    if (event.target?.id !== "registerModal") return;
    if (demoOverlay) {
      dismissDemoAuthOverlay();
      return;
    }
    document.getElementById("registerModal")?.classList.remove("active");
    setAuthModalOpen(false);
    resetRegisterModalUi();
  });
  document.getElementById("resetModal")?.addEventListener("click", (event) => {
    if (event.target?.id !== "resetModal") return;
    document.getElementById("resetModal")?.classList.remove("active");
    setAuthModalOpen(false);
    resetPasswordModalUi();
  });
  document.getElementById("registerDoneClose")?.addEventListener("click", () => {
    if (demoOverlay) {
      resetRegisterModalUi();
      dismissDemoAuthOverlay();
      return;
    }
    document.getElementById("registerModal")?.classList.remove("active");
    setAuthModalOpen(false);
    resetRegisterModalUi();
  });
  document.getElementById("resetDoneClose")?.addEventListener("click", () => {
    document.getElementById("resetModal")?.classList.remove("active");
    setAuthModalOpen(false);
    resetPasswordModalUi();
  });
  bindMobileBottomNavActions();
  updateMobileNavMetrics();

  const updateRegisterFormByType = () => {
    const type = document.getElementById("accountType").value;
    const agencyInput = document.getElementById("agency");
    const label = document.getElementById("agencyFieldLabel");
    agencyInput.placeholder =
      type === "agency_owner"
        ? "Название агентства (обязательно)"
        : "ФИО ИП/самозанятого (обязательно)";
    if (label) {
      label.textContent =
        type === "agency_owner"
          ? "Название агентства (обязательно)"
          : "ФИО ИП/самозанятого (обязательно)";
    }
  };
  document.getElementById("accountType").addEventListener("change", updateRegisterFormByType);
  updateRegisterFormByType();

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
  const fieldErrorId = (inputId) => `${inputId}Error`;
  const clearFieldError = (inputEl) => {
    if (!inputEl) return;
    inputEl.classList.remove("input-invalid");
    const err = document.getElementById(fieldErrorId(inputEl.id));
    if (err) err.remove();
  };
  const setFieldError = (inputEl, message) => {
    if (!inputEl) return;
    inputEl.classList.add("input-invalid");
    const errorElementId = fieldErrorId(inputEl.id);
    let err = document.getElementById(errorElementId);
    if (!err) {
      err = document.createElement("p");
      err.id = errorElementId;
      err.className = "field-error-text";
      const anchor = inputEl.closest(".phone-group") || inputEl;
      anchor.insertAdjacentElement("afterend", err);
    }
    err.textContent = message;
  };
  const validateEmailField = (inputEl, requiredMessage = "Введите email") => {
    const value = String(inputEl?.value || "").trim();
    if (!value) {
      setFieldError(inputEl, requiredMessage);
      return false;
    }
    if (!emailRe.test(value)) {
      setFieldError(inputEl, "Некорректный формат email");
      return false;
    }
    clearFieldError(inputEl);
    return true;
  };
  const validateRegisterPhone = () => {
    const phoneEl = document.getElementById("phone");
    const digits = toDigits(phoneEl?.value || "");
    if (digits.length !== 10) {
      setFieldError(phoneEl, "Телефон: 10 цифр после +7");
      return false;
    }
    clearFieldError(phoneEl);
    return true;
  };
  const validatePasswordField = (inputId, minLength = 6) => {
    const passEl = document.getElementById(inputId);
    const value = String(passEl?.value || "");
    if (value.length < minLength) {
      setFieldError(passEl, `Минимум ${minLength} символов`);
      return false;
    }
    clearFieldError(passEl);
    return true;
  };
  const validateNonEmpty = (inputId, message = "Поле обязательно") => {
    const inputEl = document.getElementById(inputId);
    if (!String(inputEl?.value || "").trim()) {
      setFieldError(inputEl, message);
      return false;
    }
    clearFieldError(inputEl);
    return true;
  };

  document.getElementById("email")?.addEventListener("input", () => validateEmailField(document.getElementById("email")));
  document.getElementById("loginEmail")?.addEventListener("input", () => validateEmailField(document.getElementById("loginEmail")));
  document.getElementById("resetEmail")?.addEventListener("input", () => validateEmailField(document.getElementById("resetEmail")));
  document.getElementById("loginPassword")?.addEventListener("input", () =>
    validateNonEmpty("loginPassword", "Введите пароль")
  );
  document.getElementById("phone")?.addEventListener("input", validateRegisterPhone);
  document.getElementById("password")?.addEventListener("input", () => validatePasswordField("password", 6));
  document.getElementById("firstName")?.addEventListener("input", () => validateNonEmpty("firstName", "Введите имя"));
  document.getElementById("lastName")?.addEventListener("input", () => validateNonEmpty("lastName", "Введите фамилию"));
  document.getElementById("agency")?.addEventListener("input", () =>
    validateNonEmpty("agency", "Укажите агентство или ФИО ИП/самозанятого")
  );

  document.getElementById("register").addEventListener("click", async () => {
    const authStatus = document.getElementById("authStatus");
    const authNotice = document.getElementById("authNotice");
    const showAuthNotice = (message) => {
      if (!authNotice) return;
      authNotice.textContent = message || "";
      authNotice.classList.toggle("visible", Boolean(message));
      if (message) {
        authNotice.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    };
    if (authStatus) authStatus.textContent = "";
    showAuthNotice("");
    const registerBtn = document.getElementById("register");
    const originalRegisterLabel = registerBtn?.textContent || "Создать аккаунт";
    if (registerBtn) {
      registerBtn.disabled = true;
      registerBtn.textContent = "Отправка…";
    }
    try {
      const isValid =
        validateEmailField(document.getElementById("email")) &&
        validateRegisterPhone() &&
        validatePasswordField("password", 6) &&
        validateNonEmpty("firstName", "Введите имя") &&
        validateNonEmpty("lastName", "Введите фамилию") &&
        validateNonEmpty("agency", "Укажите агентство или ФИО ИП/самозанятого");
      if (!isValid) {
        throw new Error("Проверьте поля формы: есть некорректные данные");
      }
      const payload = collectAuth();
      if (
        !payload.email ||
        !payload.password ||
        !payload.firstName ||
        !payload.lastName ||
        !payload.agency ||
        !payload.phone
      ) {
        throw new Error("Заполните все обязательные поля");
      }
      if (!/^\+7\d{10}$/.test(payload.phone)) {
        throw new Error("Телефон должен быть в формате +7 и 10 цифр");
      }
      if (payload.password.length < 6) {
        throw new Error("Пароль должен быть не менее 6 символов");
      }
      if (!payload.agree) {
        throw new Error("Нужно согласие на обработку данных");
      }
      const data = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (data.requiresEmailVerification) {
        const doneText = document.getElementById("registerDoneText");
        const title = document.getElementById("registerModalTitle");
        if (title) title.textContent = "Почти готово";
        if (doneText) {
          doneText.textContent =
            data.message ||
            "На вашу почту отправлено письмо для подтверждения email. Откройте письмо, перейдите по ссылке, затем войдите в аккаунт. Если письма нет, проверьте папку «Спам».";
        }
        document.getElementById("registerFormWrap")?.setAttribute("hidden", "");
        document.getElementById("registerDoneWrap")?.removeAttribute("hidden");
        if (registerBtn) {
          registerBtn.disabled = false;
          registerBtn.textContent = originalRegisterLabel;
        }
        return;
      }
      setAuth(data);
      removeAuthDemoOverlay();
      state.authOverlayReturnHash = null;
      location.hash = "#/";
    } catch (error) {
      if (registerBtn) {
        registerBtn.disabled = false;
        registerBtn.textContent = originalRegisterLabel;
      }
      alert(error?.message || "Ошибка регистрации");
    }
  });

  document.getElementById("login").addEventListener("click", async () => {
    try {
      const emailOk = validateEmailField(document.getElementById("loginEmail"), "Введите email для входа");
      const passOk = validateNonEmpty("loginPassword", "Введите пароль");
      if (!emailOk || !passOk) {
        throw new Error("Проверьте email и пароль");
      }
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("loginEmail").value,
          password: document.getElementById("loginPassword").value
        })
      });
      setAuth(data);
      removeAuthDemoOverlay();
      state.authOverlayReturnHash = null;
      location.hash = "#/";
    } catch (error) {
      document.getElementById("authStatus").textContent = error.message;
    }
  });

  const onForgotPassword = async () => {
    const authStatus = document.getElementById("authStatus");
    if (authStatus) authStatus.textContent = "";
    if (!validateEmailField(document.getElementById("resetEmail"), "Введите email для восстановления")) {
      alert("Введите корректный email для восстановления");
      return;
    }
    const forgotBtn = document.getElementById("forgot");
    const originalForgotLabel = forgotBtn?.textContent || "Отправить ссылку";
    if (forgotBtn) {
      forgotBtn.disabled = true;
      forgotBtn.textContent = "Отправка…";
    }
    try {
      const data = await api("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: document.getElementById("resetEmail").value })
      });
      const doneText = document.getElementById("resetDoneText");
      const title = document.getElementById("resetModalTitle");
      if (title) title.textContent = "Проверьте почту";
      if (doneText) {
        doneText.textContent =
          data.message ||
          "Если такой email зарегистрирован, мы отправили письмо со ссылкой для сброса пароля. Если письма нет, проверьте папку «Спам».";
      }
      document.getElementById("resetFormWrap")?.setAttribute("hidden", "");
      document.getElementById("resetDoneWrap")?.removeAttribute("hidden");
    } catch (error) {
      alert(error?.message || "Не удалось отправить письмо");
    } finally {
      if (forgotBtn) {
        forgotBtn.disabled = false;
        forgotBtn.textContent = originalForgotLabel;
      }
    }
  };
  document.getElementById("forgot").addEventListener("click", onForgotPassword);
  if (demoOverlay) {
    document.getElementById("authDemoOverlayClose")?.addEventListener("click", dismissDemoAuthOverlay);
    document
      .querySelector("#authDemoOverlay [data-auth-overlay-dismiss]")
      ?.addEventListener("click", dismissDemoAuthOverlay);
  }
}

function parseAgencyInviteTokenFromHash(hash) {
  const prefix = "#/auth-agency-invite/";
  if (!String(hash || "").startsWith(prefix)) return null;
  try {
    return decodeURIComponent(hash.slice(prefix.length));
  } catch {
    return null;
  }
}

/** Завершение регистрации брокера по ссылке из письма от агентства. */
async function renderAgencyInvitePage(token) {
  removeAuthDemoOverlay();
  state.authOverlayReturnHash = null;
  setMapBodyClass(false);
  let info = null;
  let errMsg = "";
  try {
    info = await api(`/api/auth/agency-invite-info?token=${encodeURIComponent(token)}`);
  } catch (e) {
    errMsg = e.message || "Ссылка недействительна";
  }

  if (errMsg || !info?.email) {
    app.innerHTML = `
    <section class="login-page">
      <div class="login-wrapper">
        <div class="login-box">
          <h3>Приглашение недоступно</h3>
          <p class="muted">${escapeHtml(errMsg || "Запросите у руководителя агентства новое письмо.")}</p>
          <p><button type="button" class="btn full" id="inviteErrToAuth">Перейти ко входу</button></p>
        </div>
      </div>
    </section>
    ${mobileBottomNavHtml("search")}
    `;
    document.getElementById("inviteErrToAuth")?.addEventListener("click", () => {
      location.hash = "#/auth";
    });
    bindMobileBottomNavActions();
    updateMobileNavMetrics();
    return;
  }

  app.innerHTML = `
    <section class="login-page">
      <div class="login-wrapper">
        <div class="login-box">
          <h3>Регистрация по приглашению</h3>
          <p class="muted">Агентство: <strong>${escapeHtml(info.agencyName || "")}</strong></p>
          <p class="muted">Этот email указал руководитель; входить вы будете с ним:</p>
          <p><strong>${escapeHtml(info.email)}</strong></p>
          <label class="field-label" for="inviteFirstName">Имя</label>
          <input id="inviteFirstName" placeholder="Иван" autocomplete="given-name" />
          <label class="field-label" for="inviteLastName">Фамилия</label>
          <input id="inviteLastName" placeholder="Иванов" autocomplete="family-name" />
          <label class="field-label" for="invitePassword">Пароль</label>
          <input id="invitePassword" type="password" placeholder="минимум 6 символов" autocomplete="new-password" />
          <label class="field-label" for="invitePhone">Телефон</label>
          <div class="phone-group">
            <span>+7</span>
            <input id="invitePhone" placeholder="9991234567" maxlength="10" inputmode="numeric" autocomplete="tel-national" />
          </div>
          <label class="checkbox-line">
            <input type="checkbox" id="inviteAgree" />
            <span>
              Я соглашаюсь с
              <a href="/privacy.html" target="_blank" rel="noopener noreferrer">обработкой персональных данных</a>
            </span>
          </label>
          <label class="checkbox-line">
            <input type="checkbox" id="inviteMarketing" />
            <span>Я согласен получать рекламные сообщения</span>
          </label>
          <button class="btn primary full" type="button" id="inviteCompleteBtn">Завершить регистрацию</button>
          <p class="muted" id="inviteStatus"></p>
        </div>
      </div>
    </section>
    ${mobileBottomNavHtml("search")}
  `;
  bindMobileBottomNavActions();
  updateMobileNavMetrics();
  document.getElementById("inviteCompleteBtn")?.addEventListener("click", async () => {
    const status = document.getElementById("inviteStatus");
    if (status) status.textContent = "";
    const firstName = document.getElementById("inviteFirstName")?.value.trim() || "";
    const lastName = document.getElementById("inviteLastName")?.value.trim() || "";
    const password = document.getElementById("invitePassword")?.value || "";
    const phone = `+7${toDigits(document.getElementById("invitePhone")?.value || "")}`;
    const agree = document.getElementById("inviteAgree")?.checked;
    const marketingConsent = document.getElementById("inviteMarketing")?.checked;
    if (!firstName || !lastName) {
      if (status) status.textContent = "Укажите имя и фамилию";
      return;
    }
    if (password.length < 6) {
      if (status) status.textContent = "Пароль не менее 6 символов";
      return;
    }
    if (!/^\+7\d{10}$/.test(phone)) {
      if (status) status.textContent = "Телефон: 10 цифр после +7";
      return;
    }
    if (!agree) {
      if (status) status.textContent = "Нужно согласие на обработку персональных данных";
      return;
    }
    const btn = document.getElementById("inviteCompleteBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Сохранение…";
    }
    try {
      const data = await api("/api/auth/complete-agency-invite", {
        method: "POST",
        body: JSON.stringify({
          token,
          firstName,
          lastName,
          password,
          phone,
          agree: true,
          marketingConsent
        })
      });
      setAuth(data);
      location.hash = "#/map";
    } catch (e) {
      if (status) status.textContent = e.message || "Ошибка";
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Завершить регистрацию";
      }
    }
  });
}

function collectAuth() {
  const phoneDigits = toDigits(document.getElementById("phone").value);
  return {
    accountType: document.getElementById("accountType").value === "agency_owner" ? "agency_owner" : "broker",
    firstName: document.getElementById("firstName").value.trim(),
    lastName: document.getElementById("lastName").value.trim(),
    name: `${document.getElementById("firstName").value.trim()} ${document.getElementById("lastName").value.trim()}`.trim(),
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value,
    phone: `+7${phoneDigits}`,
    agency: document.getElementById("agency").value.trim(),
    inn: "",
    marketingConsent: document.getElementById("marketing").checked,
    agree: document.getElementById("agree").checked
  };
}

function setAuth(data) {
  state.token = data.token;
  state.user = data.user;
  didSyncUserFromServer = true;
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
}

async function logout() {
  didSyncUserFromServer = false;
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    /* ignore */
  }
  state.token = "";
  state.user = null;
  state.authOverlayReturnHash = null;
  removeAuthDemoOverlay();
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

async function renderCabinetProfilePage() {
  setMapBodyClass(false);
  if (!state.token) {
    renderAuthPage();
    return;
  }
  let me = state.user;
  try {
    me = await api("/api/auth/me");
    state.user = me;
    localStorage.setItem("user", JSON.stringify(me));
  } catch {
    /* use state.user */
  }
  const phoneDigits =
    me.phone && String(me.phone).startsWith("+7") && String(me.phone).length >= 12
      ? toDigits(String(me.phone).slice(3))
      : toDigits(String(me.phone || ""));
  const accountLabel = me.isAgencyOwner ? "Владелец агентства" : "Брокер";
  app.innerHTML = `
    ${topbar({ slim: true })}
    <section class="cabinet cabinet--profile">
      <div class="panel">
        <p><button type="button" class="btn" id="profileBackCabinet">← В кабинет</button></p>
        <h2>Редактировать профиль</h2>
        <p class="muted">Тип аккаунта: <strong>${escapeHtml(accountLabel)}</strong></p>
        <p class="profile-email-display muted"><strong>Email:</strong> ${escapeHtml(me.email || "—")}</p>
        <h3>Пароль</h3>
        <p class="muted">Новый пароль задаётся по ссылке из письма на этот адрес.</p>
        <p><button type="button" class="btn" id="profileRequestPasswordEmailBtn">Сменить пароль</button></p>
        <p class="muted" id="profilePasswordEmailStatus"></p>
        <form id="cabinetProfileForm" autocomplete="off">
          <div class="form-grid">
            <div class="field-block">
              <label class="field-label" for="profileFirstName">Имя</label>
              <input id="profileFirstName" required value="${escapeHtml(me.firstName || "")}" autocomplete="given-name" />
            </div>
            <div class="field-block">
              <label class="field-label" for="profileLastName">Фамилия</label>
              <input id="profileLastName" required value="${escapeHtml(me.lastName || "")}" autocomplete="family-name" />
            </div>
            <div class="field-block field-span-2">
              <label class="field-label" for="profilePhone">Телефон</label>
              <div class="phone-group">
                <span>+7</span>
                <input id="profilePhone" maxlength="10" inputmode="numeric" value="${escapeHtml(phoneDigits)}" autocomplete="tel-national" />
              </div>
            </div>
            <div class="field-block field-span-2">
              <label class="field-label" for="profileAgency">Название агентства или ФИО ИП/самозанятого</label>
              <input id="profileAgency" required value="${escapeHtml(me.agency || "")}" />
            </div>
            <div class="field-block field-span-2">
              <label class="field-label" for="profileInn">ИНН (необязательно)</label>
              <input id="profileInn" value="${escapeHtml(me.inn || "")}" />
            </div>
            <div class="field-block">
              <label class="field-label" for="profileTelegram">Telegram</label>
              <input id="profileTelegram" value="${escapeHtml(me.telegram || "")}" placeholder="@nickname" />
            </div>
            <div class="field-block">
              <label class="field-label" for="profileWhatsapp">WhatsApp</label>
              <input id="profileWhatsapp" value="${escapeHtml(me.whatsapp || "")}" />
            </div>
            <div class="field-block">
              <label class="field-label" for="profileVk">ВКонтакте</label>
              <input id="profileVk" value="${escapeHtml(me.vk || "")}" />
            </div>
            <div class="field-block">
              <label class="field-label" for="profileMax">MAX</label>
              <input id="profileMax" value="${escapeHtml(me.max || "")}" />
            </div>
            <div class="field-block field-span-2">
              <label class="checkbox-line">
                <input type="checkbox" id="profileMarketing" ${me.marketingConsent ? "checked" : ""} />
                <span>Я согласен получать рекламные сообщения</span>
              </label>
            </div>
          </div>
          <p><button type="submit" class="btn primary" id="profileSaveBtn">Сохранить данные</button></p>
          <p class="muted" id="profileFormStatus"></p>
        </form>
        <hr />
        <p><button type="button" class="btn" id="profileLogoutBtn">Выйти из аккаунта</button></p>
        <p style="margin-top: 28px;"><button type="button" class="btn danger-btn" id="profileDeleteBtn">Удалить профиль</button></p>
        <p class="muted" id="profileDeleteHint">Удаление необратимо. Объекты брокера агентства перейдут к агентству; у владельца агентства без брокеров объекты будут удалены вместе с профилем.</p>
      </div>
    </section>
    ${mobileBottomNavHtml("cabinet")}
  `;
  bindBrandHomeButton();
  bindMobileBottomNavActions();
  updateMobileNavMetrics();
  document.getElementById("cabinetBtn")?.addEventListener("click", () => (location.hash = "#/cabinet"));
  document.getElementById("adminBtn")?.addEventListener("click", () => (location.hash = "#/admin"));
  document.getElementById("agencyBtn")?.addEventListener("click", () => (location.hash = "#/agency"));
  document.getElementById("profileBackCabinet")?.addEventListener("click", () => {
    location.hash = "#/cabinet";
  });
  document.getElementById("profileRequestPasswordEmailBtn")?.addEventListener("click", async () => {
    const st = document.getElementById("profilePasswordEmailStatus");
    if (st) st.textContent = "";
    const btn = document.getElementById("profileRequestPasswordEmailBtn");
    const email = String(me.email || "").trim().toLowerCase();
    if (!email) {
      if (st) st.textContent = "Не удалось определить email.";
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const data = await api("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      if (st) st.textContent = data.message || "Проверьте почту.";
    } catch (err) {
      if (st) st.textContent = err.message || "Ошибка отправки";
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  document.getElementById("cabinetProfileForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("profileFormStatus");
    if (status) status.textContent = "";
    const phone = `+7${toDigits(document.getElementById("profilePhone")?.value || "")}`;
    const payload = {
      firstName: document.getElementById("profileFirstName")?.value.trim() || "",
      lastName: document.getElementById("profileLastName")?.value.trim() || "",
      phone,
      agency: document.getElementById("profileAgency")?.value.trim() || "",
      inn: document.getElementById("profileInn")?.value.trim() || "",
      telegram: document.getElementById("profileTelegram")?.value.trim() || "",
      whatsapp: document.getElementById("profileWhatsapp")?.value.trim() || "",
      vk: document.getElementById("profileVk")?.value.trim() || "",
      max: document.getElementById("profileMax")?.value.trim() || "",
      marketingConsent: Boolean(document.getElementById("profileMarketing")?.checked)
    };
    if (!/^\+7\d{10}$/.test(phone)) {
      if (status) status.textContent = "Телефон: 10 цифр после +7";
      return;
    }
    try {
      const data = await api("/api/me/profile", { method: "PATCH", body: JSON.stringify(payload) });
      state.user = data.user;
      localStorage.setItem("user", JSON.stringify(data.user));
      if (status) status.textContent = "Сохранено";
    } catch (err) {
      if (status) status.textContent = err.message || "Ошибка сохранения";
    }
  });
  document.getElementById("profileLogoutBtn")?.addEventListener("click", async () => {
    await logout();
    location.hash = "#/auth";
  });
  document.getElementById("profileDeleteBtn")?.addEventListener("click", async () => {
    if (
      !window.confirm(
        "Удалить профиль безвозвратно? Для владельца агентства с брокерами удаление недоступно, пока не удалены все брокеры."
      )
    ) {
      return;
    }
    try {
      await api("/api/me", { method: "DELETE" });
      await logout();
      location.hash = "#/auth";
    } catch (err) {
      alert(err.message || "Не удалось удалить профиль");
    }
  });
}

async function renderCabinetPage(openForm = false) {
  setMapBodyClass(false);
  if (!state.token) {
    renderAuthPage();
    return;
  }
  const [items, stats] = await Promise.all([api("/api/my/properties"), api("/api/my/stats")]);
  app.innerHTML = `
    ${topbar({ slim: true })}
    <section class="cabinet">
      <div class="panel">
        <div class="panel-head">
          <div class="cabinet-head-main">
            <h2>${state.user?.isAgencyOwner ? "Личный кабинет агентства" : "Личный кабинет брокера"}</h2>
            <button class="btn primary" type="button" id="openCabinetProfile">Редактировать профиль</button>
          </div>
          <button class="close-panel-action" id="closeCabinetPanel" aria-label="Закрыть кабинет">×</button>
        </div>
        <p class="muted">Всего объектов: ${stats.totalProperties}.</p>
        <p><button class="btn primary" id="addProperty">Добавить объект</button></p>
      </div>
      <div class="panel">
        <h3>Мои объекты</h3>
        ${
          items.length
            ? items
                .map(
                  (p) => `
          <article class="card">
            <img ${imgLazyAttrs({ feedCard: true })} src="${photoUrlWithFallback(p.photos?.[0])}" onerror="${photoOnErrorAttr()}" alt="">
            <div class="card-body">
              <div class="price">${money(p.price)} ₽</div>
              <div>${p.address}</div>
              <p>
                <button class="btn open-object" data-id="${p.id}">Открыть</button>
                <button class="btn edit-property" data-id="${p.id}">Редактировать</button>
                <button class="btn delete-property" data-id="${p.id}">Удалить</button>
              </p>
            </div>
          </article>
        `
                )
                .join("")
            : "<p class='muted'>Пока нет объектов.</p>"
        }
      </div>
      <div class="panel contact-us-card">
        <h4>Связаться с нами</h4>
        <p class="muted">По вопросам и предложениям:</p>
        <p><a class="btn" href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
      </div>
      <div class="modal" id="propertyFormModal">
        <div class="modal-card property-form-modal-card">
          <div class="panel-head">
            <h3 id="propertyFormTitle">Новый объект</h3>
            <button class="close-panel-action" id="closePropertyFormModal" aria-label="Закрыть">×</button>
          </div>
          <div id="propertyFormWrap">
        <form id="propertyForm">
          <div class="form-grid">
            <div class="field-block field-span-2">
              <label class="field-label" for="addressInput">Адрес</label>
              <div class="address-row">
                <input id="addressInput" name="address" autocomplete="off" required />
              </div>
              <div id="addressSuggestList" class="address-suggest-list" style="display:none;"></div>
              <div id="addressHint" class="note">Начните вводить адрес и выберите вариант из выпадающего списка.</div>
              <div id="addressPreviewMap" class="address-preview-map visible"></div>
            </div>
            <input type="hidden" name="lat" id="latInput" />
            <input type="hidden" name="lon" id="lonInput" />
            <div class="field-block">
              <label class="field-label" for="priceInput">Цена</label>
              <input id="priceInput" name="price" type="text" inputmode="numeric" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="areaInput">Площадь (м²)</label>
              <input id="areaInput" name="area" type="text" inputmode="decimal" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="bedroomsInput">Спальни</label>
              <input id="bedroomsInput" name="bedrooms" type="text" inputmode="numeric" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="floorInput">Этаж</label>
              <input id="floorInput" name="floor" type="text" inputmode="numeric" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="totalFloorsInput">Этажей в доме</label>
              <input id="totalFloorsInput" name="totalFloors" type="text" inputmode="numeric" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="ceilingHeightInput">Высота потолков (м)</label>
              <input id="ceilingHeightInput" name="ceilingHeight" type="number" step="0.1" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="commissionTotalInput">Общая комиссия (%)</label>
              <input id="commissionTotalInput" name="commissionTotal" type="text" inputmode="decimal" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="finishingInput">Отделка</label>
              <select id="finishingInput" name="finishing" required>
                <option value="">Выберите</option>
                <option value="finished">С отделкой</option>
                <option value="whitebox">Вайт бокс</option>
                <option value="concrete">Бетон</option>
              </select>
            </div>
            <div class="field-block">
              <label class="field-label" for="readinessInput">Готовность дома</label>
              <select id="readinessInput" name="readiness" required>
                <option value="">Выберите</option>
                <option value="resale">Вторичка</option>
                <option value="assignment">Переуступка</option>
              </select>
            </div>
            <div class="field-block">
              <label class="field-label" for="housingStatusInput">Статус жилья</label>
              <select id="housingStatusInput" name="housingStatus" required>
                <option value="flat">Квартира</option>
                <option value="apartments">Апартаменты</option>
              </select>
            </div>
            <div class="field-block">
              <label class="field-label" for="metroWalkInput">До метро пешком (мин)</label>
              <input id="metroWalkInput" name="metroWalkMinutes" type="text" inputmode="numeric" placeholder="Необязательно" />
            </div>
            <div class="field-block">
              <label class="field-label" for="commissionPartnerInput">Комиссия партнеру (%)</label>
              <input id="commissionPartnerInput" name="commissionPartner" type="text" inputmode="decimal" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="phoneInput">Телефон</label>
              <div class="phone-group">
                <span>+7</span>
                <input id="phoneInput" name="phone" placeholder="(999) 999-99-99" maxlength="15" inputmode="numeric" required />
              </div>
            </div>
            <div class="field-block">
              <label class="field-label" for="telegramInput">Ник в Telegram</label>
              <input id="telegramInput" name="telegram" placeholder="@nickname" />
            </div>
          </div>
          <label class="field-label" for="descriptionInput">Описание</label>
          <p><textarea id="descriptionInput" name="description" required></textarea></p>
          <label class="field-label" for="photosInput">Фото (до 5)</label>
          <div id="photoDropZone" class="photo-drop-zone">Перетащите фото сюда или выберите файл ниже</div>
          <p><input id="photosInput" type="file" name="photos" accept="image/*" /></p>
          <div id="pendingPhotosWrap" class="muted" style="display:none;">
            <p>Новые фото к загрузке:</p>
            <div id="pendingPhotosList"></div>
          </div>
          <div id="existingPhotosWrap" class="muted" style="display:none;">
            <p>Текущие фото объекта:</p>
            <div id="existingPhotosPreview"></div>
            <p class="muted">Если не загружать новые фото, текущие сохранятся.</p>
          </div>
          <p class="muted">PDF-презентация формируется автоматически из карточки объекта (без контактов и логотипов).</p>
          <p><button class="btn primary" id="propertySubmitBtn" type="submit">Сохранить объект</button></p>
        </form>
        <p id="cabinetStatus" class="muted"></p>
          </div>
        </div>
      </div>
    </section>
    ${mobileBottomNavHtml("cabinet")}
  `;
  bindBrandHomeButton();
  bindMobileBottomNavActions();
  updateMobileNavMetrics();
  const closePropertyFormModal = () => {
    document.getElementById("propertyFormModal")?.classList.remove("open");
  };
  const openObjectForm = () => {
    document.getElementById("propertyFormModal")?.classList.add("open");
    setupAddressSuggest();
  };
  document.getElementById("closePropertyFormModal")?.addEventListener("click", closePropertyFormModal);
  document.getElementById("propertyFormModal")?.addEventListener("click", (event) => {
    if (event.target?.id === "propertyFormModal") closePropertyFormModal();
  });
  document.getElementById("addProperty")?.addEventListener("click", openObjectForm);
  document.getElementById("addObjectBtn")?.addEventListener("click", openObjectForm);
  document.getElementById("cabinetBtn")?.addEventListener("click", () => (location.hash = "#/cabinet"));
  document.getElementById("adminBtn")?.addEventListener("click", () => (location.hash = "#/admin"));
  document.getElementById("agencyBtn")?.addEventListener("click", () => (location.hash = "#/agency"));
  document.getElementById("closeCabinetPanel").addEventListener("click", () => {
    location.hash = "#/";
  });
  document.getElementById("openCabinetProfile")?.addEventListener("click", () => {
    location.hash = "#/cabinet/profile";
  });
  let editingPropertyId = null;
  let pendingPhotoFiles = [];
  let existingPhotoUrls = [];
  let removedPhotoUrls = [];
  const MAX_PHOTOS_PER_OBJECT = 5;

  const renderPhotoState = () => {
    const existingWrap = document.getElementById("existingPhotosWrap");
    const existingPreview = document.getElementById("existingPhotosPreview");
    const pendingWrap = document.getElementById("pendingPhotosWrap");
    const pendingList = document.getElementById("pendingPhotosList");
    if (!existingWrap || !existingPreview || !pendingWrap || !pendingList) return;

    existingWrap.style.display = existingPhotoUrls.length ? "block" : "none";
    existingPreview.innerHTML = existingPhotoUrls
      .map(
        (photo, idx) => `<div class="photo-list-row">
          <img src="${photoUrlWithFallback(photo)}" onerror="${photoOnErrorAttr()}" alt="Текущее фото ${idx + 1}" />
          <button type="button" class="btn remove-existing-photo" data-photo="${escapeHtml(photo)}">Удалить</button>
        </div>`
      )
      .join("");

    pendingWrap.style.display = pendingPhotoFiles.length ? "block" : "none";
    pendingList.innerHTML = pendingPhotoFiles
      .map(
        (file, idx) => `<div class="photo-list-row">
          <span>${idx + 1}. ${escapeHtml(file.name)}</span>
          <button type="button" class="btn remove-pending-photo" data-index="${idx}">Удалить</button>
        </div>`
      )
      .join("");

    pendingList.querySelectorAll(".remove-pending-photo").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.index);
        if (Number.isNaN(index)) return;
        pendingPhotoFiles.splice(index, 1);
        renderPhotoState();
      });
    });

    existingPreview.querySelectorAll(".remove-existing-photo").forEach((btn) => {
      btn.addEventListener("click", () => {
        const photo = btn.dataset.photo;
        if (!photo) return;
        existingPhotoUrls = existingPhotoUrls.filter((item) => item !== photo);
        if (!removedPhotoUrls.includes(photo)) {
          removedPhotoUrls.push(photo);
        }
        renderPhotoState();
      });
    });
  };

  const addPendingPhotos = (fileList) => {
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    const slotsLeft = MAX_PHOTOS_PER_OBJECT - existingPhotoUrls.length - pendingPhotoFiles.length;
    if (slotsLeft <= 0) {
      document.getElementById("cabinetStatus").textContent = "Можно хранить не более 5 фото на объект.";
      return;
    }
    pendingPhotoFiles.push(...files.slice(0, slotsLeft));
    if (files.length > slotsLeft) {
      document.getElementById("cabinetStatus").textContent = "Добавлены не все файлы: максимум 5 фото на объект.";
    } else {
      document.getElementById("cabinetStatus").textContent = "";
    }
    renderPhotoState();
  };

  const openFormCreate = () => {
    editingPropertyId = null;
    pendingPhotoFiles = [];
    existingPhotoUrls = [];
    removedPhotoUrls = [];
    document.getElementById("propertyFormTitle").textContent = "Новый объект";
    document.getElementById("propertySubmitBtn").textContent = "Сохранить объект";
    document.getElementById("propertyForm").reset();
    document.getElementById("photosInput").required = false;
    renderPhotoState();
    document.getElementById("propertyFormModal")?.classList.add("open");
    document.getElementById("cabinetStatus").textContent = "";
    setupAddressSuggest();
  };

  const openFormEdit = (property) => {
    editingPropertyId = property.id;
    pendingPhotoFiles = [];
    removedPhotoUrls = [];
    document.getElementById("propertyFormTitle").textContent = "Редактирование объекта";
    document.getElementById("propertySubmitBtn").textContent = "Сохранить изменения";
    document.getElementById("photosInput").required = false;
    existingPhotoUrls = Array.isArray(property.photos) ? property.photos : [];
    renderPhotoState();
    document.getElementById("propertyFormModal")?.classList.add("open");
    const form = document.getElementById("propertyForm");
    form.elements.address.value = property.address || "";
    form.elements.price.value = formatSpacedNumber(property.price || "");
    form.elements.area.value = String(property.area ?? "").replace(".", ",");
    form.elements.bedrooms.value = formatSpacedNumber(property.bedrooms ?? "");
    form.elements.floor.value = formatSpacedNumber(property.floor ?? "");
    form.elements.totalFloors.value = formatSpacedNumber(property.totalFloors ?? "");
    form.elements.ceilingHeight.value = property.ceilingHeight ?? "";
    form.elements.commissionTotal.value = property.commissionTotal ?? "";
    form.elements.finishing.value = property.finishing || "";
    form.elements.readiness.value = property.readiness || "";
    form.elements.housingStatus.value = property.housingStatus || "flat";
    form.elements.metroWalkMinutes.value =
      property.metroWalkMinutes != null && Number.isFinite(Number(property.metroWalkMinutes))
        ? formatSpacedNumber(String(property.metroWalkMinutes))
        : "";
    form.elements.commissionPartner.value = property.commissionPartner ?? "";
    form.elements.phone.value = formatRussianPhoneMasked(String(property.contacts?.phone || "").replace(/\D/g, "").slice(-10));
    form.elements.telegram.value = property.contacts?.telegram || "";
    form.elements.description.value = property.description || "";
    form.elements.lat.value = property.lat ?? "";
    form.elements.lon.value = property.lon ?? "";
    document.getElementById("addressHint").innerHTML = `Точка определена: <strong>${escapeHtml(Number(property.lat || 0).toFixed(6))}, ${escapeHtml(
      Number(property.lon || 0).toFixed(6)
    )}</strong>`;
    document.getElementById("cabinetStatus").textContent = "";
    setupAddressSuggest();
  };

  if (openForm) {
    openFormCreate();
  }
  app.querySelectorAll(".open-object").forEach((btn) => {
    btn.addEventListener("click", () => (location.hash = `#/property/${btn.dataset.id}`));
  });
  app.querySelectorAll(".delete-property").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/my/properties/${btn.dataset.id}`, { method: "DELETE" });
      renderCabinetPage();
    });
  });
  app.querySelectorAll(".edit-property").forEach((btn) => {
    btn.addEventListener("click", () => {
      const property = items.find((item) => item.id === btn.dataset.id);
      if (!property) return;
      openFormEdit(property);
    });
  });
  document.getElementById("propertyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    formData.delete("photos");
    pendingPhotoFiles.forEach((file) => formData.append("photos", file));
    if (editingPropertyId && removedPhotoUrls.length) {
      formData.set("removePhotos", JSON.stringify(removedPhotoUrls));
    }
    formData.set("price", toRawNumberString(formData.get("price")));
    formData.set("area", normalizeDecimalInput(formData.get("area")));
    formData.set("bedrooms", toRawNumberString(formData.get("bedrooms")));
    formData.set("floor", toRawNumberString(formData.get("floor")));
    formData.set("totalFloors", toRawNumberString(formData.get("totalFloors")));
    formData.set("commissionTotal", normalizeDecimalInput(String(formData.get("commissionTotal") || "").replace(",", ".")));
    formData.set("commissionPartner", normalizeDecimalInput(String(formData.get("commissionPartner") || "").replace(",", ".")));
    formData.set("metroWalkMinutes", toRawNumberString(formData.get("metroWalkMinutes")));
    formData.set("phone", normalizeRussianPhone(formData.get("phone")));
    formData.set("telegram", normalizeTelegramNickname(formData.get("telegram")));
    if (!editingPropertyId && pendingPhotoFiles.length === 0) {
      document.getElementById("cabinetStatus").textContent = "Добавьте хотя бы одно фото.";
      return;
    }
    if (!formData.get("lat") || !formData.get("lon")) {
      document.getElementById("cabinetStatus").textContent = "Выберите адрес из подсказок, чтобы получить точку на карте.";
      return;
    }
    try {
      const endpoint = editingPropertyId ? `/api/my/properties/${editingPropertyId}` : "/api/my/properties";
      const method = editingPropertyId ? "PUT" : "POST";
      await api(endpoint, { method, body: formData });
      document.getElementById("cabinetStatus").textContent = editingPropertyId
        ? "Изменения сохранены."
        : "Объект сохранен и отображается на карте.";
      renderCabinetPage();
    } catch (error) {
      document.getElementById("cabinetStatus").textContent = error.message;
    }
  });

  const priceInput = document.getElementById("priceInput");
  priceInput?.addEventListener("input", (event) => {
    const raw = toRawNumberString(event.target.value);
    event.target.value = formatSpacedNumber(raw);
  });

  const wireIntField = (id) => {
    document.getElementById(id)?.addEventListener("input", (event) => {
      const raw = toRawNumberString(event.target.value);
      event.target.value = formatSpacedNumber(raw);
    });
  };
  wireIntField("bedroomsInput");
  wireIntField("floorInput");
  wireIntField("totalFloorsInput");
  wireIntField("metroWalkInput");

  document.getElementById("commissionTotalInput")?.addEventListener("input", (event) => {
    event.target.value = normalizeDecimalInput(event.target.value);
  });
  document.getElementById("commissionPartnerInput")?.addEventListener("input", (event) => {
    event.target.value = normalizeDecimalInput(event.target.value);
  });

  const areaInput = document.getElementById("areaInput");
  areaInput?.addEventListener("input", (event) => {
    const cleaned = String(event.target.value || "")
      .replace(",", ".")
      .replace(/[^\d.]/g, "");
    const [integerPart, ...rest] = cleaned.split(".");
    const decimalPart = rest.join("").slice(0, 2);
    const formattedInteger = formatSpacedNumber(integerPart);
    event.target.value = decimalPart ? `${formattedInteger},${decimalPart}` : formattedInteger;
  });

  const phoneInput = document.getElementById("phoneInput");
  phoneInput?.addEventListener("input", (event) => {
    event.target.value = formatRussianPhoneMasked(event.target.value);
  });

  const photosInput = document.getElementById("photosInput");
  photosInput?.addEventListener("change", (event) => {
    addPendingPhotos(event.target.files);
    event.target.value = "";
  });

  const photoDropZone = document.getElementById("photoDropZone");
  if (photoDropZone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      photoDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        photoDropZone.classList.add("active");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      photoDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        photoDropZone.classList.remove("active");
      });
    });
    photoDropZone.addEventListener("drop", (event) => {
      addPendingPhotos(event.dataTransfer?.files || []);
    });
  }
}

function setupAddressSuggest() {
  const addressInput = document.getElementById("addressInput");
  const latInput = document.getElementById("latInput");
  const lonInput = document.getElementById("lonInput");
  const addressHint = document.getElementById("addressHint");
  const addressSuggestList = document.getElementById("addressSuggestList");
  const addressPreviewMap = document.getElementById("addressPreviewMap");
  if (!addressInput || !latInput || !lonInput) return;
  let previewMap = null;
  let previewPlacemark = null;
  let suggestDebounceTimer = null;
  let suggestRequestId = 0;
  const MOSCOW_BOUNDS = [
    [55.45, 37.2],
    [56.05, 37.95]
  ];
  const MOSCOW_CENTER = MOSCOW_DEFAULT_CENTER;

  if (addressInput.dataset.suggestBound === "1") return;
  addressInput.dataset.suggestBound = "1";

  const hideSuggestList = () => {
    if (!addressSuggestList) return;
    addressSuggestList.innerHTML = "";
    addressSuggestList.style.display = "none";
  };

  const showSuggestList = (items) => {
    if (!addressSuggestList) return;
    if (!items.length) {
      hideSuggestList();
      return;
    }
    addressSuggestList.innerHTML = items
      .map((item) => {
        const value = escapeHtml(String(item.value || ""));
        const desc = escapeHtml(String(item.displayName || item.description || ""));
        return `<button type="button" class="address-suggest-item" data-value="${value}">${value}${
          desc && desc !== value ? `<span>${desc}</span>` : ""
        }</button>`;
      })
      .join("");
    addressSuggestList.style.display = "block";
    addressSuggestList.querySelectorAll(".address-suggest-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const value = btn.getAttribute("data-value") || "";
        if (!value) return;
        addressInput.value = value;
        hideSuggestList();
        resolveAddress(value).catch(() => {
          resetCoordinates();
          if (addressHint) {
            addressHint.textContent = "Не удалось определить адрес. Выберите другой вариант из списка.";
          }
        });
      });
    });
  };

  const updateAddressByCoordinates = async (lat, lon) => {
    if (!window.ymaps) return;
    const geocodeResult = await ymaps.geocode([lat, lon], { results: 1 });
    const firstGeoObject = geocodeResult.geoObjects.get(0);
    if (!firstGeoObject) return;
    const exactAddress = firstGeoObject.getAddressLine();
    if (exactAddress) {
      addressInput.value = exactAddress;
    }
  };

  const setPoint = (lat, lon) => {
    latInput.value = String(lat);
    lonInput.value = String(lon);
    if (!previewMap || !previewPlacemark) return;
    previewMap.setCenter([lat, lon], 15, { duration: 180 });
    previewPlacemark.geometry.setCoordinates([lat, lon]);
    if (addressHint) {
      addressHint.innerHTML = `Точка определена: <strong>${escapeHtml(lat.toFixed(6))}, ${escapeHtml(lon.toFixed(6))}</strong>`;
    }
    setTimeout(() => previewMap.container.fitToViewport(), 0);
  };

  const resetCoordinates = () => {
    latInput.value = "";
    lonInput.value = "";
    if (addressHint) {
      addressHint.textContent = "Начните вводить адрес и выберите вариант из выпадающего списка.";
    }
  };

  const scoreAddressSuggestion = (input, item) => {
    const query = String(input || "").trim().toLowerCase();
    const valueText = String(item?.value || "").toLowerCase();
    const descText = String(item?.description || item?.displayName || "").toLowerCase();
    let score = 0;
    if (valueText.includes("москва") || descText.includes("москва")) score += 100;
    if (/\d/.test(valueText)) score += 30;
    if (query && valueText.startsWith(query)) score += 20;
    if (query && valueText.includes(query)) score += 10;
    return score;
  };

  const normalizeSuggestionItems = (input, list) => {
    const unique = [];
    const seen = new Set();
    for (const item of list || []) {
      const value = String(item?.value || "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({
        value,
        description: String(item?.description || item?.displayName || "").trim(),
        _score: scoreAddressSuggestion(input, item)
      });
    }
    unique.sort((a, b) => b._score - a._score);
    return unique.slice(0, 8);
  };

  const requestSuggestions = (value) => {
    if (!value || value.length < 3 || !window.ymaps || typeof ymaps.geocode !== "function") {
      hideSuggestList();
      return;
    }
    const requestId = ++suggestRequestId;
    const showGeocodeFallback = () =>
      ymaps
        .geocode(`Москва, ${value}`, {
          results: 8,
          boundedBy: MOSCOW_BOUNDS
        })
        .then((result) => {
          if (requestId !== suggestRequestId) return;
          const fallback = [];
          result.geoObjects.each((geoObject) => {
            const line = geoObject.getAddressLine();
            if (!line) return;
            fallback.push({
              value: line,
              description: geoObject.properties?.get("text") || ""
            });
          });
          showSuggestList(normalizeSuggestionItems(value, fallback));
        })
        .catch(() => {
          if (requestId !== suggestRequestId) return;
          hideSuggestList();
        });

    if (typeof ymaps.suggest !== "function") {
      showGeocodeFallback();
      return;
    }

    ymaps
      .suggest(`Москва, ${value}`, {
        boundedBy: MOSCOW_BOUNDS,
        results: 8
      })
      .then((items) => {
        if (requestId !== suggestRequestId) return;
        const normalized = normalizeSuggestionItems(value, items);
        if (normalized.length) {
          showSuggestList(normalized);
          return;
        }
        showGeocodeFallback();
      })
      .catch(() => {
        showGeocodeFallback();
      });
  };

  addressInput.addEventListener("input", () => {
    resetCoordinates();
    const value = addressInput.value.trim();
    if (suggestDebounceTimer) clearTimeout(suggestDebounceTimer);
    suggestDebounceTimer = setTimeout(() => requestSuggestions(value), 160);
  });

  addressInput.addEventListener("focus", () => {
    const value = addressInput.value.trim();
    if (value.length >= 3) {
      requestSuggestions(value);
    }
  });

  addressInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideSuggestList();
    }
  });

  const resolveAddress = async (value) => {
    if (!window.ymaps) {
      if (addressHint) {
        addressHint.textContent = "Карты еще загружаются. Повторите через секунду.";
      }
      return;
    }
    const geocodeResult = await ymaps.geocode(value, {
      results: 1,
      boundedBy: MOSCOW_BOUNDS,
      strictBounds: false
    });
    const firstGeoObject = geocodeResult.geoObjects.get(0);
    if (!firstGeoObject) {
      resetCoordinates();
      if (addressHint) {
        addressHint.textContent = "Адрес не найден. Уточните формулировку и проверьте снова.";
      }
      return;
    }
    let [lat, lon] = firstGeoObject.geometry.getCoordinates();
    if (
      !lat ||
      !lon ||
      lat < MOSCOW_BOUNDS[0][0] ||
      lat > MOSCOW_BOUNDS[1][0] ||
      lon < MOSCOW_BOUNDS[0][1] ||
      lon > MOSCOW_BOUNDS[1][1]
    ) {
      const retry = await ymaps.geocode(`Москва, ${value}`, { results: 1 });
      const retryObject = retry.geoObjects.get(0);
      if (retryObject) {
        [lat, lon] = retryObject.geometry.getCoordinates();
      }
    }
    const exactAddress = firstGeoObject.getAddressLine() || value;
    addressInput.value = exactAddress;
    setPoint(lat, lon);
    hideSuggestList();
  };

  const initSuggest = () => {
    if (!window.ymaps) {
      setTimeout(initSuggest, 300);
      return;
    }

    ymaps.ready(() => {
      if (addressInput.dataset.suggestReady === "1") return;
      addressInput.dataset.suggestReady = "1";

      previewMap = new ymaps.Map("addressPreviewMap", {
        center: MOSCOW_CENTER,
        zoom: MOSCOW_DEFAULT_ZOOM,
        controls: ["zoomControl"]
      });
      previewPlacemark = new ymaps.Placemark(
        MOSCOW_CENTER,
        {},
        { draggable: true }
      );
      previewMap.geoObjects.add(previewPlacemark);
      previewMap.events.add("click", (event) => {
        const [lat, lon] = event.get("coords");
        setPoint(lat, lon);
        updateAddressByCoordinates(lat, lon).catch(() => {});
      });
      previewPlacemark.events.add("dragend", () => {
        const [lat, lon] = previewPlacemark.geometry.getCoordinates();
        setPoint(lat, lon);
        updateAddressByCoordinates(lat, lon).catch(() => {});
      });

      addressInput.addEventListener("blur", () => {
        setTimeout(() => {
          hideSuggestList();
        }, 150);
        if (!addressInput.value.trim() || (latInput.value && lonInput.value)) return;
        resolveAddress(addressInput.value.trim()).catch(resetCoordinates);
      });
    });
  };

  initSuggest();
}

async function renderAgencyPage() {
  setMapBodyClass(false);
  if (!state.user?.isAgencyOwner) {
    location.hash = "#/";
    return;
  }
  let agencyData = { brokerLimit: 0, brokerCount: 0, brokers: [] };
  let agencyProperties = [];
  try {
    [agencyData, agencyProperties] = await Promise.all([api("/api/agency/brokers"), api("/api/agency/properties")]);
  } catch (err) {
    app.innerHTML = `
      <section class="page">
        <p>${escapeHtml(err.message || "Ошибка загрузки панели агентства")}</p>
        <p><button class="btn" type="button" id="agencyErrToMap">На карту</button></p>
      </section>
      ${mobileBottomNavHtml("cabinet")}
    `;
    document.getElementById("agencyErrToMap").addEventListener("click", () => (location.hash = "#/"));
    bindMobileBottomNavActions();
    updateMobileNavMetrics();
    return;
  }

  const brokers = Array.isArray(agencyData.brokers) ? agencyData.brokers : [];
  const activeBrokers = brokers.filter((b) => !b.invitePending);
  const assignOptions = [
    {
      id: state.user.id,
      label: `Агентство (${state.user.agency || state.user.email || "владелец"})`
    },
    ...activeBrokers.map((b) => ({
      id: b.id,
      label: `${b.email}${b.name ? ` (${b.name})` : ""}`
    }))
  ];
  const rows = brokers
    .map(
      (b) => `<tr>
      <td>${escapeHtml(b.email)}</td>
      <td>${escapeHtml(b.invitePending ? "ожидает регистрации" : b.name || "—")}</td>
      <td>${escapeHtml(b.invitePending ? "—" : b.phone || "—")}</td>
      <td class="muted">${escapeHtml((b.createdAt || "").slice(0, 10))}</td>
      <td><button type="button" class="btn danger-btn agency-del-broker" data-id="${escapeHtml(b.id)}" data-email="${escapeHtml(
        b.email
      )}">Удалить</button></td>
    </tr>`
    )
    .join("");
  const propertyRows = agencyProperties.length
    ? agencyProperties
        .map((p) => {
          const optionsHtml = assignOptions
            .map(
              (o) =>
                `<option value="${escapeHtml(o.id)}" ${o.id === p.ownerId ? "selected" : ""}>${escapeHtml(o.label)}</option>`
            )
            .join("");
          return `<tr>
      <td><code>${escapeHtml(p.id)}</code></td>
      <td>${escapeHtml(p.address || "—")}</td>
      <td>${money(p.price)} ₽</td>
      <td>${escapeHtml(p.ownerEmail || "—")}</td>
      <td>
        <select class="agency-prop-owner-select" data-id="${escapeHtml(p.id)}">
          ${optionsHtml}
        </select>
      </td>
      <td>
        <a class="btn" href="#/property/${encodeURIComponent(p.id)}">Открыть</a>
        <button type="button" class="btn agency-prop-owner-save" data-id="${escapeHtml(p.id)}">Сохранить</button>
        <button type="button" class="btn danger-btn agency-prop-del" data-id="${escapeHtml(p.id)}">Удалить</button>
      </td>
    </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="muted">Нет объектов агентства</td></tr>`;

  app.innerHTML = `
    ${topbar({ slim: true })}
    <section class="page admin-page">
      <h1>Панель агентства</h1>
      <p class="muted">Добавьте email сотрудника — ему на почту уйдёт приглашение. Пароль, телефон и согласия он укажет сам по ссылке из письма.</p>
      <p class="muted">Лимит: <strong>${agencyData.brokerCount} / ${agencyData.brokerLimit || "∞"}</strong></p>

      <div class="panel">
        <h3>Пригласить брокера</h3>
        <div class="form-grid">
          <div class="field-block field-span-2">
            <label class="field-label" for="agencyBrokerEmail">Email сотрудника</label>
            <input id="agencyBrokerEmail" type="email" placeholder="broker@agency.ru" />
          </div>
        </div>
        <p><button class="btn primary" type="button" id="agencyCreateBrokerBtn">Отправить приглашение</button></p>
        <p class="muted" id="agencyStatus"></p>
      </div>

      <div class="panel">
        <h3>Брокеры агентства: ${brokers.length}</h3>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Имя / статус</th>
                <th>Телефон</th>
                <th>Создан</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="5" class="muted">Пока нет брокеров</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <h3>Объекты агентства: ${agencyProperties.length}</h3>
        <p class="muted">Можно изменить ответственного: на любого брокера агентства или на само агентство.</p>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Адрес</th>
                <th>Цена</th>
                <th>Текущий ответственный</th>
                <th>Новый ответственный</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${propertyRows}
            </tbody>
          </table>
        </div>
      </div>
    </section>
    ${mobileBottomNavHtml("cabinet")}
  `;

  bindBrandHomeButton();
  bindMobileBottomNavActions();
  updateMobileNavMetrics();
  document.getElementById("adminBtn")?.addEventListener("click", () => (location.hash = "#/admin"));
  document.getElementById("agencyBtn")?.addEventListener("click", () => (location.hash = "#/agency"));
  document.getElementById("toMapBtn")?.addEventListener("click", () => (location.hash = "#/"));
  document.getElementById("cabinetBtn")?.addEventListener("click", () => (location.hash = "#/cabinet"));

  document.getElementById("agencyCreateBrokerBtn")?.addEventListener("click", async () => {
    const email = document.getElementById("agencyBrokerEmail").value.trim();
    const status = document.getElementById("agencyStatus");
    status.textContent = "";
    if (!email) {
      status.textContent = "Укажите email сотрудника";
      return;
    }
    try {
      await api("/api/agency/brokers", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      await renderAgencyPage();
    } catch (err) {
      status.textContent = err.message || "Ошибка отправки приглашения";
    }
  });

  document.querySelectorAll(".agency-del-broker").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const email = btn.getAttribute("data-email") || "этого брокера";
      if (!id || !window.confirm(`Удалить брокера ${email}? Его объекты автоматически перейдут агентству.`)) {
        return;
      }
      btn.disabled = true;
      try {
        await api(`/api/agency/brokers/${encodeURIComponent(id)}`, { method: "DELETE" });
        await renderAgencyPage();
      } catch (err) {
        alert(err.message || "Ошибка удаления");
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll(".agency-prop-owner-save").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!id) return;
      const select = btn.closest("tr")?.querySelector(".agency-prop-owner-select");
      const ownerId = String(select?.value || "").trim();
      if (!ownerId) {
        alert("Выберите ответственного");
        return;
      }
      btn.disabled = true;
      try {
        await api(`/api/agency/properties/${encodeURIComponent(id)}/owner`, {
          method: "PATCH",
          body: JSON.stringify({ ownerId })
        });
        await renderAgencyPage();
      } catch (err) {
        alert(err.message || "Не удалось сменить ответственного");
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll(".agency-prop-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!id || !window.confirm("Удалить объект агентства?")) {
        return;
      }
      btn.disabled = true;
      try {
        await api(`/api/agency/properties/${encodeURIComponent(id)}`, { method: "DELETE" });
        await renderAgencyPage();
      } catch (err) {
        alert(err.message || "Ошибка удаления объекта");
        btn.disabled = false;
      }
    });
  });
}

async function renderAdminPage() {
  setMapBodyClass(false);
  let summary;
  let privateBrokers;
  let properties;
  let agencies;
  try {
    [summary, privateBrokers, properties, agencies] = await Promise.all([
      api("/api/admin/summary"),
      api("/api/admin/private-brokers"),
      api("/api/admin/properties"),
      api("/api/admin/agencies")
    ]);
  } catch (err) {
    app.innerHTML = `
      <section class="page">
        <p>${escapeHtml(err.message || "Ошибка")}</p>
        <p><button class="btn" type="button" id="adminErrToMap">На карту</button></p>
      </section>
      ${mobileBottomNavHtml("cabinet")}
    `;
    document.getElementById("adminErrToMap").addEventListener("click", () => {
      location.hash = "#/";
    });
    bindMobileBottomNavActions();
    updateMobileNavMetrics();
    return;
  }

  const agencyRows = agencies
    .map(
      (a) => `<tr>
      <td data-label="Агентство">${escapeHtml(a.agency || "—")}</td>
      <td data-label="Email">${escapeHtml(a.email || "—")}</td>
      <td data-label="Брокеров">${a.brokerCount}</td>
      <td data-label="Лимит">${a.brokerLimit}</td>
      <td data-label="Действия">
        <div class="admin-row-actions">
          <button class="btn admin-open-agency" data-id="${escapeHtml(a.id)}" type="button">Открыть</button>
          <button class="btn danger-btn admin-del-agency" data-id="${escapeHtml(a.id)}" data-email="${escapeHtml(a.email || "")}" type="button">Удалить</button>
        </div>
      </td>
    </tr>`
    )
    .join("");

  const usersRows = privateBrokers
    .map(
      (u) => `<tr>
      <td data-label="Email">${escapeHtml(u.email)}</td>
      <td data-label="Имя">${escapeHtml(u.name || "—")}</td>
      <td data-label="Организация">${escapeHtml(u.agency || "—")}</td>
      <td data-label="Телефон">${escapeHtml(u.phone || "—")}</td>
      <td data-label="Роль">${u.role === "admin" ? "admin" : "брокер"}</td>
      <td class="muted" data-label="Регистрация">${escapeHtml((u.createdAt || "").slice(0, 10))}</td>
      <td data-label="Действия">
        <div class="admin-row-actions">
          <button class="btn admin-open-user" data-id="${escapeHtml(u.id)}" type="button">Открыть</button>
          ${
            u.role === "admin"
              ? `<span class="muted">—</span>`
              : `<button class="btn danger-btn admin-del-user" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}" type="button">Удалить</button>`
          }
        </div>
      </td>
    </tr>`
    )
    .join("");

  const propRows = properties
    .map(
      (p) => `<tr>
      <td data-label="ID"><code>${escapeHtml(p.id)}</code></td>
      <td data-label="Адрес">
        <div class="admin-prop-cell">
          <img class="admin-prop-thumb" src="${photoUrlWithFallback(getPropertyPreviewPhoto(p))}" onerror="${photoOnErrorAttr()}" alt="Фото объекта" />
          <span>${escapeHtml(p.address || "—")}</span>
        </div>
      </td>
      <td data-label="Цена">${money(p.price)} ₽</td>
      <td data-label="Владелец">${escapeHtml(p.ownerEmail)}</td>
      <td class="muted" data-label="Создан">${escapeHtml((p.createdAt || "").slice(0, 10))}</td>
      <td data-label="Действия">
        <div class="admin-row-actions">
          <a class="btn" href="#/property/${encodeURIComponent(p.id)}">Открыть</a>
          <button class="btn danger-btn admin-del-prop" data-id="${escapeHtml(p.id)}" type="button">Удалить</button>
        </div>
      </td>
    </tr>`
    )
    .join("");

  app.innerHTML = `
    ${topbar({ slim: true })}
    <section class="page admin-page">
      <h1>Админка</h1>
      <p class="muted">Управление пользователями и размещёнными объектами. Удаление чистит записи из базы и локальные файлы в uploads.</p>
      <div class="admin-stat-grid">
        <div class="panel admin-stat">
          <div class="admin-stat-value">${summary.users}</div>
          <div class="muted">пользователей</div>
        </div>
        <div class="panel admin-stat">
          <div class="admin-stat-value">${summary.properties}</div>
          <div class="muted">объектов</div>
        </div>
      </div>
      <div class="admin-tabs" role="tablist" aria-label="Разделы админки">
        <button class="btn admin-tab-btn active" type="button" id="adminUsersTabBtn" role="tab" aria-selected="true">Пользователи</button>
        <button class="btn admin-tab-btn" type="button" id="adminPropertiesTabBtn" role="tab" aria-selected="false">Объекты</button>
      </div>

      <div class="admin-tab-panel active" id="adminUsersPanel">
      <h2>Агентства</h2>
      <div class="panel">
        <h3>Список агентств</h3>
        <div class="address-row admin-search-row">
          <input id="adminAgencySearchInput" placeholder="Поиск агентства: email, имя, название" />
          <button class="btn" type="button" id="adminAgencySearchBtn">Найти</button>
        </div>
        <div class="admin-table-wrap admin-table-wrap--spaced">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Агентство</th>
                <th>Email</th>
                <th>Брокеров</th>
                <th>Лимит</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="adminAgencyTableBody">
              ${agencyRows || `<tr><td colspan="5" class="muted">Нет агентств</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <h2>Частные брокеры</h2>
      <div class="address-row admin-search-row">
        <input id="adminPrivateBrokerSearchInput" placeholder="Поиск частного брокера: email, имя, телефон, ИП/самозанятый" />
        <button class="btn" type="button" id="adminPrivateBrokerSearchBtn">Найти</button>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Имя</th>
              <th>Организация</th>
              <th>Телефон</th>
              <th>Роль</th>
              <th>Регистрация</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="adminPrivateBrokerTableBody">
            ${usersRows || `<tr><td colspan="7" class="muted">Нет частных брокеров</td></tr>`}
          </tbody>
        </table>
      </div>
      </div>

      <div class="admin-tab-panel" id="adminPropertiesPanel">
      <h2>Объекты</h2>
      <div class="address-row admin-search-row">
        <input id="adminPropertySearchInput" placeholder="Поиск объекта: ID, адрес, email владельца" />
        <button class="btn" type="button" id="adminPropertySearchBtn">Найти</button>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Адрес</th>
              <th>Цена</th>
              <th>Владелец (email)</th>
              <th>Создан</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="adminPropertyTableBody">
            ${propRows || `<tr><td colspan="6" class="muted">Нет объектов</td></tr>`}
          </tbody>
        </table>
      </div>
      </div>
      <div class="modal" id="adminInfoModal">
        <div class="modal-card admin-modal-card">
          <div class="panel-head">
            <h3 id="adminInfoTitle">Детали</h3>
            <button class="close-panel-action" id="adminInfoCloseBtn" aria-label="Закрыть">×</button>
          </div>
          <div id="adminInfoBody"></div>
        </div>
      </div>
      <div class="modal" id="adminAgencyModal">
        <div class="modal-card admin-modal-card">
          <div class="panel-head">
            <h3 id="adminAgencyModalTitle">Агентство</h3>
            <button class="close-panel-action" id="adminAgencyCloseBtn" aria-label="Закрыть">×</button>
          </div>
          <div id="adminAgencyModalBody"></div>
        </div>
      </div>
    </section>
    ${mobileBottomNavHtml("cabinet")}
  `;

  bindBrandHomeButton();
  document.getElementById("adminBtn")?.addEventListener("click", () => {
    location.hash = "#/admin";
  });
  document.getElementById("agencyBtn")?.addEventListener("click", () => {
    location.hash = "#/agency";
  });
  document.getElementById("toMapBtn")?.addEventListener("click", () => {
    location.hash = "#/";
  });
  document.getElementById("cabinetBtn")?.addEventListener("click", () => {
    location.hash = "#/cabinet";
  });
  bindMobileBottomNavActions();
  updateMobileNavMetrics();

  const usersTabBtn = document.getElementById("adminUsersTabBtn");
  const propertiesTabBtn = document.getElementById("adminPropertiesTabBtn");
  const usersPanel = document.getElementById("adminUsersPanel");
  const propertiesPanel = document.getElementById("adminPropertiesPanel");
  const setAdminTab = (tab) => {
    const isUsers = tab === "users";
    usersTabBtn.classList.toggle("active", isUsers);
    propertiesTabBtn.classList.toggle("active", !isUsers);
    usersTabBtn.setAttribute("aria-selected", isUsers ? "true" : "false");
    propertiesTabBtn.setAttribute("aria-selected", !isUsers ? "true" : "false");
    usersPanel.classList.toggle("active", isUsers);
    propertiesPanel.classList.toggle("active", !isUsers);
  };
  usersTabBtn?.addEventListener("click", () => setAdminTab("users"));
  propertiesTabBtn?.addEventListener("click", () => setAdminTab("properties"));

  const adminModal = document.getElementById("adminInfoModal");
  const adminInfoTitle = document.getElementById("adminInfoTitle");
  const adminInfoBody = document.getElementById("adminInfoBody");
  const closeAdminModal = () => adminModal?.classList.remove("open");
  document.getElementById("adminInfoCloseBtn")?.addEventListener("click", closeAdminModal);
  adminModal?.addEventListener("click", (event) => {
    if (event.target === adminModal) closeAdminModal();
  });

  const agencyModal = document.getElementById("adminAgencyModal");
  const agencyModalTitle = document.getElementById("adminAgencyModalTitle");
  const agencyModalBody = document.getElementById("adminAgencyModalBody");
  const closeAgencyModal = () => agencyModal?.classList.remove("open");
  document.getElementById("adminAgencyCloseBtn")?.addEventListener("click", closeAgencyModal);
  agencyModal?.addEventListener("click", (event) => {
    if (event.target === agencyModal) closeAgencyModal();
  });

  const renderAgencyRows = (list) => {
    const tbody = document.getElementById("adminAgencyTableBody");
    if (!tbody) return;
    tbody.innerHTML = list.length
      ? list
          .map(
            (a) => `<tr>
          <td data-label="Агентство">${escapeHtml(a.agency || "—")}</td>
          <td data-label="Email">${escapeHtml(a.email || "—")}</td>
          <td data-label="Брокеров">${a.brokerCount}</td>
          <td data-label="Лимит">${a.brokerLimit}</td>
          <td data-label="Действия">
            <div class="admin-row-actions">
              <button class="btn admin-open-agency" data-id="${escapeHtml(a.id)}" type="button">Открыть</button>
              <button class="btn danger-btn admin-del-agency" data-id="${escapeHtml(a.id)}" data-email="${escapeHtml(a.email || "")}" type="button">Удалить</button>
            </div>
          </td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="muted">Нет агентств</td></tr>`;
    bindAgencyOpenButtons();
    bindAgencyDeleteButtons();
  };

  const bindAgencyOpenButtons = () => {
    document.querySelectorAll(".admin-open-agency").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!id) return;
        btn.disabled = true;
        try {
          const details = await api(`/api/admin/agencies/${encodeURIComponent(id)}`);
          const agency = details.agency || {};
          const brokers = Array.isArray(details.brokers) ? details.brokers : [];
          agencyModalTitle.textContent = `Агентство: ${agency.agency || agency.email || "—"}`;
          agencyModalBody.innerHTML = `
            <p><strong>Email:</strong> ${escapeHtml(agency.email || "—")}</p>
            <p><strong>Телефон:</strong> ${escapeHtml(agency.phone || "—")}</p>
            <p><strong>ИНН:</strong> ${escapeHtml(agency.inn || "—")}</p>
            <div class="address-row">
              <div style="flex:1;">
                <label class="field-label" for="adminAgencyLimitInput">Лимит брокеров</label>
                <input id="adminAgencyLimitInput" type="number" min="0" step="1" value="${Number(agency.brokerLimit || 0)}" />
              </div>
              <div style="display:flex;align-items:flex-end;">
                <button class="btn primary" type="button" id="adminAgencySaveLimitBtn">Сохранить лимит</button>
              </div>
            </div>
            <p class="muted" id="adminAgencyLimitStatus">Текущее количество брокеров: ${brokers.length}</p>
            <hr />
            <p><strong>Брокеры агентства:</strong></p>
            <div class="admin-mini-list">
              ${
                brokers.length
                  ? brokers
                      .map(
                        (b) =>
                          `<div class="admin-mini-list-item">${escapeHtml(b.name || "—")} — ${escapeHtml(b.email || "—")} (${escapeHtml(
                            b.phone || "—"
                          )}) <button class="btn danger-btn admin-del-agency-broker" type="button" data-id="${escapeHtml(
                            b.id
                          )}" data-email="${escapeHtml(b.email || "")}">Удалить</button></div>`
                      )
                      .join("")
                  : `<p class="muted">Пока нет брокеров</p>`
              }
            </div>
          `;
          document.getElementById("adminAgencySaveLimitBtn")?.addEventListener("click", async () => {
            const input = document.getElementById("adminAgencyLimitInput");
            const status = document.getElementById("adminAgencyLimitStatus");
            const brokerLimit = Number(input.value);
            if (!Number.isInteger(brokerLimit) || brokerLimit < 0) {
              status.textContent = "Лимит должен быть целым числом >= 0";
              return;
            }
            try {
              await api(`/api/admin/agencies/${encodeURIComponent(id)}/broker-limit`, {
                method: "PATCH",
                body: JSON.stringify({ brokerLimit })
              });
              status.textContent = `Лимит обновлён: ${brokerLimit}`;
              const refreshed = await api("/api/admin/agencies");
              renderAgencyRows(refreshed);
            } catch (e) {
              status.textContent = e.message || "Ошибка обновления лимита";
            }
          });
          document.querySelectorAll(".admin-del-agency-broker").forEach((brokerBtn) => {
            brokerBtn.addEventListener("click", async () => {
              const brokerId = brokerBtn.getAttribute("data-id");
              const brokerEmail = brokerBtn.getAttribute("data-email") || "этого брокера";
              if (!brokerId || !window.confirm(`Удалить брокера ${brokerEmail} из агентства?`)) {
                return;
              }
              brokerBtn.disabled = true;
              try {
                await api(`/api/admin/users/${encodeURIComponent(brokerId)}`, { method: "DELETE" });
                closeAgencyModal();
                await renderAdminPage();
              } catch (e) {
                alert(e.message || "Ошибка удаления брокера");
                brokerBtn.disabled = false;
              }
            });
          });
          agencyModal.classList.add("open");
        } catch (e) {
          alert(e.message || "Ошибка загрузки агентства");
        } finally {
          btn.disabled = false;
        }
      });
    });
  };

  const bindAgencyDeleteButtons = () => {
    document.querySelectorAll(".admin-del-agency").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const email = btn.getAttribute("data-email") || "это агентство";
        if (!id || !window.confirm(`Удалить агентство ${email} целиком? Будут удалены все брокеры и объекты.`)) {
          return;
        }
        btn.disabled = true;
        try {
          await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
          await renderAdminPage();
        } catch (e) {
          alert(e.message || "Ошибка удаления агентства");
          btn.disabled = false;
        }
      });
    });
  };

  document.getElementById("adminAgencySearchBtn")?.addEventListener("click", async () => {
    const query = document.getElementById("adminAgencySearchInput").value.trim();
    try {
      const filtered = await api(`/api/admin/agencies?query=${encodeURIComponent(query)}`);
      renderAgencyRows(filtered);
    } catch (e) {
      alert(e.message || "Ошибка поиска");
    }
  });
  document.getElementById("adminAgencySearchInput")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    document.getElementById("adminAgencySearchBtn")?.click();
  });
  bindAgencyOpenButtons();
  bindAgencyDeleteButtons();

  const bindUserRowHandlers = () => {
    document.querySelectorAll(".admin-open-user").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!id) return;
      btn.disabled = true;
      try {
        const data = await api(`/api/admin/users/${encodeURIComponent(id)}`);
        const user = data.user || {};
        const userProps = Array.isArray(data.properties) ? data.properties : [];
        adminInfoTitle.textContent = `Пользователь: ${user.email || "—"}`;
        adminInfoBody.innerHTML = `
          <p><strong>Имя:</strong> ${escapeHtml(user.name || "—")}</p>
          <p><strong>Фамилия:</strong> ${escapeHtml(user.lastName || "—")}</p>
          <p><strong>Телефон:</strong> ${escapeHtml(user.phone || "—")}</p>
          <p><strong>Организация:</strong> ${escapeHtml(user.agency || "—")}</p>
          <p><strong>ИНН:</strong> ${escapeHtml(user.inn || "—")}</p>
          <p><strong>Роль:</strong> ${escapeHtml(user.role || "user")}</p>
          <hr />
          <p><strong>Объектов у пользователя:</strong> ${userProps.length}</p>
          <div class="admin-mini-list">
            ${
              userProps.length
                ? userProps
                    .map(
                      (p) =>
                        `<div class="admin-mini-list-item"><code>${escapeHtml(p.id)}</code> — ${escapeHtml(p.address || "—")} (${money(p.price)} ₽)</div>`
                    )
                    .join("")
                : `<p class="muted">Нет объектов</p>`
            }
          </div>
        `;
        adminModal.classList.add("open");
      } catch (e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  const bindPropertyRowHandlers = () => {
    document.querySelectorAll(".admin-del-prop").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!id || !window.confirm("Удалить объект из базы? Файлы фото/PDF в uploads будут удалены, если путь начинается с /uploads/.")) {
          return;
        }
        btn.disabled = true;
        try {
          await api(`/api/admin/properties/${encodeURIComponent(id)}`, { method: "DELETE" });
          await renderAdminPage();
        } catch (e) {
          alert(e.message);
          btn.disabled = false;
        }
      });
    });
  };

    document.querySelectorAll(".admin-del-user").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const email = btn.getAttribute("data-email") || "этого пользователя";
        if (!id || !window.confirm(`Удалить пользователя ${email}? Будут удалены и все его объекты.`)) {
          return;
        }
        btn.disabled = true;
        try {
          await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
          await renderAdminPage();
        } catch (e) {
          alert(e.message);
          btn.disabled = false;
        }
      });
    });
  };
  bindUserRowHandlers();

  const renderPrivateBrokerRows = (list) => {
    const tbody = document.getElementById("adminPrivateBrokerTableBody");
    if (!tbody) return;
    tbody.innerHTML =
      list.length
        ? list
            .map(
              (u) => `<tr>
          <td data-label="Email">${escapeHtml(u.email)}</td>
          <td data-label="Имя">${escapeHtml(u.name || "—")}</td>
          <td data-label="Организация">${escapeHtml(u.agency || "—")}</td>
          <td data-label="Телефон">${escapeHtml(u.phone || "—")}</td>
          <td data-label="Роль">${u.role === "admin" ? "admin" : "брокер"}</td>
          <td class="muted" data-label="Регистрация">${escapeHtml((u.createdAt || "").slice(0, 10))}</td>
          <td data-label="Действия">
            <div class="admin-row-actions">
              <button class="btn admin-open-user" data-id="${escapeHtml(u.id)}" type="button">Открыть</button>
              ${
                u.role === "admin"
                  ? `<span class="muted">—</span>`
                  : `<button class="btn danger-btn admin-del-user" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(
                      u.email
                    )}" type="button">Удалить</button>`
              }
            </div>
          </td>
        </tr>`
            )
            .join("")
        : `<tr><td colspan="7" class="muted">Нет частных брокеров</td></tr>`;
    bindUserRowHandlers();
  };

  document.getElementById("adminPrivateBrokerSearchBtn")?.addEventListener("click", async () => {
    const query = document.getElementById("adminPrivateBrokerSearchInput").value.trim();
    try {
      const filtered = await api(`/api/admin/private-brokers?query=${encodeURIComponent(query)}`);
      renderPrivateBrokerRows(filtered);
    } catch (e) {
      alert(e.message || "Ошибка поиска частных брокеров");
    }
  });
  document.getElementById("adminPrivateBrokerSearchInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    document.getElementById("adminPrivateBrokerSearchBtn")?.click();
  });

  const renderPropertyRows = (list) => {
    const tbody = document.getElementById("adminPropertyTableBody");
    if (!tbody) return;
    tbody.innerHTML = list.length
      ? list
          .map(
            (p) => `<tr>
          <td data-label="ID"><code>${escapeHtml(p.id)}</code></td>
          <td data-label="Адрес">
            <div class="admin-prop-cell">
              <img class="admin-prop-thumb" src="${photoUrlWithFallback(getPropertyPreviewPhoto(p))}" onerror="${photoOnErrorAttr()}" alt="Фото объекта" />
              <span>${escapeHtml(p.address || "—")}</span>
            </div>
          </td>
          <td data-label="Цена">${money(p.price)} ₽</td>
          <td data-label="Владелец">${escapeHtml(p.ownerEmail)}</td>
          <td class="muted" data-label="Создан">${escapeHtml((p.createdAt || "").slice(0, 10))}</td>
          <td data-label="Действия">
            <div class="admin-row-actions">
              <a class="btn" href="#/property/${encodeURIComponent(p.id)}">Открыть</a>
              <button class="btn danger-btn admin-del-prop" data-id="${escapeHtml(p.id)}" type="button">Удалить</button>
            </div>
          </td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="6" class="muted">Нет объектов</td></tr>`;
    bindPropertyRowHandlers();
  };

  document.getElementById("adminPropertySearchBtn")?.addEventListener("click", () => {
    const query = String(document.getElementById("adminPropertySearchInput").value || "")
      .trim()
      .toLowerCase();
    if (!query) {
      renderPropertyRows(properties);
      return;
    }
    const filtered = properties.filter((p) => {
      const haystack = `${p.id || ""} ${p.address || ""} ${p.ownerEmail || ""}`.toLowerCase();
      return haystack.includes(query);
    });
    renderPropertyRows(filtered);
  });
  document.getElementById("adminPropertySearchInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    document.getElementById("adminPropertySearchBtn")?.click();
  });

  bindPropertyRowHandlers();
}

async function router() {
  const hash = location.hash || "#/";
  const agencyInviteToken = parseAgencyInviteTokenFromHash(hash);
  if (agencyInviteToken) {
    await renderAgencyInvitePage(agencyInviteToken);
    return;
  }
  if (!state.token) {
    if (hash.startsWith("#/demo/property/")) {
      const id = decodeURIComponent(hash.split("/")[3] || "");
      renderDemoPropertyPage(id);
      return;
    }
    if (hash === "#/cabinet" || hash === "#/cabinet/add" || hash === "#/cabinet/profile") {
      location.hash = "#/auth";
      return;
    }
    const overlayReturn = state.authOverlayReturnHash;
    const wantsAuthOverlay =
      hash === "#/auth" || hash === "#/auth-form" || hash === "#/auth-register";
    if (
      wantsAuthOverlay &&
      overlayReturn &&
      (overlayReturn === "#/" || overlayReturn.startsWith("#/demo/property/"))
    ) {
      if (overlayReturn.startsWith("#/demo/property/")) {
        const rid = decodeURIComponent(overlayReturn.split("/")[3] || "");
        renderDemoPropertyPage(rid);
      } else {
        renderPublicDemoPage();
      }
      renderDemoAuthOverlay(hash);
      return;
    }
    if (hash === "#/auth") {
      renderAuthPage();
      return;
    }
    if (hash === "#/auth-form" || hash === "#/auth-register") {
      renderAuthPage();
      if (hash === "#/auth-register") {
        setTimeout(() => {
          document.getElementById("openRegister")?.click();
        }, 0);
      }
      return;
    }
    renderPublicDemoPage();
    return;
  }
  if (!didSyncUserFromServer) {
    didSyncUserFromServer = true;
    try {
      const me = await api("/api/auth/me");
      state.user = me;
      localStorage.setItem("user", JSON.stringify(me));
    } catch {
      return;
    }
  }
  if (hash === "#/auth") {
    renderAuthPage();
    return;
  }
  if (hash === "#/admin") {
    if (!state.user?.isAdmin) {
      location.hash = "#/";
      return;
    }
    await renderAdminPage();
    return;
  }
  if (hash === "#/agency") {
    if (!state.user?.isAgencyOwner) {
      location.hash = "#/";
      return;
    }
    await renderAgencyPage();
    return;
  }
  if (hash.startsWith("#/property/")) {
    const id = hash.split("/")[2];
    await renderPropertyPage(id);
    return;
  }
  if (hash === "#/cabinet/profile") {
    await renderCabinetProfilePage();
    return;
  }
  if (hash === "#/cabinet") {
    await renderCabinetPage();
    return;
  }
  if (hash === "#/cabinet/add") {
    await renderCabinetPage(true);
    return;
  }
  renderMapPage();
}

window.addEventListener("hashchange", router);
router();

(function bindMobileSheetResizeOnce() {
  let mobileSheetResizeTimer = 0;
  window.addEventListener(
    "resize",
    () => {
      window.clearTimeout(mobileSheetResizeTimer);
      mobileSheetResizeTimer = window.setTimeout(() => {
        updateMobileNavMetrics();
        if (!window.matchMedia("(max-width: 900px)").matches) return;
        const lp = document.getElementById("leftPanel");
        const dm = document.getElementById("demoLeftPanel");
        if (lp?.querySelector("[data-sheet-track]")) mobileSheetSettleAfterRender(lp, document.getElementById("mapLayout"));
        if (dm?.querySelector("[data-sheet-track]")) mobileSheetSettleAfterRender(dm, document.getElementById("demoMapLayout"));
      }, 140);
    },
    { passive: true }
  );
})();
