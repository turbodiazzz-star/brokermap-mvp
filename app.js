require("dotenv").config();

const express = require("express");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
const {
  initDb,
  findUserByEmail,
  findUserById,
  createUserRecord,
  listAllUsersForAdmin,
  listPropertyRowsFiltered,
  findPropertyById,
  listPropertiesByOwner,
  insertProperty,
  updatePropertyRow,
  deletePropertyByOwner,
  countAllProperties,
  countAllUsers,
  stripContacts,
  listAllPropertiesForAdmin,
  deletePropertyById
} = require("./lib/db");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";
const adminEmailList = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const UPLOADS_DIR = path.join(__dirname, "uploads");
const PHOTOS_DIR = path.join(UPLOADS_DIR, "photos");
const PDFS_DIR = path.join(UPLOADS_DIR, "pdfs");
const app = express();

function unlinkUploadMaybe(url) {
  if (!url || typeof url !== "string" || !url.startsWith("/uploads/")) {
    return;
  }
  const abs = path.join(__dirname, url.replace(/^\//, ""));
  if (abs.startsWith(UPLOADS_DIR) && fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
}

function deletePropertyFilesOnDisk(property) {
  for (const u of property.photos || []) {
    unlinkUploadMaybe(u);
  }
  unlinkUploadMaybe(property.pdfUrl);
}

initDb({ adminEmails: adminEmailList });

for (const dir of [UPLOADS_DIR, PHOTOS_DIR, PDFS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createPropertyId() {
  if (typeof crypto.randomUUID === "function") {
    return `p-${crypto.randomUUID()}`;
  }
  return `p-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

function toOptionalNumber(value) {
  if (value === "" || value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toBooleanValue(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return ["1", "true", "on", "yes", "да"].includes(normalized);
}

function normalizeFinishing(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["finished", "whitebox", "concrete"].includes(normalized)) return normalized;
  if (normalized === "yes" || normalized === "true") return "finished";
  if (normalized === "no" || normalized === "false") return "concrete";
  return "";
}

function finishingLabel(value) {
  const map = {
    finished: "С отделкой",
    whitebox: "Вайт бокс",
    concrete: "Бетон"
  };
  return map[value] || "-";
}

function normalizeReadiness(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["resale", "assignment"].includes(normalized)) return normalized;
  return "";
}

function readinessLabel(value) {
  const map = {
    resale: "Вторичка",
    assignment: "Переуступка"
  };
  return map[value] || "-";
}

function money(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

async function generatePresentationPdf(property) {
  const filename = `auto-${property.id}.pdf`;
  const filePath = path.join(PDFS_DIR, filename);
  const doc = new PDFDocument({ size: "A4", margin: 48 });

  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);

    doc.fontSize(22).text(property.title || "Объект недвижимости");
    doc.moveDown(0.7);
    doc.fontSize(12).fillColor("#333").text(`Адрес: ${property.address || "-"}`);
    doc.text(`Цена: ${money(property.price)} ₽`);
    doc.text(`Площадь: ${property.area ?? "-"} м²`);
    doc.text(`Спален: ${property.bedrooms ?? "-"}`);
    doc.text(`Этаж: ${property.floor ?? "-"}`);
    doc.text(`Этажей в доме: ${property.totalFloors ?? "-"}`);
    doc.text(`Высота потолков: ${property.ceilingHeight ?? "-"} м`);
    doc.text(`Отделка: ${finishingLabel(property.finishing)}`);
    doc.text(`Готовность дома: ${readinessLabel(property.readiness)}`);
    doc.moveDown(0.8);
    doc.fontSize(12).text("Описание:");
    doc.fontSize(11).fillColor("#444").text(property.description || "-", { width: 500, align: "left" });
    doc.moveDown(0.8);
    doc
      .fontSize(9)
      .fillColor("#777")
      .text("Автоматическая презентация сформирована без контактов и логотипов.", { width: 500 });

    doc.end();
  });

  return `/uploads/pdfs/${filename}`;
}

const COOKIE_NAME = "authToken";

function getTokenFromRequest(req) {
  return req.headers.authorization?.replace("Bearer ", "") || req.cookies?.[COOKIE_NAME] || "";
}

function publicUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    agency: user.agency || "",
    inn: user.inn || "",
    telegram: user.telegram || "",
    whatsapp: user.whatsapp || "",
    vk: user.vk || "",
    max: user.max || "",
    isAdmin: user.role === "admin"
  };
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

function isAdminEmail(email) {
  return adminEmailList.includes(String(email || "").toLowerCase().trim());
}

function signUserToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role || "user" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ message: "Требуется авторизация" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = findUserById(payload.userId);
    if (!user) {
      return res.status(401).json({ message: "Сессия истекла, войдите заново" });
    }
    req.userId = user.id;
    req.userRole = user.role || "user";
    next();
  } catch (_error) {
    return res.status(401).json({ message: "Сессия истекла, войдите заново" });
  }
}

function requireAdmin(req, res, next) {
  if (req.userRole !== "admin") {
    return res.status(403).json({ message: "Недостаточно прав" });
  }
  next();
}

function requireAuthForFile(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).end();
  }
  try {
    jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).end();
  }
}

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/uploads/photos/:file", requireAuthForFile, (req, res) => {
  const name = path.basename(req.params.file);
  if (!name || name !== req.params.file) {
    return res.status(400).end();
  }
  const filePath = path.join(PHOTOS_DIR, name);
  if (!filePath.startsWith(PHOTOS_DIR)) {
    return res.status(400).end();
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).end();
  }
  return res.sendFile(filePath);
});

app.get("/uploads/pdfs/:file", requireAuthForFile, (req, res) => {
  const name = path.basename(req.params.file);
  if (!name || name !== req.params.file) {
    return res.status(400).end();
  }
  const filePath = path.join(PDFS_DIR, name);
  if (!filePath.startsWith(PDFS_DIR)) {
    return res.status(400).end();
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).end();
  }
  return res.sendFile(filePath);
});

const BLOCKED_FROM_STATIC = new Set([
  "db.json",
  "app.js",
  "package.json",
  "package-lock.json",
  ".env",
  ".env.local",
  ".env.production",
  ".gitignore"
]);
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return next();
  }
  const base = path.basename(req.path || "");
  if (BLOCKED_FROM_STATIC.has(base) || base.startsWith(".env") || base.endsWith(".bak")) {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(__dirname));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, PDFS_DIR);
      return;
    }
    cb(null, PHOTOS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".bin";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e8)}${ext}`);
  }
});
const upload = multer({ storage });

app.post("/api/auth/register", async (req, res) => {
  const { firstName, lastName, name, email, password, phone, agency, inn, marketingConsent, agree } = req.body;
  if (!email || !password || !firstName || !lastName || !agency || !inn || !phone) {
    return res.status(400).json({ message: "Заполните все обязательные поля регистрации" });
  }
  if (!/^\+7\d{10}$/.test(String(phone))) {
    return res.status(400).json({ message: "Телефон должен быть в формате +7 и 10 цифр" });
  }
  if (!/^\d{10}$|^\d{12}$/.test(String(inn))) {
    return res.status(400).json({ message: "ИНН должен быть 10 или 12 цифр" });
  }
  if (!agree) {
    return res.status(400).json({ message: "Нужно согласие на обработку данных" });
  }
  if (findUserByEmail(email)) {
    return res.status(409).json({ message: "Пользователь с таким email уже есть" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const id = `u-${Date.now()}`;
  const role = isAdminEmail(email) ? "admin" : "user";
  const user = {
    id,
    name: name || `${firstName} ${lastName}`.trim(),
    email,
    passwordHash,
    firstName,
    lastName,
    agency,
    inn,
    phone,
    marketingConsent: Boolean(marketingConsent),
    telegram: "",
    whatsapp: "",
    vk: "",
    max: "",
    role,
    createdAt: new Date().toISOString()
  };
  createUserRecord(user);
  const token = signUserToken(user);
  setAuthCookie(res, token);
  return res.json({ token, user: publicUser({ ...user, role }) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = findUserByEmail(String(email || ""));
  if (!user) {
    return res.status(401).json({ message: "Неверный email или пароль" });
  }
  const ok = await bcrypt.compare(password || "", user.passwordHash);
  if (!ok) {
    return res.status(401).json({ message: "Неверный email или пароль" });
  }
  const token = signUserToken(user);
  setAuthCookie(res, token);
  return res.json({ token, user: publicUser(user) });
});

app.post("/api/auth/logout", (_req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

// Выдать куки тем, кто залогинен только через Bearer в localStorage (старые сессии после обновления)
app.post("/api/auth/refresh-cookie", (req, res) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ message: "Нет токена" });
  }
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Сессия недействительна" });
  }
  setAuthCookie(res, token);
  return res.json({ ok: true });
});

app.post("/api/auth/forgot-password", (req, res) => {
  return res.json({
    message: `Запрос на восстановление для ${req.body.email || "email"} принят. Для MVP используйте регистрацию заново.`
  });
});

app.get("/api/auth/me", auth, (req, res) => {
  const user = findUserById(req.userId);
  if (!user) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }
  return res.json(publicUser(user));
});

// Список на карту — только для авторизованных; без полей contacts (телефоны в карточке списка не отдаём)
app.get("/api/properties", auth, (req, res) => {
  const minPrice = Number(req.query.minPrice || 0);
  const maxPrice = Number(req.query.maxPrice || Number.MAX_SAFE_INTEGER);
  const bedrooms = req.query.bedrooms ? Number(req.query.bedrooms) : null;
  const list = listPropertyRowsFiltered(minPrice, maxPrice, bedrooms);
  return res.json(list.map((p) => stripContacts(p)));
});

// Детальная карточка с контактами — только с токеном/кукой
app.get("/api/properties/:id", auth, (req, res) => {
  const property = findPropertyById(req.params.id);
  if (!property) {
    return res.status(404).json({ message: "Объект не найден" });
  }
  return res.json(property);
});

app.get("/api/my/properties", auth, (req, res) => {
  return res.json(listPropertiesByOwner(req.userId));
});

app.get("/api/admin/summary", auth, requireAdmin, (_req, res) => {
  return res.json({
    users: countAllUsers(),
    properties: countAllProperties()
  });
});

app.get("/api/admin/users", auth, requireAdmin, (_req, res) => {
  return res.json(listAllUsersForAdmin());
});

app.get("/api/admin/properties", auth, requireAdmin, (_req, res) => {
  return res.json(listAllPropertiesForAdmin());
});

app.delete("/api/admin/properties/:id", auth, requireAdmin, (req, res) => {
  const property = findPropertyById(req.params.id);
  if (!property) {
    return res.status(404).json({ message: "Объект не найден" });
  }
  deletePropertyFilesOnDisk(property);
  if (!deletePropertyById(req.params.id)) {
    return res.status(500).json({ message: "Не удалось удалить из базы" });
  }
  return res.json({ success: true });
});

app.post(
  "/api/my/properties",
  auth,
  upload.fields([
    { name: "photos", maxCount: 5 },
    { name: "presentation", maxCount: 1 }
  ]),
  async (req, res) => {
    const user = findUserById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }

    const photos = (req.files.photos || []).map((f) => `/uploads/photos/${f.filename}`);
    let presentation = req.files.presentation?.[0]
      ? `/uploads/pdfs/${req.files.presentation[0].filename}`
      : "";
    const wantsAutoPresentation = req.body.autoPresentation === undefined ? true : toBooleanValue(req.body.autoPresentation);
    const hasRequiredFields =
      req.body.address &&
      req.body.lat &&
      req.body.lon &&
      req.body.price &&
      req.body.area &&
      req.body.bedrooms &&
      req.body.floor &&
      req.body.totalFloors &&
      req.body.ceilingHeight &&
      req.body.finishing &&
      req.body.readiness &&
      req.body.commissionTotal &&
      req.body.commissionPartner &&
      req.body.phone &&
      req.body.telegram &&
      req.body.description;
    if (!hasRequiredFields || !(req.files.photos || []).length) {
      return res.status(400).json({ message: "Заполните все обязательные поля объекта, включая фото." });
    }

    const property = {
      id: createPropertyId(),
      ownerId: req.userId,
      title: req.body.title || req.body.address,
      address: req.body.address,
      lat: Number(req.body.lat),
      lon: Number(req.body.lon),
      price: Number(req.body.price),
      area: Number(req.body.area),
      bedrooms: Number(req.body.bedrooms),
      floor: toOptionalNumber(req.body.floor),
      totalFloors: toOptionalNumber(req.body.totalFloors),
      ceilingHeight: toOptionalNumber(req.body.ceilingHeight),
      finishing: normalizeFinishing(req.body.finishing),
      readiness: normalizeReadiness(req.body.readiness),
      description: req.body.description || "",
      photos,
      pdfUrl: presentation,
      commissionTotal: Number(req.body.commissionTotal),
      commissionPartner: Number(req.body.commissionPartner),
      createdAt: new Date().toISOString(),
      contacts: {
        phone: req.body.phone || "",
        telegram: req.body.telegram || "",
        whatsapp: req.body.whatsapp || user.whatsapp || "",
        vk: req.body.vk || user.vk || "",
        max: req.body.max || user.max || ""
      }
    };

    if (!presentation && wantsAutoPresentation) {
      property.pdfUrl = await generatePresentationPdf(property);
    }

    insertProperty(property);
    return res.status(201).json(property);
  }
);

app.put(
  "/api/my/properties/:id",
  auth,
  upload.fields([
    { name: "photos", maxCount: 5 },
    { name: "presentation", maxCount: 1 }
  ]),
  async (req, res) => {
    const property = findPropertyById(req.params.id);
    if (!property || property.ownerId !== req.userId) {
      return res.status(404).json({ message: "Объект не найден" });
    }

    const newPhotos = (req.files.photos || []).map((f) => `/uploads/photos/${f.filename}`);
    const removePhotos = (() => {
      try {
        const raw = req.body.removePhotos;
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_error) {
        return [];
      }
    })();
    if (removePhotos.length) {
      const existing = Array.isArray(property.photos) ? property.photos : [];
      property.photos = existing.filter((item) => !removePhotos.includes(item));
    }
    if (newPhotos.length) {
      const existing = Array.isArray(property.photos) ? property.photos : [];
      if (existing.length + newPhotos.length > 5) {
        return res.status(400).json({ message: "Можно хранить не более 5 фото на объект." });
      }
      property.photos = [...existing, ...newPhotos];
    }

    const presentation = req.files.presentation?.[0]
      ? `/uploads/pdfs/${req.files.presentation[0].filename}`
      : "";
    const wantsAutoPresentation = req.body.autoPresentation === undefined ? false : toBooleanValue(req.body.autoPresentation);
    if (presentation) {
      property.pdfUrl = presentation;
    } else if (wantsAutoPresentation) {
      property.pdfUrl = await generatePresentationPdf({
        ...property,
        title: req.body.title || property.title,
        address: req.body.address || property.address,
        price: Number(req.body.price ?? property.price),
        area: Number(req.body.area ?? property.area),
        bedrooms: Number(req.body.bedrooms ?? property.bedrooms),
        floor: toOptionalNumber(req.body.floor ?? property.floor),
        totalFloors: toOptionalNumber(req.body.totalFloors ?? property.totalFloors),
        ceilingHeight: toOptionalNumber(req.body.ceilingHeight ?? property.ceilingHeight),
        finishing: req.body.finishing === undefined ? property.finishing : normalizeFinishing(req.body.finishing),
        readiness: req.body.readiness === undefined ? property.readiness : normalizeReadiness(req.body.readiness),
        description: req.body.description ?? property.description,
        id: property.id
      });
    }

    property.title = req.body.title || property.title;
    property.address = req.body.address || property.address;
    property.lat = Number(req.body.lat ?? property.lat);
    property.lon = Number(req.body.lon ?? property.lon);
    property.price = Number(req.body.price ?? property.price);
    property.area = Number(req.body.area ?? property.area);
    property.bedrooms = Number(req.body.bedrooms ?? property.bedrooms);
    property.floor = toOptionalNumber(req.body.floor ?? property.floor);
    property.totalFloors = toOptionalNumber(req.body.totalFloors ?? property.totalFloors);
    property.ceilingHeight = toOptionalNumber(req.body.ceilingHeight ?? property.ceilingHeight);
    property.finishing = req.body.finishing === undefined ? property.finishing : normalizeFinishing(req.body.finishing);
    property.readiness = req.body.readiness === undefined ? property.readiness : normalizeReadiness(req.body.readiness);
    property.description = req.body.description ?? property.description;
    property.commissionTotal = Number(req.body.commissionTotal ?? property.commissionTotal);
    property.commissionPartner = Number(req.body.commissionPartner ?? property.commissionPartner);
    property.contacts = {
      phone: req.body.phone ?? property.contacts?.phone,
      telegram: req.body.telegram ?? property.contacts?.telegram,
      whatsapp: req.body.whatsapp ?? property.contacts?.whatsapp,
      vk: req.body.vk ?? property.contacts?.vk,
      max: req.body.max ?? property.contacts?.max
    };

    updatePropertyRow(property);
    return res.json(property);
  }
);

app.post("/api/my/properties/:id/generate-pdf", auth, async (req, res) => {
  const property = findPropertyById(req.params.id);
  if (!property || property.ownerId !== req.userId) {
    return res.status(404).json({ message: "Объект не найден" });
  }
  property.pdfUrl = await generatePresentationPdf(property);
  updatePropertyRow(property);
  return res.json({ pdfUrl: property.pdfUrl });
});

app.delete("/api/my/properties/:id", auth, (req, res) => {
  const ok = deletePropertyByOwner(req.params.id, req.userId);
  if (!ok) {
    return res.status(404).json({ message: "Объект не найден" });
  }
  return res.json({ success: true });
});

app.get("/api/my/stats", auth, (req, res) => {
  const list = listPropertiesByOwner(req.userId);
  const avgCommission = list.length
    ? Number((list.reduce((sum, p) => sum + p.commissionPartner, 0) / list.length).toFixed(2))
    : 0;
  return res.json({
    totalProperties: list.length,
    averagePartnerCommission: avgCommission
  });
});

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
