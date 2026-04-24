/**
 * 100 демо-точек Москвы: Yandex Geocoder, адрес = ответ API.
 * Набирает 100 уникальных (lat,lon) по пулу запросов; дубликат дома — сдвиг номера.
 *   node scripts/build-moscow-demo-picks.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "moscowRealDemoPicks.js");
const API_KEY = "7ba604bf-cf7b-4d61-87de-820a730893f1";

const TARGET = 100;

/** Основной пул (100 шт.): разные магистрали/районы. */
const SEEDS = [
  "Москва, Тверская улица, 6",
  "Москва, Новый Арбат, 15",
  "Москва, Кутузовский проспект, 35",
  "Москва, Ленинский проспект, 42",
  "Москва, проспект Мира, 40",
  "Москва, Ленинградский проспект, 64",
  "Москва, Мичуринский проспект, 12",
  "Москва, Варшавское шоссе, 128",
  "Москва, Профсоюзная улица, 15",
  "Москва, Нагатинская набережная, 10",
  "Москва, шоссе Энтузиастов, 30",
  "Москва, Рязанский проспект, 75",
  "Москва, Волгоградский проспект, 96",
  "Москва, Ярославское шоссе, 10",
  "Москва, Дмитровское шоссе, 98",
  "Москва, Алтуфьевское шоссе, 40",
  "Москва, Щёлковское шоссе, 15",
  "Москва, Измайловское шоссе, 71",
  "Москва, Каширское шоссе, 55",
  "Москва, Пятницкое шоссе, 36",
  "Москва, Рублёвское шоссе, 40",
  "Москва, Можайское шоссе, 5",
  "Москва, Сколковское шоссе, 5",
  "Москва, Большая Полянка, 2",
  "Москва, Остоженка, 32",
  "Москва, Пречистенка, 17",
  "Москва, улица Знаменка, 7",
  "Москва, улица Варварка, 4",
  "Москва, улица Ильинка, 4",
  "Москва, улица Маросейка, 3",
  "Москва, улица Мясницкая, 15",
  "Москва, Садовая-Самотёчная улица, 5",
  "Москва, улица Сретенка, 9",
  "Москва, улица Покровка, 16",
  "Москва, улица Бакунинская, 80",
  "Москва, улица Бауманская, 50",
  "Москва, Покровский бульвар, 4",
  "Москва, Большая Никитская, 45",
  "Москва, улица Тимура Фрунзе, 11",
  "Москва, улица Удальцова, 1",
  "Москва, улица Академика Пилюгина, 2",
  "Москва, улица Кравченко, 1",
  "Москва, улица Маршала Тимошенко, 17",
  "Москва, улица Кулакова, 20",
  "Москва, улица Мнёвники, 1",
  "Москва, улица Староволынская, 12",
  "Москва, улица Самуила Маршака, 8",
  "Москва, поселение Сосенское, Пыхтинская улица, 1",
  "Москва, улица Борисовские Пруды, 5",
  "Москва, 1-й Митинский переулок, 1",
  "Москва, Планерная улица, 12",
  "Москва, улица Сходненская, 1",
  "Москва, Митинская улица, 1",
  "Москва, 3-я Ямского Поля улица, 2",
  "Москва, 1-я Брестская улица, 1",
  "Москва, улица 1905 года, 1",
  "Москва, 1-й Хорошёвский проезд, 1",
  "Москва, улица Василия Петушкова, 1",
  "Москва, улица Маршала Бирюзова, 1",
  "Москва, улица Кастанаевская, 1",
  "Москва, бульвар Генерала Карбышёва, 5",
  "Москва, улица Панфилова, 1",
  "Москва, улица 8 Марта, 1",
  "Москва, улица 9 Мая, 1",
  "Москва, 5-й Войковский проезд, 1",
  "Москва, 2-й Северный проезд, 1",
  "Москва, 9-я Северная линия, 1",
  "Москва, Красноказарменная улица, 1",
  "Москва, 3-я Владимирская улица, 1",
  "Москва, 5-я Кожуховская улица, 1",
  "Москва, улица Красногвардейская, 1",
  "Москва, 2-я Карачаровская, 1",
  "Москва, 2-я Мелитопольская, 1",
  "Москва, 2-я Синичкина, 1",
  "Москва, 2-я Владимирская, 1",
  "Москва, улица Рогожский Вал, 1",
  "Москва, 9-я Соколиной Горы, 1",
  "Москва, 11-я Парковая, 1",
  "Москва, 1-я Миусская, 1",
  "Москва, 2-я Миусская, 1",
  "Москва, 1-я Тверская-Ямская улица, 1",
  "Москва, 1-я Сестрорецкая улица, 5",
  "Москва, 1-я Сестрорецкая улица, 7",
  "Москва, 1-я Сестрорецкая улица, 11",
  "Москва, 3-я Сестрорецкая, 1",
  "Москва, 3-я Сестрорецкая, 2",
  "Москва, улица Покрышкина, 1",
  "Москва, улица Островитянова, 1",
  "Москва, улица Академика Виноградова, 1",
  "Москва, 3-я Фрунзенская, 1",
  "Москва, 3-я Филёвская, 1",
  "Москва, улица Садовническая, 1",
  "Москва, набережная Тараса Шевченко, 3",
  "Москва, улица Покрышкина, 2",
  "Москва, улица Староконюшенный, 1",
  "Москва, улица Староконюшенный, 5",
  "Москва, улица Боровая, 2",
  "Москва, улица Симоновский Вал, 3",
  "Москва, улица Авиамоторная, 10",
  "Москва, улица Щепкина, 1"
];

