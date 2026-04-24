/**
 * Пересборка moscowRealDemoPicks.js: Yandex Geocoder (адрес ↔ точка).
 * node scripts/build-moscow-demo-picks.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "moscowRealDemoPicks.js");
const API_KEY = "7ba604bf-cf7b-4d61-87de-820a730893f1";

/** Ровно 100 разных адресов, разные улицы/проспекты (без «коридора» по одной магистрали). */
const QUERIES = [
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
  "Москва, 6-й Северный проезд, 1",
  "Москва, 9-я Северная линия, 1",
  "Москва, 1-я Красноказарменная улица, 1",
  "Москва, 3-я Владимирская улица, 1",
  "Москва, 5-я Кожуховская улица, 1",
  "Москва, улица Красногвардейская, 1",
  "Москва, 2-я Карачаровская, 1",
  "Москва, 2-я Мелитопольская, 1",
  "Москва, 2-я Синичкина, 1",
  "Москва, 2-я Владимирская, 1",
  "Москва, 3-я Владимирская, 1",
  "Москва, 9-я Соколиной Горы, 1",
  "Москва, 11-я Парковая, 1",
  "Москва, 1-я Миусская, 1",
  "Москва, 2-я Миусская, 1",
  "Москва, 1-я Тверская-Ямская, 1",
  "Москва, 1-я Сестрорецкая, 1",
  "Москва, 1-я Сестрорецкая, 2",
  "Москва, 1-я Сестрорецкая, 3",
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

if (new Set(QUERIES).size !== 100) {
  console.error("QUERIES must be 100 unique, got", new Set(QUERIES).size);
  process.exit(1);
}

function formatMoscowLine(text) {
  return (text || "")
    .replace(/^Россия,\s*/, "Москва, ")
    .replace(/^Москва,\s*Москва,\s*/, "Москва, ");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function inMoscowBox(lat, lon) {
  return lat >= 55.56 && lat <= 55.91 && lon >= 37.32 && lon <= 37.9;
}

function alternatives(base) {
  const m = base.match(/^(.*,\s*[^,]+,\s*)\d+([а-яА-Яa-zA-Z/]*)?$/u);
  const n = m ? parseInt((base.match(/(\d+)[а-яА-Яa-zA-Z/]*$/u) || [0, "0"])[1], 10) : 0;
  const p = m ? m[1] : null;
  const alts = [base];
  if (m && n) {
    alts.push(`${p}${n + 1}`, `${p}${n + 2}`, `${p}${Math.max(1, n - 1)}`, `${p}${n + 5}`);
  }
  const t3 = base.match(/Москва,\s*3-я улица ([^,]+),\s*(\d+)/u);
  if (t3) {
    alts.push(`Москва, 3-я ${t3[1]} улица, ${t3[2]}`);
    alts.push(`Москва, улица 3-я ${t3[1]}, ${t3[2]}`);
  }
  alts.push(base.replace("3-я улица ", "3-я "));
  return [...new Set(alts)];
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
    if (kind === "locality" || kind === "province" || kind === "area" || kind === "country") continue;
    if (text.includes("федеральный округ") || text.length > 180) continue;
    let score = 0;
    if (kind === "house" || kind === "entrance") score += 10;
    if (kind === "street") score += 3;
    if (text.includes("Москва") && text.includes("улиц")) score += 1;
    list.push({ score, lat, lon, address: text, kind, raw: f });
  }
  list.sort((a, b) => b.score - a.score);
  if (list[0]) return list[0];
  for (const fm of members) {
    const f = fm?.GeoObject;
    if (!f?.Point?.pos) continue;
    const meta = f.metaDataProperty?.GeocoderMetaData;
    const [lon, lat] = f.Point.pos.split(/\s+/).map(Number);
    if (!inMoscowBox(lat, lon)) continue;
    return {
      score: 0,
      lat,
      lon,
      address: formatMoscowLine(meta?.text || ""),
      kind: meta?.kind || ""
    };
  }
  return null;
}

async function geocodeOne(query) {
  const u = new URL("https://geocode-maps.yandex.ru/v1/");
  u.searchParams.set("apikey", API_KEY);
  u.searchParams.set("geocode", query);
  u.searchParams.set("format", "json");
  u.searchParams.set("results", "10");
  u.searchParams.set("lang", "ru_RU");
  /** Сузить поиск до bbox Москвы, иначе «3-я Лесная» и т.п. уезжают в МО. */
  u.searchParams.set("bbox", "37.32,55.56~37.9,55.91");
  u.searchParams.set("rspn", "1");
  const r = await fetch(u);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${query}`);
  const j = await r.json();
  const nFound = j?.response?.GeoObjectCollection?.metaDataProperty?.GeocoderResponseMetaData?.found;
  if (nFound === "0" || nFound === 0) throw new Error("not found " + query);
  const members = j?.response?.GeoObjectCollection?.featureMember || [];
  const g = pickBestGeoObject(members);
  if (!g) throw new Error("no good result " + query);
  if (!inMoscowBox(g.lat, g.lon)) throw new Error("bbox " + query);
  return g;
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
      if (la < 55.56 || la > 55.91 || lo < 37.32 || lo > 37.9) continue;
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
  const picks = [];
  for (let i = 0; i < 100; i++) {
    const base = QUERIES[i];
    let ok = null;
    for (const q of alternatives(base)) {
      try {
        const g = await geocodeOne(q);
        if (!inMoscowBox(g.lat, g.lon)) continue;
        ok = g;
        break;
      } catch {
        /* next alt */
      }
    }
    if (!ok) {
      throw new Error("geocode fail for index " + i + " " + base);
    }
    process.stderr.write(`\r[${i + 1}/100] ${ok.address.slice(0, 55)}…`);
    picks.push({ lat: ok.lat, lon: ok.lon, address: ok.address });
    await sleep(200);
  }
  process.stderr.write("\n");
  fs.writeFileSync(OUT, buildJs(picks), "utf8");
  console.log("Wrote", OUT, "(100 picks)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
