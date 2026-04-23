const state = {
  token: localStorage.getItem("token") || "",
  user: JSON.parse(localStorage.getItem("user") || "null"),
  mapInstance: null,
  properties: [],
  selectedGroup: [],
  selectedPropertyId: null,
  panelCollapsed: false,
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
  }
};

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
    throw new Error(data.message || "Ошибка запроса");
  }
  return data;
}

function topbar() {
  return `
    <header class="topbar">
      <div class="brand">BrokerMap</div>
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
        <button id="cabinetBtn" class="top-action" type="button">
          <span class="cabinet-btn-long">Личный кабинет</span>
          <span class="cabinet-btn-short">Кабинет</span>
        </button>
      </div>
    </header>
  `;
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

function renderMapPage() {
  setMapBodyClass(true);
  app.innerHTML = `
    ${topbar()}
    <main class="map-layout ${state.panelCollapsed ? "collapsed" : ""}" id="mapLayout">
      <aside class="left-panel" id="leftPanel">
        <div class="left-panel-head">
          <h3>Выберите объект на карте</h3>
          <button class="close-left-panel" id="closeLeftPanel" aria-label="Свернуть панель">×</button>
        </div>
      </aside>
      <div class="map-wrap">
        <div id="map" class="map"></div>
        <canvas id="mapDrawCanvas" class="map-draw-canvas"></canvas>
        <button class="open-left-panel-btn" id="openLeftPanelBtn" aria-label="Открыть список">❯</button>
        <div class="map-draw-tools">
          <button class="map-draw-btn" id="mapDrawAreaBtn" title="Рисовать область">✍</button>
        </div>
      </div>
    </main>
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
          <button class="btn primary" id="applyMoreFilters">Применить</button>
          <button class="btn" id="resetMoreFilters">Сбросить доп. фильтры</button>
          <button class="btn" id="closeModal">Закрыть</button>
        </p>
      </div>
    </div>
  `;

  document.getElementById("cabinetBtn")?.addEventListener("click", () => {
    location.hash = state.user ? "#/cabinet" : "#/auth";
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
  document.getElementById("closeLeftPanel").addEventListener("click", () => {
    state.panelCollapsed = true;
    document.getElementById("mapLayout").classList.add("collapsed");
    refreshMapViewport();
  });
  document.getElementById("openLeftPanelBtn").addEventListener("click", () => {
    state.panelCollapsed = false;
    document.getElementById("mapLayout").classList.remove("collapsed");
    if (state.areaPolygonCoords?.length) {
      renderAreaSelectionPanel(getAreaFilteredProperties());
    } else {
      renderViewportPanel();
    }
    refreshMapViewport();
  });
  document.getElementById("mapDrawAreaBtn").addEventListener("click", startAreaDrawing);
  syncDrawButtons();

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
  panel.innerHTML =
    `<div class="left-panel-head"><h3>В выбранной области: ${list.length}</h3><button class="close-left-panel" id="closeLeftPanel" aria-label="Свернуть панель">×</button></div>` +
    (list.length ? list.map(cardMarkup).join("") : `<p class="muted">Внутри области объекты не найдены.</p>`);
  document.getElementById("closeLeftPanel")?.addEventListener("click", () => {
    state.panelCollapsed = true;
    document.getElementById("mapLayout")?.classList.add("collapsed");
    refreshMapViewport();
  });
  panel.querySelectorAll(".open-object").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#/property/${btn.dataset.id}`;
    });
  });
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
  panel.innerHTML =
    `<div class="left-panel-head"><h3>Объекты в видимой области: ${list.length}</h3><button class="close-left-panel" id="closeLeftPanel" aria-label="Свернуть панель">×</button></div>` +
    (list.length ? list.map(cardMarkup).join("") : `<p class="muted">В текущей области объекты не найдены.</p>`);
  document.getElementById("closeLeftPanel")?.addEventListener("click", () => {
    state.panelCollapsed = true;
    document.getElementById("mapLayout")?.classList.add("collapsed");
    refreshMapViewport();
  });
  panel.querySelectorAll(".open-object").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#/property/${btn.dataset.id}`;
    });
  });
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

function clearAreaFilter() {
  stopAreaDrawing();
  state.areaPolygonCoords = null;
  if (state.mapInstance && state.areaPolygonObject) {
    state.mapInstance.geoObjects.remove(state.areaPolygonObject);
  }
  state.areaPolygonObject = null;
  const panel = document.getElementById("leftPanel");
  if (panel) {
    panel.innerHTML = `
      <div class="left-panel-head">
        <h3>Выберите объект на карте</h3>
        <button class="close-left-panel" id="closeLeftPanel" aria-label="Свернуть панель">×</button>
      </div>
    `;
    document.getElementById("closeLeftPanel")?.addEventListener("click", () => {
      state.panelCollapsed = true;
      document.getElementById("mapLayout")?.classList.add("collapsed");
      refreshMapViewport();
    });
  }
  if (state.mapInstance && document.getElementById("map")) {
    initMap();
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
    initMap();
  };

  state.areaDrawHandlers = { onPointerDown, onPointerMove, onPointerUp };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
}