/** Запас, если не удалось взять уникальную точку с основного сида. */
const SPARE = [
  "Москва, улица Лобачевского, 1",
  "Москва, Большая Черёмушкинская улица, 1",
  "Москва, улица Академика Волгина, 1",
  "Москва, проспект 60-летия Октября, 1",
  "Москва, улица Куликовская, 1",
  "Москва, улица Миклухо-Маклая, 1",
  "Москва, улица Академика Варги, 1",
  "Москва, Севастопольский проспект, 1",
  "Москва, улица Вавилова, 1",
  "Москва, улица Дмитрия Ульянова, 1",
  "Москва, улица Декабристов, 1",
  "Москва, улица Каховка, 1",
  "Москва, улица Каховка, 5",
  "Москва, улица Каховка, 20",
  "Москва, улица Каховка, 45",
  "Москва, улица Римского-Корсакова, 1",
  "Москва, улица Кравченко, 5",
  "Москва, улица Кравченко, 10",
  "Москва, проспект Андропова, 1",
  "Москва, улица Корабельная, 1",
  "Москва, 1-я улица Измайловского Зверинца, 1",
  "Москва, улица Снайперская, 1",
  "Москва, улица Сходненская, 5",
  "Москва, улица Сходненская, 20",
  "Москва, Волоколамское шоссе, 1",
  "Москва, улица Героев Панфиловцев, 1",
  "Москва, улица Сходненская, 10",
  "Москва, Ленинградский проспект, 1",
  "Москва, улица Сущёвский Вал, 1",
  "Москва, улица Сущёвский Вал, 5",
  "Москва, улица Краснопролетарская, 1",
  "Москва, улица Краснопролетарская, 5",
  "Москва, улица Краснопролетарская, 9",
  "Москва, 1-я Мытищинская улица, 1",
  "Москва, 2-я Мытищинская улица, 1",
  "Москва, улица Красная Пресня, 1",
  "Москва, улица Красного Маяка, 1",
  "Москва, улица Краснопролетарская, 15"
];

