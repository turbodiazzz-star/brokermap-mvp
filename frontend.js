const state = {
  token: localStorage.getItem("token") || "",
  user: JSON.parse(localStorage.getItem("user") || "null"),
  mapInstance: null,
  properties: [],
  selectedGroup: [],
  selectedPropertyId: null,
  panelCollapsed: false,
  /** моб.: последний translateY листа (0 — выше) при раскрытом листе; null — взять по умолч. */
  panelSheetT: null,
  areaPolygonCoords: null,
  areaPolygonObject: null,
  areaDrawMode: false,
  areaDrawInProgress: false,
  areaDrawCoords: [],
  areaDrawHandlers: null,
  areaDrawCanvas: null,
  mapView: null,
  viewportUpdateTimer: null,
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
    readiness: ""
  },
  /** Фиксированный набор демо-объектов на сессию (фильтры не меняют «источник») */
  demoAllProperties: null,
  /** увеличивать, чтобы сбросить кэш демо после смены логики точек/адресов */
  demoDataVersion: 0
};

const CURRENT_DEMO_DATA_VERSION = 5;

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

function photoUrlWithFallback(url) {
  return escapeHtml(url || PLACEHOLDER_IMAGE_URL);
}

function photoOnErrorAttr() {
  return `this.onerror=null;this.src='${PLACEHOLDER_IMAGE_URL}';`;
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

function moreFiltersModalHtml() {
  return `
    <div class="modal" id="filtersModal">
      <div class="modal-card">
        <h3>Дополнительные фильтры</h3>
        <div class="form-grid">
          <div class="field-block">
            <label class="field-label" for="filterFloorMin">Этаж от</label>
            <input id="filterFloorMin" type="number" min="1" value="${escapeHtml(state.filters.floorMin)}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="filterFloorMax">Этаж до</label>
            <input id="filterFloorMax" type="number" min="1" value="${escapeHtml(state.filters.floorMax)}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="filterTotalFloorsMin">Этажей в доме от</label>
            <input id="filterTotalFloorsMin" type="number" min="1" value="${escapeHtml(state.filters.totalFloorsMin)}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="filterTotalFloorsMax">Этажей в доме до</label>
            <input id="filterTotalFloorsMax" type="number" min="1" value="${escapeHtml(state.filters.totalFloorsMax)}" />
          </div>
          <div class="field-block">
            <label class="field-label" for="filterCeilingMin">Потолки от (м)</label>
            <input id="filterCeilingMin" type="number" step="0.1" min="0" value="${escapeHtml(state.filters.ceilingHeightMin)}" />
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
        </div>
        <p>
          <button class="btn primary" id="applyMoreFilters" type="button">Применить</button>
          <button class="btn" id="resetMoreFilters" type="button">Сбросить доп. фильтры</button>
          <button class="btn" id="closeModal" type="button">Закрыть</button>
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
  return `
    <header class="topbar">
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

function bindBrandHomeButton() {
  document.getElementById("brandHomeBtn")?.addEventListener("click", () => {
    location.hash = "#/";
  });
}

function ensureMapDrawControls() {
  const mapWrap = document.querySelector(".map-wrap");
  if (!mapWrap) return;
  let tools = mapWrap.querySelector(".map-draw-tools");
  if (!tools) {
    tools = document.createElement("div");
    tools.className = "map-draw-tools";
    mapWrap.appendChild(tools);
  }
  let drawBtn = document.getElementById("mapDrawAreaBtn");
  if (!drawBtn) {
    drawBtn = document.createElement("button");
    drawBtn.id = "mapDrawAreaBtn";
    drawBtn.className = "map-draw-btn";
    drawBtn.title = "Рисовать область";
    drawBtn.textContent = "✍";
    tools.appendChild(drawBtn);
    drawBtn.addEventListener("click", startAreaDrawing);
  }
  tools.style.display = "flex";
  drawBtn.style.display = "inline-flex";
  syncDrawButtons();
}

function cardMarkup(property) {
  return `
    <article class="card ${property.commissionPartner >= 4 ? "premium" : ""}">
      <img src="${photoUrlWithFallback(property.photos?.[0])}" onerror="${photoOnErrorAttr()}" alt="Объект" />
      <div class="card-body">
        <div class="price">${money(property.price)} ₽</div>
        <div>${property.address}</div>
        <div class="muted">Комиссия партнеру: <strong>${property.commissionPartner}%</strong></div>
        <div class="muted">Сумма: ${money((property.price * property.commissionPartner) / 100)} ₽</div>
        <p><button class="btn primary open-object" data-id="${property.id}">Перейти к объекту</button></p>
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
    demo.push({
      id: `demo-${i + 1}`,
      title: `Квартира в Москве #${i + 1}`,
      address,
      lat,
      lon,
      price: priceBase,
      area: 28 + (i % 9) * 6,
      bedrooms: (i % 4) + 1,
      floor: 1 + (i % 20),
      totalFloors: 9 + (i % 20),
      ceilingHeight: Math.round((2.6 + (i % 5) * 0.1) * 10) / 10,
      finishing: finishingOptions[i % finishingOptions.length],
      readiness: readinessOptions[i % readinessOptions.length],
      commissionTotal: 3,
      commissionPartner: 1.5,
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
  return `
    <article class="card">
      <img src="${photoUrlWithFallback(item.photos?.[0])}" onerror="${photoOnErrorAttr()}" alt="Демо объект">
      <div class="card-body">
        <div class="price">${money(item.price)} ₽</div>
        <div>${item.address}</div>
        <div class="muted">${item.area} м² · ${item.bedrooms} спальни</div>
        <div class="muted">Общая комиссия: <strong>${item.commissionTotal}%</strong></div>
        <div class="muted">Комиссия партнера: <strong>${item.commissionPartner}%</strong></div>
        <div class="demo-blur-line">Телефон: ${item.contacts.phone}</div>
        <div class="demo-blur-line">Telegram: ${item.contacts.telegram}</div>
        <p><button class="btn primary open-demo-object" data-id="${item.id}">Открыть объект</button></p>
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
}

function leftPanelHandleHtml(handleAreaId) {
  return `<div class="left-panel-handle-wrap" id="${handleAreaId}" role="presentation">
    <div class="left-panel-handle" aria-hidden="true"></div>
    <p class="left-panel-handle-hint">Тяните панель за любую область</p>
  </div>`;
}

/** Скролл списка (моб.): ручка и шапка внутри — при прокрутке уходят вверх вместе с лентой */
function leftPanelScrollWrap(innerHtml) {
  return `<div class="left-panel__scroll" data-left-scroll>${innerHtml}</div>`;
}

function leftPanelMobileBlock(handleAreaId, headHtml, bodyHtml) {
  return leftPanelScrollWrap(leftPanelHandleHtml(handleAreaId) + headHtml + bodyHtml);
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

function setPanelTranslateY(el, y, withTransition) {
  if (!el) return;
  if (withTransition) {
    el.classList.add("left-panel--sheet-anim");
  } else {
    el.classList.remove("left-panel--sheet-anim");
  }
  el.style.transform = `translate3d(0, ${y}px, 0)`;
}

/**
 * t = 0 — максимум вверх; t растёт — панель уезжает вниз.
 */
function getSheetGeometry(panel) {
  if (!window.matchMedia("(max-width: 900px)").matches) return null;
  const vh = window.innerHeight;
  const h = Math.max(1, Math.round(panel.offsetHeight));
  const PEEK = 64;
  const tPeek = Math.max(0, h - PEEK);
  const tMid = Math.max(0, h - 0.5 * vh);
  return { h, tPeek, tMid, tMax: tPeek, vh };
}

/** Упругое сопротивление у 0 и tMax (во время жеста) */
function sheetRubber(t, g) {
  if (!g) return t;
  if (t < 0) return t * 0.32;
  if (t > g.tMax) return g.tMax + (t - g.tMax) * 0.32;
  return t;
}

function clampSheetT(t, g) {
  if (!g) return 0;
  return Math.min(g.tMax, Math.max(0, t));
}

/**
 * Моб. нижний лист: тянем за любую область; в [data-left-scroll] — ручка, шапка и лента (цельный скролл);
 * пока лента не в самом верху — двигается скролл; у верхней границы — снова движется вся панель.
 * Отпускание: фиксируем высоту как есть, с мягким дожатием; пружина — в CSS.
 */
function bindMobileBottomSheet({ panelId, layoutId, isDemo }) {
  const panel = document.getElementById(panelId);
  if (!panel || panel.dataset.mobileSheetBound === "1") return;
  const layout = () => document.getElementById(layoutId);
  const mq = () => window.matchMedia("(max-width: 900px)").matches;

  let startY = 0;
  let startT = 0;
  let mode = "idle";
  let activeId = null;
  let fromOpenBtn = false;

  const isInteractiveOpen = (el) =>
    el && (el.closest(".open-object") || el.closest(".open-demo-object") || el.closest("a[href]"));

  const onPointerDown = (e) => {
    if (!mq() || e.button !== 0) return;
    const L = layout();
    if (!L) return;
    if (e.target.closest("button.close-left-panel")) return;
    startY = e.clientY;
    startT = getPanelTranslateY(panel);
    mode = "decide";
    activeId = e.pointerId;
    fromOpenBtn = Boolean(e.target.closest(".open-left-panel-btn--sheet, #openLeftPanelBtn, #openDemoLeftPanelBtn"));
  };

  const onPointerMove = (e) => {
    if (mode === "idle" || mode === "scroll") return;
    if (e.pointerId != null && e.pointerId !== activeId) return;
    if (!mq()) return;
    const rawDy = e.clientY - startY;
    if (mode === "decide" && Math.abs(rawDy) < 5) return;

    const scrollEl = panel.querySelector("[data-left-scroll]");
    if (mode === "decide" && scrollEl) {
      const st = scrollEl.scrollTop;
      const maxS = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      if (st > 2) {
        mode = "scroll";
        return;
      }
      const g0 = getSheetGeometry(panel);
      const sheetFullUp = g0 && startT < 8;
      if (st <= 2 && maxS > 2 && sheetFullUp && rawDy < 0) {
        mode = "scroll";
        return;
      }
      if (isInteractiveOpen(e.target) && !fromOpenBtn && Math.abs(rawDy) < 18) {
        return;
      }
    }
    if (mode === "decide") {
      mode = "sheet";
      e.preventDefault();
      try {
        panel.setPointerCapture(e.pointerId);
      } catch (_) {
        /* */
      }
      panel.classList.add("left-panel--sheet-live");
    }
    if (mode !== "sheet") return;
    const g = getSheetGeometry(panel);
    if (!g) return;
    const t = sheetRubber(startT + (e.clientY - startY), g);
    setPanelTranslateY(panel, t, false);
  };

  const onPointerUp = (e) => {
    const L = layout();

    if (mode === "scroll") {
      activeId = null;
      mode = "idle";
      fromOpenBtn = false;
      return;
    }

    if (
      mode === "decide" &&
      e.pointerId === activeId &&
      L?.classList.contains("collapsed") &&
      Math.abs(e.clientY - startY) < 10
    ) {
      const g0 = getSheetGeometry(panel);
      if (g0) {
        state.panelCollapsed = false;
        L.classList.remove("collapsed");
        const tOpen =
          state.panelSheetT != null
            ? clampSheetT(state.panelSheetT, g0)
            : g0.tMid;
        setPanelTranslateY(panel, tOpen, true);
        state.panelSheetT = tOpen;
        if (isDemo) {
          updateDemoOpenPanelButton();
        } else {
          updateMapOpenPanelButton();
        }
      }
      activeId = null;
      mode = "idle";
      fromOpenBtn = false;
      return;
    }

    if (mode === "sheet") {
      e.preventDefault();
      const rawT = getPanelTranslateY(panel);
      const g = getSheetGeometry(panel);
      if (g) {
        const snap = clampSheetT(rawT, g);
        const atPeek = snap >= g.tMax - 4;
        setPanelTranslateY(panel, snap, true);
        state.panelCollapsed = atPeek;
        if (!atPeek) {
          state.panelSheetT = snap;
        }
        const lay = layout();
        if (lay) {
          if (atPeek) lay.classList.add("collapsed");
          else lay.classList.remove("collapsed");
        }
        if (isDemo) {
          updateDemoOpenPanelButton();
        } else {
          updateMapOpenPanelButton();
        }
      }
    }
    if (e.pointerId === activeId) {
      try {
        if (mode === "sheet") {
          panel.releasePointerCapture(e.pointerId);
        }
      } catch (_) {
        /* */
      }
    }
    activeId = null;
    mode = "idle";
    fromOpenBtn = false;
    panel.classList.remove("left-panel--sheet-live");
  };

  const onPointerCancel = (e) => {
    if (e.pointerId === activeId) {
      if (mode === "scroll") {
        mode = "idle";
        fromOpenBtn = false;
        activeId = null;
        return;
      }
      if (mode === "sheet") {
        onPointerUp(e);
        return;
      }
    }
    mode = "idle";
    fromOpenBtn = false;
    activeId = null;
  };

  panel.addEventListener("pointerdown", onPointerDown);
  panel.addEventListener("pointermove", onPointerMove, { passive: false });
  panel.addEventListener("pointerup", onPointerUp);
  panel.addEventListener("pointercancel", onPointerCancel);
  panel.dataset.mobileSheetBound = "1";
}

function updateDemoOpenPanelButton() {
  const btn = document.getElementById("openDemoLeftPanelBtn");
  if (!btn) return;
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
  if (state.panelCollapsed) {
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-hidden", "false");
  } else {
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-hidden", "true");
  }
}

function mobileSheetSettleAfterRender(panel, layout) {
  if (!panel) return;
  if (!window.matchMedia("(max-width: 900px)").matches) {
    setPanelTranslateY(panel, 0, false);
    return;
  }
  requestAnimationFrame(() => {
    const g = getSheetGeometry(panel);
    if (!g) return;
    let t;
    if (state.panelCollapsed) t = g.tPeek;
    else if (state.panelSheetT != null) t = clampSheetT(state.panelSheetT, g);
    else t = g.tMid;
    setPanelTranslateY(panel, t, true);
  });
}

function mapCollapseLeftPanel() {
  state.panelCollapsed = true;
  const layout = document.getElementById("mapLayout");
  const p = document.getElementById("leftPanel");
  layout?.classList.add("collapsed");
  if (p) {
    p.classList.remove("left-panel--sheet-live");
    const g = getSheetGeometry(p);
    if (g) {
      setPanelTranslateY(p, g.tPeek, true);
    }
  }
  updateMapOpenPanelButton();
  ensureMapDrawControls();
  refreshMapViewport();
}

function openMapLeftPanel() {
  state.panelCollapsed = false;
  state.panelSheetT = null;
  const layout = document.getElementById("mapLayout");
  layout?.classList.remove("collapsed");
  const p = document.getElementById("leftPanel");
  if (p) p.classList.remove("left-panel--sheet-live");
  if (state.areaPolygonCoords?.length) {
    renderAreaSelectionPanel(getAreaFilteredProperties());
  } else {
    renderViewportPanel();
  }
  mobileSheetSettleAfterRender(p, layout);
  updateMapOpenPanelButton();
  ensureMapDrawControls();
  refreshMapViewport();
}

function setMapDefaultLeftPanel() {
  const panel = document.getElementById("leftPanel");
  if (!panel) return;
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
  mobileSheetSettleAfterRender(lp, document.getElementById("mapLayout"));
}

function demoCollapseLeftPanel() {
  state.panelCollapsed = true;
  const layout = document.getElementById("demoMapLayout");
  const p = document.getElementById("demoLeftPanel");
  layout?.classList.add("collapsed");
  if (p) {
    p.classList.remove("left-panel--sheet-live");
    const g = getSheetGeometry(p);
    if (g) {
      setPanelTranslateY(p, g.tPeek, true);
    }
  }
  updateDemoOpenPanelButton();
  ensureMapDrawControls();
  refreshMapViewport();
}

function renderDemoPanel(list, title) {
  const panel = document.getElementById("demoLeftPanel");
  if (!panel) return;
  const bodyHtml = list.length ? list.map(demoCardMarkup).join("") : `<p class="muted">Объекты не найдены.</p>`;
  panel.innerHTML = leftPanelMobileBlock(
    "demoLeftPanelHandleArea",
    `<div class="left-panel-head"><h3>${title}: ${list.length}</h3><button class="close-left-panel" id="closeDemoLeftPanel" aria-label="Свернуть панель">×</button></div>`,
    bodyHtml
  );
  document.getElementById("closeDemoLeftPanel")?.addEventListener("click", () => {
    demoCollapseLeftPanel();
  });
  bindDemoCardButtons(panel);
  mobileSheetSettleAfterRender(panel, document.getElementById("demoMapLayout"));
}

function getDemoViewportPropertyList() {
  const list = getAreaFilteredProperties();
  if (!state.mapInstance) return list;
  const bounds = state.mapInstance.getBounds();
  if (!bounds) return list;
  return list.filter((item) => isPointInsideBounds(Number(item.lat), Number(item.lon), bounds));
}

function renderDemoViewportPanel() {
  if (!state.mapInstance) return;
  const list = getDemoViewportPropertyList().sort((a, b) => b.commissionPartner - a.commissionPartner);
  renderDemoPanel(list, "Объекты в видимой области");
}

function renderDemoAreaSelectionPanel() {
  const list = getAreaFilteredProperties().sort((a, b) => b.commissionPartner - a.commissionPartner);
  renderDemoPanel(list, "В выбранной области");
}

function showDemoGroup(properties) {
  state.panelCollapsed = false;
  state.panelSheetT = null;
  document.getElementById("demoMapLayout")?.classList.remove("collapsed");
  updateDemoOpenPanelButton();
  refreshMapViewport();
  const sorted = properties.slice().sort((a, b) => b.commissionPartner - a.commissionPartner);
  renderDemoPanel(sorted, "Объектов в точке");
}

function applyDemoFilters() {
  if (!state.demoAllProperties || !state.demoAllProperties.length) {
    state.demoAllProperties = createDemoProperties(100);
  }
  state.properties = filterPropertiesByState(state.demoAllProperties);
  if (window.ymaps) {
    ymaps.ready(() => initDemoMap());
  } else {
    setTimeout(applyDemoFilters, 200);
  }
}

function renderPublicDemoPage() {
  setMapBodyClass(true);
  if (state.demoDataVersion !== CURRENT_DEMO_DATA_VERSION) {
    state.demoAllProperties = null;
    state.demoDataVersion = CURRENT_DEMO_DATA_VERSION;
  }
  if (!state.demoAllProperties || !state.demoAllProperties.length) {
    state.demoAllProperties = createDemoProperties(100);
  }
  state.properties = filterPropertiesByState(state.demoAllProperties);
  state.panelCollapsed = false;

  app.innerHTML = `
    <section class="demo-page">
      ${demoPublicTopbar()}
      <div class="demo-top-strip" id="demoTopStrip" aria-label="Справка по демо">
        <p class="demo-top-strip__line">
          <strong>Демо</strong> · 100 точек · список снизу: тяните панель, нажмите метку или обведите район ✍
        </p>
        <button type="button" class="btn demo-top-strip__open" id="demoAboutOpen">О демо</button>
      </div>
      <main class="map-layout demo-map-layout map-layout--app-sheet ${state.panelCollapsed ? "collapsed" : ""}" id="demoMapLayout">
        <aside class="left-panel" id="demoLeftPanel"></aside>
        <div class="map-wrap demo-map-wrap">
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
          <div class="map-draw-tools">
            <button class="map-draw-btn" type="button" id="mapDrawAreaBtn" title="Рисовать область">✍</button>
          </div>
          <div class="map-sheet-left-scrim" id="demoLeftPanelScrim" aria-hidden="true"></div>
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
  document.getElementById("mapDrawAreaBtn")?.addEventListener("click", startAreaDrawing);
  ensureMapDrawControls();

  document.getElementById("moreFilters")?.addEventListener("click", () => {
    document.getElementById("filtersModal")?.classList.add("open");
  });
  document.getElementById("closeModal")?.addEventListener("click", () => {
    document.getElementById("filtersModal")?.classList.remove("open");
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
    state.filters.floorMin = document.getElementById("filterFloorMin")?.value.trim() || "";
    state.filters.floorMax = document.getElementById("filterFloorMax")?.value.trim() || "";
    state.filters.totalFloorsMin = document.getElementById("filterTotalFloorsMin")?.value.trim() || "";
    state.filters.totalFloorsMax = document.getElementById("filterTotalFloorsMax")?.value.trim() || "";
    state.filters.ceilingHeightMin = document.getElementById("filterCeilingMin")?.value.trim() || "";
    state.filters.finishing = document.getElementById("filterFinishing")?.value || "";
    state.filters.readiness = document.getElementById("filterReadiness")?.value || "";
    document.getElementById("filtersModal")?.classList.remove("open");
    applyDemoFilters();
  });
  document.getElementById("resetMoreFilters")?.addEventListener("click", () => {
    state.filters.floorMin = "";
    state.filters.floorMax = "";
    state.filters.totalFloorsMin = "";
    state.filters.totalFloorsMax = "";
    state.filters.ceilingHeightMin = "";
    state.filters.finishing = "";
    state.filters.readiness = "";
    document.getElementById("filterFloorMin").value = "";
    document.getElementById("filterFloorMax").value = "";
    document.getElementById("filterTotalFloorsMin").value = "";
    document.getElementById("filterTotalFloorsMax").value = "";
    document.getElementById("filterCeilingMin").value = "";
    document.getElementById("filterFinishing").value = "";
    document.getElementById("filterReadiness").value = "";
    document.getElementById("filtersModal")?.classList.remove("open");
    applyDemoFilters();
  });

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
    state.filters = {
      minPrice: "",
      maxPrice: "",
      bedrooms: "",
      floorMin: "",
      floorMax: "",
      totalFloorsMin: "",
      totalFloorsMax: "",
      ceilingHeightMin: "",
      finishing: "",
      readiness: ""
    };
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
      document.getElementById("filterFinishing").value = "";
      document.getElementById("filterReadiness").value = "";
    }
  });

  document.getElementById("demoAuthLogin")?.addEventListener("click", () => {
    location.hash = "#/auth-form";
  });
  document.getElementById("demoAuthRegister")?.addEventListener("click", () => {
    location.hash = "#/auth-register";
  });

  applyDemoFilters();
  function openDemoLeftPanel() {
    state.panelCollapsed = false;
    state.panelSheetT = null;
    const layout = document.getElementById("demoMapLayout");
    layout?.classList.remove("collapsed");
    const p = document.getElementById("demoLeftPanel");
    if (p) p.classList.remove("left-panel--sheet-live");
    if (state.areaPolygonCoords?.length) {
      renderDemoAreaSelectionPanel();
    } else {
      renderDemoViewportPanel();
    }
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

  const demoP = document.getElementById("demoLeftPanel");
  const demoLayout = document.getElementById("demoMapLayout");
  updateDemoOpenPanelButton();
  bindMobileBottomSheet({ panelId: "demoLeftPanel", layoutId: "demoMapLayout", isDemo: true });
  mobileSheetSettleAfterRender(demoP, demoLayout);
}