async function loadMapData() {
  const query = new URLSearchParams();
  if (state.filters.minPrice) query.append("minPrice", toRawNumberString(state.filters.minPrice));
  if (state.filters.maxPrice) query.append("maxPrice", toRawNumberString(state.filters.maxPrice));
  if (state.filters.bedrooms) query.append("bedrooms", state.filters.bedrooms);
  const list = await api(`/api/properties?${query.toString()}`);
  const floorMin = Number(state.filters.floorMin || 0);
  const floorMax = Number(state.filters.floorMax || Number.MAX_SAFE_INTEGER);
  const totalFloorsMin = Number(state.filters.totalFloorsMin || 0);
  const totalFloorsMax = Number(state.filters.totalFloorsMax || Number.MAX_SAFE_INTEGER);
  const ceilingHeightMin = Number(state.filters.ceilingHeightMin || 0);
  state.properties = list.filter((item) => {
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
  document.getElementById("mapLayout")?.classList.remove("collapsed");
  refreshMapViewport();
  const panel = document.getElementById("leftPanel");
  properties.sort((a, b) => b.commissionPartner - a.commissionPartner);
  panel.innerHTML =
    `<div class="left-panel-head"><h3>Объектов в точке: ${properties.length}</h3><button class="close-left-panel" id="closeLeftPanel" aria-label="Свернуть панель">×</button></div>` +
    properties.map(cardMarkup).join("");
  document.getElementById("closeLeftPanel")?.addEventListener("click", () => {
    state.panelCollapsed = true;
    document.getElementById("mapLayout")?.classList.add("collapsed");
    refreshMapViewport();
  });
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
      center: state.mapView?.center || [55.751244, 37.618423],
      zoom: state.mapView?.zoom || 5,
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
      if (!state.panelCollapsed) {
        renderAreaSelectionPanel(getAreaFilteredProperties());
      }
    } else {
      state.areaPolygonObject = null;
      if (!state.panelCollapsed) {
        renderViewportPanel();
      }
    }
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
              ? `<p><a href="${property.pdfUrl}" target="_blank" class="btn">Скачать презентацию PDF</a></p>`
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
  document.getElementById("addObjectBtn")?.addEventListener("click", () => {
    location.hash = state.user ? "#/cabinet/add" : "#/auth";
  });
  document.getElementById("cabinetBtn")?.addEventListener("click", () => (location.hash = "#/cabinet"));

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
          <button class="btn full" id="openRegister">Регистрация</button>
          <button class="btn full" id="openReset">Забыли пароль?</button>
          <p class="muted" id="authStatus"></p>
        </div>
      </div>

      <div class="auth-modal" id="registerModal">
        <div class="auth-modal-content">
          <h3>Регистрация</h3>
          <input id="lastName" placeholder="Фамилия (обязательно)" autocomplete="family-name" />
          <input id="firstName" placeholder="Имя (обязательно)" autocomplete="given-name" />
          <input id="email" placeholder="Email (обязательно)" type="email" autocomplete="email" />
          <div class="phone-group">
            <span>+7</span>
            <input id="phone" placeholder="9991234567" maxlength="10" inputmode="numeric" autocomplete="tel-national" />
          </div>
          <input id="password" placeholder="Пароль (мин 6)" type="password" autocomplete="new-password" />
          <input id="agency" placeholder="Агентство / ИП (обязательно)" />
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
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
}

async function logout() {
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
            <h2>Личный кабинет брокера</h2>
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
      <div class="panel" id="propertyFormWrap" style="display:none;">
        <div class="panel-head">
          <h3 id="propertyFormTitle">Новый объект</h3>
        </div>
        <form id="propertyForm">
          <div class="form-grid">
            <div class="field-block field-span-2">
              <label class="field-label" for="addressInput">Адрес</label>
              <div class="address-row">
                <input id="addressInput" name="address" placeholder="Адрес" autocomplete="off" required />
                <button class="btn" type="button" id="checkAddressBtn">Проверить адрес</button>
              </div>
              <div id="addressHint" class="note">Кликните по мини-карте или введите адрес и нажмите «Проверить адрес».</div>
              <div id="addressPreviewMap" class="address-preview-map visible"></div>
            </div>
            <input type="hidden" name="lat" id="latInput" />
            <input type="hidden" name="lon" id="lonInput" />
            <div class="field-block">
              <label class="field-label" for="priceInput">Цена</label>
              <input id="priceInput" name="price" type="text" inputmode="numeric" placeholder="18 000 000" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="areaInput">Площадь (м²)</label>
              <input id="areaInput" name="area" type="text" inputmode="decimal" placeholder="41,21" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="bedroomsInput">Спальни</label>
              <input id="bedroomsInput" name="bedrooms" type="number" placeholder="2" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="floorInput">Этаж</label>
              <input id="floorInput" name="floor" type="number" placeholder="8" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="totalFloorsInput">Этажей в доме</label>
              <input id="totalFloorsInput" name="totalFloors" type="number" placeholder="24" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="ceilingHeightInput">Высота потолков (м)</label>
              <input id="ceilingHeightInput" name="ceilingHeight" type="number" step="0.1" placeholder="2.9" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="commissionTotalInput">Общая комиссия (%)</label>
              <input id="commissionTotalInput" name="commissionTotal" type="number" step="0.1" placeholder="6" required />
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
              <input id="commissionPartnerInput" name="commissionPartner" type="number" step="0.1" placeholder="3.5" required />
            </div>
            <div class="field-block">
              <label class="field-label" for="phoneInput">Телефон</label>
              <div class="phone-group">
                <span>+7</span>
                <input id="phoneInput" name="phone" placeholder="(999) 123-45-67" maxlength="15" inputmode="numeric" required />
              </div>
            </div>
            <div class="field-block">
              <label class="field-label" for="telegramInput">Ник в Telegram</label>
              <input id="telegramInput" name="telegram" placeholder="@nickname" required />
            </div>
          </div>
          <label class="field-label" for="descriptionInput">Описание</label>
          <p><textarea id="descriptionInput" name="description" placeholder="Описание" required></textarea></p>
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
    </section>
  `;
  document.getElementById("addObjectBtn")?.addEventListener("click", () => {
    document.getElementById("propertyFormWrap").style.display = "block";
    setupAddressSuggest();
  });
  document.getElementById("cabinetBtn")?.addEventListener("click", () => (location.hash = "#/cabinet"));
  document.getElementById("closeCabinetPanel").addEventListener("click", () => {
    location.hash = "#/";
  });
  document.getElementById("logoutCabinet").addEventListener("click", () => {
    logout();
    location.hash = "#/auth";
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
    document.getElementById("propertyFormWrap").style.display = "block";
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
    document.getElementById("propertyFormWrap").style.display = "block";
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

  document.getElementById("addProperty").addEventListener("click", () => {
    openFormCreate();
  });
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
  const checkAddressBtn = document.getElementById("checkAddressBtn");
  const addressPreviewMap = document.getElementById("addressPreviewMap");
  if (!addressInput || !latInput || !lonInput) return;
  let previewMap = null;
  let previewPlacemark = null;

  if (addressInput.dataset.suggestBound === "1") return;
  addressInput.dataset.suggestBound = "1";

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
      addressHint.textContent = "Кликните по мини-карте или введите адрес и нажмите «Проверить адрес».";
    }
  };

  addressInput.addEventListener("input", resetCoordinates);

  const resolveAddress = async (value) => {
    if (!window.ymaps) {
      if (addressHint) {
        addressHint.textContent = "Карты еще загружаются. Повторите через секунду.";
      }
      return;
    }
    const geocodeResult = await ymaps.geocode(value, { results: 1 });
    const firstGeoObject = geocodeResult.geoObjects.get(0);
    if (!firstGeoObject) {
      resetCoordinates();
      if (addressHint) {
        addressHint.textContent = "Адрес не найден. Уточните формулировку и проверьте снова.";
      }
      return;
    }
    const [lat, lon] = firstGeoObject.geometry.getCoordinates();
    const exactAddress = firstGeoObject.getAddressLine() || value;
    addressInput.value = exactAddress;
    setPoint(lat, lon);
  };

  checkAddressBtn?.addEventListener("click", () => {
    const value = addressInput.value.trim();
    if (!value) {
      if (addressHint) {
        addressHint.textContent = "Введите адрес перед проверкой.";
      }
      return;
    }
    resolveAddress(value).catch(() => {
      resetCoordinates();
      if (addressHint) {
        addressHint.textContent = "Не удалось определить адрес. Попробуйте еще раз.";
      }
    });
  });

  const initSuggest = () => {
    if (!window.ymaps || typeof ymaps.SuggestView !== "function") {
      setTimeout(initSuggest, 300);
      return;
    }

    ymaps.ready(() => {
      if (addressInput.dataset.suggestReady === "1") return;
      addressInput.dataset.suggestReady = "1";

      previewMap = new ymaps.Map("addressPreviewMap", {
        center: [55.751244, 37.618423],
        zoom: 10,
        controls: ["zoomControl"]
      });
      previewPlacemark = new ymaps.Placemark(
        [55.751244, 37.618423],
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

      const suggest = new ymaps.SuggestView("addressInput");

      suggest.events.add("select", (event) => {
        const selectedValue = event.get("item").value;
        resolveAddress(selectedValue).catch(resetCoordinates);
      });

      addressInput.addEventListener("blur", () => {
        if (!addressInput.value.trim() || (latInput.value && lonInput.value)) return;
        resolveAddress(addressInput.value.trim()).catch(resetCoordinates);
      });
    });
  };

  initSuggest();
}

async function router() {
  const hash = location.hash || "#/";
  if (!state.token) {
    renderAuthPage();
    return;
  }
  if (hash.startsWith("#/property/")) {
    const id = hash.split("/")[2];
    await renderPropertyPage(id);
    return;
  }
  if (hash === "#/auth") {
    renderAuthPage();
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