function formatMoscowLine(text) {
  return (text || "")
    .replace(/^Россия,\s*/, "Москва, ")
    .replace(/^Москва,\s*Москва,\s*/, "Москва, ");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function inMoscowBox(lat, lon) {
  return lat >= 55.5 && lat <= 55.99 && lon >= 37.32 && lon <= 37.9;
}

function isMoscowOblastDormitoryLabel(text) {
  return /Московская область,/.test(text) && !/Новомосковский|Троицкий|зел[её]ноград|доп\.\s*террит|внутригород/i.test(text);
}

function coordKey(lat, lon) {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

function pickBestGeoObject(members) {
  const list = [];
  for (const fm of members) {
    const f = fm?.GeoObject;
    if (!f?.Point?.pos) continue;
    const meta = f.metaDataProperty?.GeocoderMetaData;
    const kind = meta?.kind || "";
    const [lon, lat] = f.Point.pos.split(/\s+/).map(Number);
    if (!inMoscowBox(lat, lon)) continue;
    const text = formatMoscowLine(meta?.text || "");
    if (isMoscowOblastDormitoryLabel(text)) continue;
    if (kind === "locality" || kind === "province" || kind === "area" || kind === "country" || kind === "vegetation" || kind === "hydro") continue;
    if (text.includes("федеральный округ") || text.length > 180) continue;
    let score = 0;
    if (kind === "house" || kind === "entrance") score += 10;
    if (kind === "street") score += 3;
    if (text.includes("Москва") && text.includes("улиц")) score += 1;
    list.push({ score, lat, lon, address: text, kind });
  }
  list.sort((a, b) => b.score - a.score);
  if (list[0]) return list[0];
  for (const fm of members) {
    const f = fm?.GeoObject;
    if (!f?.Point?.pos) continue;
    const meta = f.metaDataProperty?.GeocoderMetaData;
    const kind = meta?.kind || "";
    if (kind === "locality" || kind === "province" || kind === "area" || kind === "country" || kind === "vegetation" || kind === "hydro") continue;
    const [lon, lat] = f.Point.pos.split(/\s+/).map(Number);
    if (!inMoscowBox(lat, lon)) continue;
    const t = formatMoscowLine(meta?.text || "");
    if (isMoscowOblastDormitoryLabel(t)) continue;
    if (t.includes("федеральный округ") || t.length > 180) continue;
    return { score: 0, lat, lon, address: t, kind };
  }
  return null;
}

async function geocodeTry(query) {
  for (const strict of [true, false]) {
    const u = new URL("https://geocode-maps.yandex.ru/v1/");
    u.searchParams.set("apikey", API_KEY);
    u.searchParams.set("geocode", query);
    u.searchParams.set("format", "json");
    u.searchParams.set("results", "10");
    u.searchParams.set("lang", "ru_RU");
    if (strict) {
      u.searchParams.set("bbox", "37.32,55.5~37.9,55.99");
      u.searchParams.set("rspn", "1");
    } else {
      u.searchParams.set("rspn", "0");
    }
    const r = await fetch(u);
    if (!r.ok) continue;
    const j = await r.json();
    const nFound = j?.response?.GeoObjectCollection?.metaDataProperty?.GeocoderResponseMetaData?.found;
    if (nFound === "0" || nFound === 0) continue;
    const g = pickBestGeoObject(j?.response?.GeoObjectCollection?.featureMember || []);
    if (g && inMoscowBox(g.lat, g.lon)) return g;
  }
  return null;
}

/** Все варианты запроса: сдвиг номера дома и типовые алиасы. */
function* queryVariants(base) {
  const used = new Set();
  const emit = (s) => {
    if (s && !used.has(s)) {
      used.add(s);
      return s;
    }
    return null;
  };
  const parts = base.match(/^(.*,)(\d+)([а-яА-Яa-zA-Z/]*)?$/u);
  if (parts) {
    const p = parts[1];
    const n = parseInt(parts[2], 10);
    const su = parts[3] || "";
    for (const d of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 64, 80, 96, 98]) {
      const t = p + (n + d) + su;
      const e = emit(t);
      if (e) yield e;
    }
    for (const d of [1, 2, 3, 5, 7, 10, 20]) {
      const t = p + Math.max(1, n - d) + su;
      const e = emit(t);
      if (e) yield e;
    }
  } else {
    const e = emit(base);
    if (e) yield e;
  }
  if (/, линия,/.test(base)) {
    const t = base.replace(/, линия,/u, ", улица,");
    const e = emit(t);
    if (e) yield e;
  }
  if (base.includes("1-я Красноказарменная")) {
    const t = base.replace("1-я Красноказарменная улица", "Красноказарменная улица");
    const e = emit(t);
    if (e) yield e;
  }
  if (/Тверская-Ямская(?! улица)/.test(base)) {
    const t = base.replace(/(Тверская-Ямская),/u, "$1 улица,");
    const e = emit(t);
    if (e) yield e;
  }
  const t3 = base.match(/Москва,\s*3-я улица ([^,]+),\s*(\d+)/u);
  if (t3) {
    const t = `Москва, 3-я ${t3[1]} улица, ${t3[2]}`;
    const e = emit(t);
    if (e) yield e;
  }
  if (base.includes("3-я улица ")) {
    const t = base.replace("3-я улица ", "3-я ");
    const e = emit(t);
    if (e) yield e;
  }
}

async function firstUniquePicked(seen, base) {
  for (const q of queryVariants(base)) {
    const g = await geocodeTry(q);
    if (!g) continue;
    const k = coordKey(g.lat, g.lon);
    if (seen.has(k)) continue;
    seen.add(k);
    return g;
  }
  return null;
}

function buildJs(picks) {
  const lines = picks.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}|${p.address.replace(/\|/g, " ")}`);
  return `/**
 * Сгенерировано: node scripts/build-moscow-demo-picks.mjs
 * Координаты = ответ Yandex Geocoder (дом/участок), не править вручную.
 */
(function () {
  const raw = \`${lines.join("\n")}\`;
  function parse() {
    const out = [];
    for (const line of raw.trim().split("\\n")) {
      if (!line.trim()) continue;
      const p = line.indexOf("|");
      if (p < 0) continue;
      const [la, lo] = line
        .slice(0, p)
        .split(",")
        .map((n) => Number(n.trim()));
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      if (la < 55.5 || la > 55.99 || lo < 37.32 || lo > 37.9) continue;
      out.push({ lat: la, lon: lo, address: line.slice(p + 1).trim() });
    }
    return out;
  }
  const picks = parse();
  if (typeof globalThis !== "undefined") {
    globalThis.MOSCOW_REAL_DEMO_PICKS = picks;
  }
})();`;
}

async function main() {
  if (SEEDS.length !== 100) {
    console.error("SEEDS need 100, got", SEEDS.length);
    process.exit(1);
  }
  if (new Set(SEEDS).size !== 100) {
    console.error("SEEDS must be unique");
    process.exit(1);
  }

  const seen = new Set();
  const picks = [];

  for (const base of SEEDS) {
    const g = await firstUniquePicked(seen, base);
    if (g) {
      picks.push({ lat: g.lat, lon: g.lon, address: g.address });
      process.stderr.write(`\r[${picks.length}/${TARGET}] ` + g.address.slice(0, 50) + "…");
    }
    await sleep(100);
  }

  for (const base of SPARE) {
    if (picks.length >= TARGET) break;
    const g = await firstUniquePicked(seen, base);
    if (g) {
      picks.push({ lat: g.lat, lon: g.lon, address: g.address });
      process.stderr.write(`\r[${picks.length}/${TARGET}] (запас) ` + g.address.slice(0, 45) + "…");
    }
    await sleep(100);
  }

  process.stderr.write("\n");

  if (picks.length < TARGET) {
    console.error("Собрали только", picks.length, "уникальных точек — расширьте SPARE в скрипте.");
    process.exit(1);
  }

  const out = picks.slice(0, TARGET);
  fs.writeFileSync(OUT, buildJs(out), "utf8");
  console.log("Wrote", OUT, "—", out.length, "уникальных координат");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