function renderDemoPropertyPage(id) {
  setMapBodyClass(false);
  if (!state.demoAllProperties || !state.demoAllProperties.length) {
    state.demoAllProperties = createDemoProperties(100);
  }
  const property = state.demoAllProperties.find((item) => item.id === id) || state.demoAllProperties[0];
  const galleryPhotos = (property.photos || []).length ? property.photos : [PLACEHOLDER_IMAGE_URL];
  app.innerHTML = `
    <section class="page">
      <p><button class="btn" id="backToDemoBtn">← Назад к демо-карте</button></p>
      <div class="grid-2">
        <div class="panel">
          <h2>${property.title}</h2>
          <div class="gallery">
            ${galleryPhotos
              .map((photo) => `<img src="${photoUrlWithFallback(photo)}" onerror="${photoOnErrorAttr()}" alt="Фото демо-объекта" />`)
              .join("")}
          </div>
          <p>${property.description || ""}</p>
        </div>
        <aside class="panel">
          <h3>${money(property.price)} ₽</h3>
          <p><strong>Адрес:</strong> ${property.address}</p>
          <p><strong>Площадь:</strong> ${property.area} м²</p>
          <p><strong>Спален:</strong> ${property.bedrooms}</p>
          <p><strong>Общая комиссия:</strong> ${property.commissionTotal}%</p>
          <p><strong>Партнеру:</strong> ${property.commissionPartner}%</p>
          <p class="demo-blur-line"><strong>Телефон:</strong> ${property.contacts?.phone || "+7 (9••) •••-••-••"}</p>
          <p class="demo-blur-line"><strong>Telegram:</strong> ${property.contacts?.telegram || "@••••••••"}</p>
          <p><button class="btn primary" id="demoToAuthBtn">Попробовать платформу</button></p>
        </aside>
      </div>
    </section>
  `;
  document.getElementById("backToDemoBtn")?.addEventListener("click", () => {
    location.hash = "#/";
  });
  document.getElementById("demoToAuthBtn")?.addEventListener("click", () => {
    location.hash = "#/auth-register";
  });
}

function renderMapPage() {
  setMapBodyClass(true);
  app.innerHTML = `
    <section class="map-page">
    ${topbar()}
    <main class="map-layout map-layout--app-sheet ${state.panelCollapsed ? "collapsed" : ""}" id="mapLayout">
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
      <div class="map-wrap">
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
        <div class="map-draw-tools">
          <button class="map-draw-btn" id="mapDrawAreaBtn" title="Рисовать область">✍</button>
        </div>
        <div class="map-sheet-left-scrim" id="mapLeftPanelScrim" aria-hidden="true"></div>
      </div>
    </main>
    </section>
    ${moreFiltersModalHtml()}
  `;

  bindBrandHomeButton();
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
  document.getElementById("closeModal").addEventListener("click", () => {
    document.getElementById("filtersModal").classList.remove("open");
  });
  document.getElementById("applyMoreFilters").addEventListener("click", () => {
    state.filters.floorMin = document.getElementById("filterFloorMin").value.trim();
    state.filters.floorMax = document.getElementById("filterFloorMax").value.trim();
    state.filters.totalFloorsMin = document.getElementById("filterTotalFloorsMin").value.trim();
    state.filters.totalFloorsMax = document.getElementById("filterTotalFloorsMax").value.trim();
    state.filters.ceilingHeightMin = document.getElementById("filterCeilingMin").value.trim();
    state.filters.finishing = document.getElementById("filterFinishing").value;
    state.filters.readiness = document.getElementById("filterReadiness").value;
    document.getElementById("filtersModal").classList.remove("open");
    loadMapData();
  });
  document.getElementById("resetMoreFilters").addEventListener("click", () => {
    state.filters.floorMin = "";
    state.filters.floorMax = "";
    state.filters.totalFloorsMin = "";
    state.filters.totalFloorsMax = "";
    state.filters.ceilingHeightMin = "";
    state.filters.finishing = "";
    state.filters.readiness = "";
    document.getElementById("filtersModal").classList.remove("open");
    renderMapPage();
  });
  document.getElementById("closeLeftPanel")?.addEventListener("click", mapCollapseLeftPanel);
  document.getElementById("openLeftPanelBtn")?.addEventListener("click", openMapLeftPanel);
  document.getElementById("mapLeftPanelScrim")?.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      mapCollapseLeftPanel();
    }
  });
  const lp = document.getElementById("leftPanel");
  const mapLayout = document.getElementById("mapLayout");
  bindMobileBottomSheet({ panelId: "leftPanel", layoutId: "mapLayout", isDemo: false });
  mobileSheetSettleAfterRender(lp, mapLayout);
  document.getElementById("mapDrawAreaBtn")?.addEventListener("click", startAreaDrawing);
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
    state.filters.minPrice = "";
    state.filters.maxPrice = "";
    state.filters.bedrooms = "";
    state.filters.floorMin = "";
    state.filters.floorMax = "";
    state.filters.totalFloorsMin = "";
    state.filters.totalFloorsMax = "";
    state.filters.ceilingHeightMin = "";
    state.filters.finishing = "";
    state.filters.readiness = "";
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
  const panel = document.getElementById("leftPanel");
  if (!panel) return;
  const bodyHtml = list.length ? list.map(cardMarkup).join("") : `<p class="muted">Внутри области объекты не найдены.</p>`;
  panel.innerHTML = leftPanelMobileBlock(
    "mapLeftPanelHandleArea",
    `<div class="left-panel-head"><h3>В выбранной области: ${list.length}</h3><button class="close-left-panel" id="closeLeftPanel" aria-label="Свернуть панель">×</button></div>`,
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
  mobileSheetSettleAfterRender(panel, document.getElementById("mapLayout"));
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
  const panel = document.getElementById("leftPanel");
  if (!panel) return;
  const list = getViewportProperties().sort((a, b) => b.commissionPartner - a.commissionPartner);
  const bodyHtml = list.length ? list.map(cardMarkup).join("") : `<p class="muted">В текущей области объекты не найдены.</p>`;
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
  mobileSheetSettleAfterRender(panel, document.getElementById("mapLayout"));
}

function syncDrawButtons() {
  const drawBtn = document.getElementById("mapDrawAreaBtn");
  const drawCanvas = document.getElementById("mapDrawCanvas");
  if (!drawBtn) return;
  drawBtn.classList.toggle("active", state.areaDrawMode);
  drawBtn.title = state.areaDrawMode ? "Режим рисования включен" : "Рисовать область";
  if (drawCanvas) {
    drawCanvas.classList.toggle("active", state.areaDrawMode);
  }
}

function setDemoDefaultLeftPanel() {
  const panel = document.getElementById("demoLeftPanel");
  if (!panel) return;
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
  const floorMin = Number(state.filters.floorMin || 0);
  const floorMax = Number(state.filters.floorMax || Number.MAX_SAFE_INTEGER);
  const totalFloorsMin = Number(state.filters.totalFloorsMin || 0);
  const totalFloorsMax = Number(state.filters.totalFloorsMax || Number.MAX_SAFE_INTEGER);
  const ceilingHeightMin = Number(state.filters.ceilingHeightMin || 0);
  return list.filter((item) => {
    const price = Number(item.price || 0);
    if (price < minP || price > maxP) return false;
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
    return byFloor && byTotalFloors && byCeiling && byFinishing && byReadiness;
  });
}

async function loadMapData() {
  const query = new URLSearchParams();
  if (state.filters.minPrice) query.append("minPrice", toRawNumberString(state.filters.minPrice));
  if (state.filters.maxPrice) query.append("maxPrice", toRawNumberString(state.filters.maxPrice));
  if (state.filters.bedrooms) query.append("bedrooms", state.filters.bedrooms);
  const list = await api(`/api/properties?${query.toString()}`);
  state.properties = filterPropertiesByState(list);
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

function groupByHouse(list) {
  const groupedMap = {};
  for (const item of list) {
    const addressKey = normalizeAddressKey(item.address);
    const fallbackKey = `${Number(item.lat || 0).toFixed(5)}:${Number(item.lon || 0).toFixed(5)}`;
    const key = addressKey || fallbackKey;
    if (!groupedMap[key]) groupedMap[key] = [];
    groupedMap[key].push(item);
  }
  return Object.values(groupedMap);
}

function showGroup(properties) {
  state.panelCollapsed = false;
  state.panelSheetT = null;
  document.getElementById("mapLayout")?.classList.remove("collapsed");
  refreshMapViewport();
  const panel = document.getElementById("leftPanel");
  if (!panel) return;
  properties.sort((a, b) => b.commissionPartner - a.commissionPartner);
  const bodyHtml = properties.map(cardMarkup).join("");
  panel.innerHTML = leftPanelMobileBlock(
    "mapLeftPanelHandleArea",
    `<div class="left-panel-head"><h3>Объектов в точке: ${properties.length}</h3><button class="close-left-panel" id="closeLeftPanel" aria-label="Свернуть панель">×</button></div>`,
    bodyHtml
  );
  document.getElementById("closeLeftPanel")?.addEventListener("click", () => {
    mapCollapseLeftPanel();
  });
  updateMapOpenPanelButton();
  mobileSheetSettleAfterRender(panel, document.getElementById("mapLayout"));
  ensureMapDrawControls();
  panel.querySelectorAll(".open-object").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#/property/${btn.dataset.id}`;
    });
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
      if (state.panelCollapsed) return;
      if (state.viewportUpdateTimer) {
        clearTimeout(state.viewportUpdateTimer);
      }
      state.viewportUpdateTimer = setTimeout(() => {
        if (state.areaPolygonCoords?.length) {
          renderAreaSelectionPanel(getAreaFilteredProperties());
        } else {
          renderViewportPanel();
        }
      }, 120);
    });

    let clusterer = null;
    try {
      clusterer = new ymaps.Clusterer({
        groupByCoordinates: false,
        gridSize: 72,
        hasBalloon: false
      });
    } catch (_) {
      /* */
    }
    grouped.forEach((group) => {
      const top = group.sort((a, b) => b.commissionPartner - a.commissionPartner)[0];
      const placemark = new ymaps.Placemark(
        [top.lat, top.lon],
        {
          balloonContent: `${group.length} объект(а)`,
          hintContent: `${group.length} объект(а) по адресу`,
          iconContent: String(group.length)
        },
        {
          preset: top.commissionPartner >= 4 ? "islands#orangeCircleIcon" : "islands#blueCircleIcon"
        }
      );
      placemark.events.add("click", () => showGroup(group));
      if (clusterer) {
        clusterer.add(placemark);
      } else {
        map.geoObjects.add(placemark);
      }
    });
    if (clusterer) {
      map.geoObjects.add(clusterer);
    }

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
      if (!state.panelCollapsed) {
        renderAreaSelectionPanel(getAreaFilteredProperties());
      }
    } else {
      state.areaPolygonObject = null;
      if (!state.panelCollapsed) {
        renderViewportPanel();
      }
    }
    {
      const lp = document.getElementById("leftPanel");
      const ml = document.getElementById("mapLayout");
      if (lp && ml) {
        mobileSheetSettleAfterRender(lp, ml);
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
      if (state.panelCollapsed) return;
      if (state.viewportUpdateTimer) {
        clearTimeout(state.viewportUpdateTimer);
      }
      state.viewportUpdateTimer = setTimeout(() => {
        if (state.areaPolygonCoords?.length) {
          renderDemoAreaSelectionPanel();
        } else {
          renderDemoViewportPanel();
        }
      }, 120);
    });

    let clusterer = null;
    try {
      clusterer = new ymaps.Clusterer({
        groupByCoordinates: false,
        gridSize: 72,
        hasBalloon: false
      });
    } catch (_) {
      /* без кластера, если API недоступен */
    }
    grouped.forEach((group) => {
      const top = group.sort((a, b) => b.commissionPartner - a.commissionPartner)[0];
      const placemark = new ymaps.Placemark(
        [top.lat, top.lon],
        {
          balloonContent: `${group.length} объект(а)`,
          hintContent: `${group.length} объект(а) по адресу`,
          iconContent: String(group.length)
        },
        {
          preset: top.commissionPartner >= 4 ? "islands#orangeCircleIcon" : "islands#blueCircleIcon"
        }
      );
      placemark.events.add("click", () => showDemoGroup(group));
      if (clusterer) {
        clusterer.add(placemark);
      } else {
        map.geoObjects.add(placemark);
      }
    });
    if (clusterer) {
      map.geoObjects.add(clusterer);
    }

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
      if (!state.panelCollapsed) {
        renderDemoAreaSelectionPanel();
      }
    } else {
      state.areaPolygonObject = null;
      if (!state.panelCollapsed) {
        renderDemoViewportPanel();
      }
    }
    {
      const lp = document.getElementById("demoLeftPanel");
      const ml = document.getElementById("demoMapLayout");
      if (lp && ml) {
        mobileSheetSettleAfterRender(lp, ml);
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
  app.innerHTML = `
    ${topbar()}
    <section class="page">
      <p><button class="btn" id="goBack">← На карту</button></p>
      <div class="grid-2">
        <div class="panel">
          <h2>${property.title || "Объект"}</h2>
          <div class="gallery">
            ${galleryPhotos
              .map(
                (photo, index) =>
                  `<img src="${photoUrlWithFallback(photo)}" onerror="${photoOnErrorAttr()}" alt="Фото объекта" data-gallery-index="${index}" />`
              )
              .join("")}
          </div>
          <p>${property.description || ""}</p>
        </div>
        <aside class="panel">
          <h3>${money(property.price)} ₽</h3>
          <p><strong>Адрес:</strong> ${property.address}</p>
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
              ? `<p><a href="${property.pdfUrl}?v=${encodeURIComponent(property.id || "")}-${Date.now()}" target="_blank" class="btn" id="downloadPdfBtn">Скачать презентацию PDF</a></p>`
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
    <div class="gallery-lightbox" id="galleryLightbox">
      <button class="gallery-lightbox-close" id="galleryCloseBtn" aria-label="Закрыть">×</button>
      <button class="gallery-lightbox-nav" id="galleryPrevBtn" aria-label="Предыдущее фото">‹</button>
      <img id="galleryLightboxImage" class="gallery-lightbox-image" src="${photoUrlWithFallback(galleryPhotos[0])}" alt="Фото объекта" />
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
    link.textContent = "Обновление PDF...";
    link.style.pointerEvents = "none";
    try {
      const data = await api(`/api/my/properties/${id}/generate-pdf`, { method: "POST" });
      const freshUrl = `${data.pdfUrl}?v=${encodeURIComponent(id || "")}-${Date.now()}`;
      window.open(freshUrl, "_blank", "noopener,noreferrer");
      await renderPropertyPage(id);
    } catch (_error) {
      link.textContent = originalText || "Скачать презентацию PDF";
      link.style.pointerEvents = "";
    }
  });
  document.getElementById("addObjectBtn")?.addEventListener("click", () => {
    location.hash = state.user ? "#/cabinet/add" : "#/auth";
  });
  document.getElementById("cabinetBtn")?.addEventListener("click", () => (location.hash = "#/cabinet"));
  document.getElementById("adminBtn")?.addEventListener("click", () => (location.hash = "#/admin"));
  document.getElementById("agencyBtn")?.addEventListener("click", () => (location.hash = "#/agency"));

  let currentGalleryIndex = 0;
  const lightbox = document.getElementById("galleryLightbox");
  const lightboxImage = document.getElementById("galleryLightboxImage");
  const galleryCounter = document.getElementById("galleryCounter");
  const updateLightbox = () => {
    const url = photoUrlWithFallback(galleryPhotos[currentGalleryIndex]);
    lightboxImage.src = url;
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

function renderAuthPage() {
  setMapBodyClass(false);
  app.innerHTML = `
    <section class="login-page">
      <div class="login-wrapper">
        <div class="login-box">
          <h3>Вход</h3>
          <input id="loginEmail" placeholder="Email" type="email" autocomplete="username email" />
          <input id="loginPassword" type="password" placeholder="Пароль" autocomplete="current-password" />
          <button class="btn primary full" id="login">Войти</button>
          <button class="btn full" type="button" id="toDemoMapBtn">К демо без входа</button>
          <button class="btn full" id="openRegister">Регистрация</button>
          <button class="btn full" id="openReset">Забыли пароль?</button>
          <p class="muted" id="authStatus"></p>
        </div>
      </div>

      <div class="auth-modal" id="registerModal">
        <div class="auth-modal-content">
          <h3>Регистрация</h3>
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
          <label class="field-label" for="agency" id="agencyFieldLabel">Самозанятый/ИП (обязательно)</label>
          <input id="agency" placeholder="Агентство / ИП (обязательно для агентства)" />
          <p class="note">* ИП / юрлица должны иметь соответствующие ОКВЭД для операций с недвижимостью</p>
          <input id="inn" placeholder="ИНН (10 или 12 цифр)" inputmode="numeric" />
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
            <button class="btn primary full" id="register">Создать аккаунт</button>
            <button class="btn full" id="closeRegister">Закрыть</button>
          </p>
        </div>
      </div>

      <div class="auth-modal" id="resetModal">
        <div class="auth-modal-content">
          <h3>Восстановление пароля</h3>
          <input id="resetEmail" placeholder="Введите email" type="email" />
          <p>
            <button class="btn primary full" id="forgot">Отправить ссылку</button>
            <button class="btn full" id="closeReset">Закрыть</button>
          </p>
        </div>
      </div>
    </section>
  `;

  const toDemoEl = document.getElementById("toDemoMapBtn");
  if (toDemoEl) {
    toDemoEl.textContent = state.token ? "На карту" : "К демо без входа";
    toDemoEl.addEventListener("click", () => {
      location.hash = "#/";
    });
  }
  document.getElementById("openRegister").addEventListener("click", () => {
    document.getElementById("registerModal").classList.add("active");
  });
  document.getElementById("closeRegister").addEventListener("click", () => {
    document.getElementById("registerModal").classList.remove("active");
  });
  document.getElementById("openReset").addEventListener("click", () => {
    document.getElementById("resetModal").classList.add("active");
  });
  document.getElementById("closeReset").addEventListener("click", () => {
    document.getElementById("resetModal").classList.remove("active");
  });

  const updateRegisterFormByType = () => {
    const type = document.getElementById("accountType").value;
    const agencyInput = document.getElementById("agency");
    const label = document.getElementById("agencyFieldLabel");
    agencyInput.placeholder =
      type === "agency_owner" ? "Название агентства (обязательно)" : "Самозанятый/ИП (обязательно)";
    if (label) {
      label.textContent = type === "agency_owner" ? "Название агентства (обязательно)" : "Самозанятый/ИП (обязательно)";
    }
  };
  document.getElementById("accountType").addEventListener("change", updateRegisterFormByType);
  updateRegisterFormByType();

  document.getElementById("register").addEventListener("click", async () => {
    try {
      const payload = collectAuth();
      if (
        !payload.email ||
        !payload.password ||
        !payload.firstName ||
        !payload.lastName ||
        !payload.agency ||
        !payload.inn ||
        !payload.phone
      ) {
        throw new Error("Заполните все обязательные поля");
      }
      if (!/^\+7\d{10}$/.test(payload.phone)) {
        throw new Error("Телефон должен быть в формате +7 и 10 цифр");
      }
      if (!/^\d{10}$|^\d{12}$/.test(payload.inn)) {
        throw new Error("ИНН должен содержать 10 или 12 цифр");
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
      setAuth(data);
      location.hash = "#/";
    } catch (error) {
      document.getElementById("authStatus").textContent = error.message;
    }
  });

  document.getElementById("login").addEventListener("click", async () => {
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("loginEmail").value,
          password: document.getElementById("loginPassword").value
        })
      });
      setAuth(data);
      location.hash = "#/";
    } catch (error) {
      document.getElementById("authStatus").textContent = error.message;
    }
  });

  document.getElementById("forgot").addEventListener("click", async () => {
    const data = await api("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: document.getElementById("resetEmail").value })
    });
    document.getElementById("authStatus").textContent = data.message;
    document.getElementById("resetModal").classList.remove("active");
  });
}

function collectAuth() {
  const phoneDigits = toDigits(document.getElementById("phone").value);
  const innDigits = toDigits(document.getElementById("inn").value);
  return {
    accountType: document.getElementById("accountType").value === "agency_owner" ? "agency_owner" : "broker",
    firstName: document.getElementById("firstName").value.trim(),
    lastName: document.getElementById("lastName").value.trim(),
    name: `${document.getElementById("firstName").value.trim()} ${document.getElementById("lastName").value.trim()}`.trim(),
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value,
    phone: `+7${phoneDigits}`,
    agency: document.getElementById("agency").value.trim(),
    inn: innDigits,
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
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

async function renderCabinetPage(openForm = false) {
  setMapBodyClass(false);
  if (!state.token) {
    renderAuthPage();
    return;
  }
  const [items, stats] = await Promise.all([api("/api/my/properties"), api("/api/my/stats")]);
  app.innerHTML = `
    ${topbar()}
    <section class="cabinet">
      <div class="panel">
        <div class="panel-head">
          <div class="cabinet-head-main">
            <h2>${state.user?.isAgencyOwner ? "Личный кабинет агентства" : "Личный кабинет брокера"}</h2>
            <button class="btn" id="openChangePasswordModal">Сменить пароль</button>
            <button class="btn" id="logoutCabinet">Выйти из личного кабинета</button>
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
            <img src="${photoUrlWithFallback(p.photos?.[0])}" onerror="${photoOnErrorAttr()}" alt="">
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
              <input id="bedroomsInput" name="bedrooms" type="number" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="floorInput">Этаж</label>
              <input id="floorInput" name="floor" type="number" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="totalFloorsInput">Этажей в доме</label>
              <input id="totalFloorsInput" name="totalFloors" type="number" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="ceilingHeightInput">Высота потолков (м)</label>
              <input id="ceilingHeightInput" name="ceilingHeight" type="number" step="0.1" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="commissionTotalInput">Общая комиссия (%)</label>
              <input id="commissionTotalInput" name="commissionTotal" type="number" step="0.1" required />
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
              <label class="field-label" for="commissionPartnerInput">Комиссия партнеру (%)</label>
              <input id="commissionPartnerInput" name="commissionPartner" type="number" step="0.1" required />
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
    <div class="modal" id="changePasswordModal">
      <div class="modal-card">
        <div class="panel-head">
          <h3>Смена пароля</h3>
          <button class="close-panel-action" id="closeChangePasswordModal" aria-label="Закрыть">×</button>
        </div>
        <div class="form-grid">
          <div class="field-block field-span-2">
            <label class="field-label" for="oldPasswordInput">Старый пароль</label>
            <input id="oldPasswordInput" type="password" placeholder="Введите текущий пароль" />
          </div>
          <div class="field-block">
            <label class="field-label" for="newPasswordInput">Новый пароль</label>
            <input id="newPasswordInput" type="password" placeholder="Минимум 6 символов" />
          </div>
          <div class="field-block">
            <label class="field-label" for="newPasswordConfirmInput">Повтор нового пароля</label>
            <input id="newPasswordConfirmInput" type="password" placeholder="Повторите новый пароль" />
          </div>
        </div>
        <p><button class="btn primary" type="button" id="changePasswordBtn">Сменить пароль</button></p>
        <p class="muted" id="passwordStatus"></p>
      </div>
    </div>
  `;
  bindBrandHomeButton();
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
  document.getElementById("logoutCabinet").addEventListener("click", () => {
    logout();
    location.hash = "#/auth";
  });
  const changePasswordModal = document.getElementById("changePasswordModal");
  const closeChangePasswordModal = () => {
    changePasswordModal?.classList.remove("open");
  };
  document.getElementById("openChangePasswordModal")?.addEventListener("click", () => {
    changePasswordModal?.classList.add("open");
    document.getElementById("passwordStatus").textContent = "";
  });
  document.getElementById("closeChangePasswordModal")?.addEventListener("click", closeChangePasswordModal);
  changePasswordModal?.addEventListener("click", (event) => {
    if (event.target === changePasswordModal) closeChangePasswordModal();
  });
  document.getElementById("changePasswordBtn")?.addEventListener("click", async () => {
    const oldPassword = document.getElementById("oldPasswordInput").value;
    const newPassword = document.getElementById("newPasswordInput").value;
    const confirmPassword = document.getElementById("newPasswordConfirmInput").value;
    const status = document.getElementById("passwordStatus");
    status.textContent = "";
    if (!oldPassword || !newPassword || !confirmPassword) {
      status.textContent = "Заполните все поля смены пароля";
      return;
    }
    if (newPassword.length < 6) {
      status.textContent = "Новый пароль должен быть не менее 6 символов";
      return;
    }
    if (newPassword !== confirmPassword) {
      status.textContent = "Новый пароль и подтверждение не совпадают";
      return;
    }
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword })
      });
      status.textContent = "Пароль успешно изменен";
      document.getElementById("oldPasswordInput").value = "";
      document.getElementById("newPasswordInput").value = "";
      document.getElementById("newPasswordConfirmInput").value = "";
      setTimeout(() => {
        closeChangePasswordModal();
      }, 500);
    } catch (err) {
      status.textContent = err.message || "Ошибка смены пароля";
    }
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
    form.elements.bedrooms.value = property.bedrooms ?? "";
    form.elements.floor.value = property.floor ?? "";
    form.elements.totalFloors.value = property.totalFloors ?? "";
    form.elements.ceilingHeight.value = property.ceilingHeight ?? "";
    form.elements.commissionTotal.value = property.commissionTotal ?? "";
    form.elements.finishing.value = property.finishing || "";
    form.elements.readiness.value = property.readiness || "";
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
    `;
    document.getElementById("agencyErrToMap").addEventListener("click", () => (location.hash = "#/"));
    return;
  }

  const brokers = Array.isArray(agencyData.brokers) ? agencyData.brokers : [];
  const assignOptions = [
    {
      id: state.user.id,
      label: `Агентство (${state.user.agency || state.user.email || "владелец"})`
    },
    ...brokers.map((b) => ({
      id: b.id,
      label: `${b.email}${b.name ? ` (${b.name})` : ""}`
    }))
  ];
  const rows = brokers
    .map(
      (b) => `<tr>
      <td>${escapeHtml(b.email)}</td>
      <td>${escapeHtml(b.name || "—")}</td>
      <td>${escapeHtml(b.phone || "—")}</td>
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
      <p class="muted">Вы можете добавлять логины брокеров агентства и удалять их при необходимости.</p>
      <p class="muted">Лимит: <strong>${agencyData.brokerCount} / ${agencyData.brokerLimit || "∞"}</strong></p>

      <div class="panel">
        <h3>Добавить брокера</h3>
        <div class="form-grid">
          <div class="field-block">
            <label class="field-label" for="agencyBrokerFirstName">Имя</label>
            <input id="agencyBrokerFirstName" placeholder="Иван" />
          </div>
          <div class="field-block">
            <label class="field-label" for="agencyBrokerLastName">Фамилия</label>
            <input id="agencyBrokerLastName" placeholder="Иванов" />
          </div>
          <div class="field-block">
            <label class="field-label" for="agencyBrokerEmail">Email</label>
            <input id="agencyBrokerEmail" type="email" placeholder="broker@agency.ru" />
          </div>
          <div class="field-block">
            <label class="field-label" for="agencyBrokerPassword">Пароль</label>
            <input id="agencyBrokerPassword" type="password" placeholder="минимум 6 символов" />
          </div>
          <div class="field-block field-span-2">
            <label class="field-label" for="agencyBrokerPhone">Телефон</label>
            <div class="phone-group">
              <span>+7</span>
              <input id="agencyBrokerPhone" placeholder="9991234567" maxlength="10" inputmode="numeric" />
            </div>
          </div>
        </div>
        <p><button class="btn primary" type="button" id="agencyCreateBrokerBtn">Создать брокера</button></p>
        <p class="muted" id="agencyStatus"></p>
      </div>

      <div class="panel">
        <h3>Брокеры агентства: ${brokers.length}</h3>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Имя</th>
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
  `;

  bindBrandHomeButton();
  document.getElementById("adminBtn")?.addEventListener("click", () => (location.hash = "#/admin"));
  document.getElementById("agencyBtn")?.addEventListener("click", () => (location.hash = "#/agency"));
  document.getElementById("toMapBtn")?.addEventListener("click", () => (location.hash = "#/"));
  document.getElementById("cabinetBtn")?.addEventListener("click", () => (location.hash = "#/cabinet"));

  document.getElementById("agencyCreateBrokerBtn")?.addEventListener("click", async () => {
    const firstName = document.getElementById("agencyBrokerFirstName").value.trim();
    const lastName = document.getElementById("agencyBrokerLastName").value.trim();
    const email = document.getElementById("agencyBrokerEmail").value.trim();
    const password = document.getElementById("agencyBrokerPassword").value;
    const phone = `+7${toDigits(document.getElementById("agencyBrokerPhone").value)}`;
    const status = document.getElementById("agencyStatus");
    status.textContent = "";
    if (!firstName || !lastName || !email || !password || !/^\+7\d{10}$/.test(phone)) {
      status.textContent = "Заполните все поля и укажите корректный телефон";
      return;
    }
    try {
      await api("/api/agency/brokers", {
        method: "POST",
        body: JSON.stringify({ firstName, lastName, email, password, phone })
      });
      await renderAgencyPage();
    } catch (err) {
      status.textContent = err.message || "Ошибка создания брокера";
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
    `;
    document.getElementById("adminErrToMap").addEventListener("click", () => {
      location.hash = "#/";
    });
    return;
  }

  const agencyRows = agencies
    .map(
      (a) => `<tr>
      <td>${escapeHtml(a.agency || "—")}</td>
      <td>${escapeHtml(a.email || "—")}</td>
      <td>${a.brokerCount}</td>
      <td>${a.brokerLimit}</td>
      <td>
        <button class="btn admin-open-agency" data-id="${escapeHtml(a.id)}" type="button">Открыть</button>
        <button class="btn danger-btn admin-del-agency" data-id="${escapeHtml(a.id)}" data-email="${escapeHtml(a.email || "")}" type="button">Удалить</button>
      </td>
    </tr>`
    )
    .join("");

  const usersRows = privateBrokers
    .map(
      (u) => `<tr>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.name || "—")}</td>
      <td>${escapeHtml(u.agency || "—")}</td>
      <td>${escapeHtml(u.phone || "—")}</td>
      <td>${u.role === "admin" ? "admin" : "брокер"}</td>
      <td class="muted">${escapeHtml((u.createdAt || "").slice(0, 10))}</td>
      <td>
        <button class="btn admin-open-user" data-id="${escapeHtml(u.id)}" type="button">Открыть</button>
        ${
          u.role === "admin"
            ? `<span class="muted">—</span>`
            : `<button class="btn danger-btn admin-del-user" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}" type="button">Удалить</button>`
        }
      </td>
    </tr>`
    )
    .join("");

  const propRows = properties
    .map(
      (p) => `<tr>
      <td><code>${escapeHtml(p.id)}</code></td>
      <td>${escapeHtml(p.address || "—")}</td>
      <td>${money(p.price)} ₽</td>
      <td>${escapeHtml(p.ownerEmail)}</td>
      <td class="muted">${escapeHtml((p.createdAt || "").slice(0, 10))}</td>
      <td>
        <a class="btn" href="#/property/${encodeURIComponent(p.id)}">Открыть</a>
        <button class="btn danger-btn admin-del-prop" data-id="${escapeHtml(p.id)}" type="button">Удалить</button>
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
        <div class="address-row">
          <input id="adminAgencySearchInput" placeholder="Поиск агентства: email, имя, название" />
          <button class="btn" type="button" id="adminAgencySearchBtn">Найти</button>
        </div>
        <div class="admin-table-wrap" style="margin-top:10px;">
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
      <div class="address-row" style="margin-bottom:10px;">
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
      <div class="address-row" style="margin-bottom:10px;">
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
          <td>${escapeHtml(a.agency || "—")}</td>
          <td>${escapeHtml(a.email || "—")}</td>
          <td>${a.brokerCount}</td>
          <td>${a.brokerLimit}</td>
          <td>
            <button class="btn admin-open-agency" data-id="${escapeHtml(a.id)}" type="button">Открыть</button>
            <button class="btn danger-btn admin-del-agency" data-id="${escapeHtml(a.id)}" data-email="${escapeHtml(a.email || "")}" type="button">Удалить</button>
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
          <td>${escapeHtml(u.email)}</td>
          <td>${escapeHtml(u.name || "—")}</td>
          <td>${escapeHtml(u.agency || "—")}</td>
          <td>${escapeHtml(u.phone || "—")}</td>
          <td>${u.role === "admin" ? "admin" : "брокер"}</td>
          <td class="muted">${escapeHtml((u.createdAt || "").slice(0, 10))}</td>
          <td>
            <button class="btn admin-open-user" data-id="${escapeHtml(u.id)}" type="button">Открыть</button>
            ${
              u.role === "admin"
                ? `<span class="muted">—</span>`
                : `<button class="btn danger-btn admin-del-user" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(
                    u.email
                  )}" type="button">Удалить</button>`
            }
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
          <td><code>${escapeHtml(p.id)}</code></td>
          <td>${escapeHtml(p.address || "—")}</td>
          <td>${money(p.price)} ₽</td>
          <td>${escapeHtml(p.ownerEmail)}</td>
          <td class="muted">${escapeHtml((p.createdAt || "").slice(0, 10))}</td>
          <td>
            <a class="btn" href="#/property/${encodeURIComponent(p.id)}">Открыть</a>
            <button class="btn danger-btn admin-del-prop" data-id="${escapeHtml(p.id)}" type="button">Удалить</button>
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
  if (!state.token) {
    if (hash.startsWith("#/demo/property/")) {
      const id = decodeURIComponent(hash.split("/")[3] || "");
      renderDemoPropertyPage(id);
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
