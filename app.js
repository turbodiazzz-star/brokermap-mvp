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
let nodemailer = null;
try {
  // Optional dependency on runtime (prevents hard crash if not installed yet).
  // eslint-disable-next-line global-require
  nodemailer = require("nodemailer");
} catch {
  nodemailer = null;
}
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
  deletePropertyById,
  deletePropertiesByOwner,
  reassignPropertiesToOwner,
  reassignPropertyOwner,
  deleteUserById,
  listBrokersByAgencyOwner,
  countBrokersByAgencyOwner,
  listAgenciesForAdmin,
  updateAgencyBrokerLimit,
  updateUserPasswordHash,
  updateUserProfile,
  markUserEmailVerified,
  completeAgencyBrokerInvite,
  listPrivateBrokersForAdmin,
  listPropertiesForAgencyOwner
} = require("./lib/db");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";
const APP_BASE_URL = String(process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_USER || "no-reply@brokermap.local";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const adminEmailList = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const UPLOADS_DIR = path.join(__dirname, "uploads");
const PHOTOS_DIR = path.join(UPLOADS_DIR, "photos");
const PDFS_DIR = path.join(UPLOADS_DIR, "pdfs");
const app = express();

const mailTransport = SMTP_HOST && nodemailer
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
    })
  : null;

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendEmail({ to, subject, html, text }) {
  if (!mailTransport) {
    throw new Error("SMTP_NOT_CONFIGURED");
  }
  await mailTransport.sendMail({
    from: EMAIL_FROM,
    to,
    subject,
    text,
    html
  });
  return { queued: true };
}

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

function resolvePdfFontPath() {
  const candidates = [
    path.join(__dirname, "assets", "fonts", "DejaVuSans.ttf"),
    path.join(__dirname, "fonts", "DejaVuSans.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/Library/Fonts/Arial.ttf"
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function resolvePropertyPhotoPath(photoUrl) {
  if (!photoUrl || typeof photoUrl !== "string") return null;
  if (photoUrl.startsWith("/uploads/")) {
    const abs = path.join(__dirname, photoUrl.replace(/^\//, ""));
    return fs.existsSync(abs) ? abs : null;
  }
  return null;
}

function normalizePdfText(value) {
  const text = String(value ?? "");
  if (!text) return "";
  const srcCyrCount = (text.match(/[А-Яа-яЁё]/g) || []).length;
  try {
    const converted = Buffer.from(text, "latin1").toString("utf8");
    const cyrCount = (converted.match(/[А-Яа-яЁё]/g) || []).length;
    if (cyrCount >= 3 && cyrCount > srcCyrCount) return converted;
  } catch {
    /* ignore */
  }
  try {
    const decoder = new TextDecoder("windows-1251");
    const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
    const converted1251 = decoder.decode(bytes);
    const cyrCount1251 = (converted1251.match(/[А-Яа-яЁё]/g) || []).length;
    if (cyrCount1251 >= 3 && cyrCount1251 > srcCyrCount) return converted1251;
  } catch {
    /* ignore */
  }
  return text;
}

async function generatePresentationPdf(property) {
  const filename = `auto-${property.id}-${Date.now()}.pdf`;
  const filePath = path.join(PDFS_DIR, filename);
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const unicodeFontPath = resolvePdfFontPath();

  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);

    if (unicodeFontPath) {
      doc.font(unicodeFontPath);
    }

    const titleText = normalizePdfText(property.title || "Объект недвижимости");
    const addressText = normalizePdfText(property.address || "Адрес не указан");
    const descriptionText = normalizePdfText(property.description || "");
    const mainPhotoPath = resolvePropertyPhotoPath(Array.isArray(property.photos) ? property.photos[0] : null);
    const pageLeft = doc.page.margins.left;
    const pageTop = doc.page.margins.top;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    let y = pageTop;

    if (mainPhotoPath) {
      try {
        const image = doc.openImage(mainPhotoPath);
        const maxPhotoHeight = 300;
        const scale = Math.min(pageWidth / image.width, maxPhotoHeight / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        const imageX = pageLeft + (pageWidth - drawWidth) / 2;
        doc.roundedRect(pageLeft, y, pageWidth, drawHeight).fillAndStroke("#f6f8fc", "#e5eaf5");
        doc.image(mainPhotoPath, imageX, y, { width: drawWidth, height: drawHeight });
        y += drawHeight + 18;
      } catch {
        /* ignore image read errors */
      }
    }

    doc.fillColor("#101828").fontSize(34).text(`${money(property.price)} ₽`, pageLeft, y, {
      width: pageWidth,
      align: "left"
    });
    y = doc.y + 3;
    if (titleText && titleText !== addressText) {
      doc.fillColor("#1f2a44").fontSize(18).text(titleText, pageLeft, y, { width: pageWidth });
      y = doc.y + 2;
    }
    doc.fillColor("#344054").fontSize(13).text(addressText, pageLeft, y, { width: pageWidth });
    y = doc.y + 12;

    const specs = [
      { icon: "▣", label: "Площадь", value: `${property.area ?? "-"} м²` },
      { icon: "◍", label: "Спален", value: `${property.bedrooms ?? "-"}` },
      { icon: "⌂", label: "Этаж", value: `${property.floor ?? "-"}` },
      { icon: "⇅", label: "Этажей в доме", value: `${property.totalFloors ?? "-"}` },
      { icon: "✦", label: "Высота потолков", value: `${property.ceilingHeight ?? "-"} м` },
      { icon: "◈", label: "Отделка", value: finishingLabel(property.finishing) },
      { icon: "●", label: "Готовность дома", value: readinessLabel(property.readiness) }
    ];
    const colGap = 12;
    const colWidth = (pageWidth - colGap) / 2;
    const cardHeight = 30;
    specs.forEach((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const cardX = pageLeft + col * (colWidth + colGap);
      const cardY = y + row * (cardHeight + 8);
      doc.roundedRect(cardX, cardY, colWidth, cardHeight, 6).fillAndStroke("#f7f9fc", "#e4e9f2");
      doc.fillColor("#1f2a44").fontSize(10).text(`${item.icon} ${item.label}: ${item.value}`, cardX + 10, cardY + 10, {
        width: colWidth - 16
      });
    });
    y += Math.ceil(specs.length / 2) * (cardHeight + 8) + 8;

    if (descriptionText) {
      const descHeight = Math.min(150, Math.max(60, Math.ceil(descriptionText.length / 80) * 16));
      if (y + descHeight + 50 > pageBottom) {
        doc.addPage();
        y = pageTop;
      }
      doc.fillColor("#1f2a44").fontSize(14).text("Описание", pageLeft, y, { width: pageWidth });
      y = doc.y + 6;
      doc.roundedRect(pageLeft, y, pageWidth, descHeight, 8).fillAndStroke("#fbfcff", "#e4e9f2");
      doc.fillColor("#344054").fontSize(11).text(descriptionText, pageLeft + 12, y + 10, {
        width: pageWidth - 24,
        height: descHeight - 20
      });
      y += descHeight + 10;
    }

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
    isAdmin: user.role === "admin",
    accountType: user.accountType || "broker",
    isAgencyOwner: user.accountType === "agency_owner",
    brokerLimit: Number(user.brokerLimit || 0),
    emailVerified: Boolean(user.emailVerified),
    marketingConsent: Boolean(user.marketingConsent)
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

function signActionToken(payload, expiresIn) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function hashPasswordSignature(passwordHash) {
  return crypto.createHash("sha256").update(String(passwordHash || "")).digest("hex").slice(0, 16);
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

function requireAgencyOwner(req, res, next) {
  const user = findUserById(req.userId);
  if (!user || user.accountType !== "agency_owner") {
    return res.status(403).json({ message: "Доступно только для аккаунта агентства" });
  }
  req.currentUser = user;
  next();
}

/** Брокеры, которым уже можно назначать объекты (прошли регистрацию по приглашению). */
function agencyAssignableBrokerIds(ownerId) {
  return listBrokersByAgencyOwner(ownerId)
    .filter((b) => !b.invitePending)
    .map((b) => b.id);
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

// Dev/prod safety: always deliver fresh frontend assets.
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const p = req.path || "";
  if (
    p === "/" ||
    p === "/index.html" ||
    p.endsWith(".js") ||
    p.endsWith(".css") ||
    p.endsWith(".html")
  ) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
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
  const { firstName, lastName, name, email, password, phone, agency, inn, marketingConsent, agree, accountType } = req.body;
  const normalizedType = accountType === "agency_owner" ? "agency_owner" : "broker";
  if (!email || !password || !firstName || !lastName || !phone || !agency) {
    return res.status(400).json({ message: "Заполните все обязательные поля регистрации" });
  }
  if (!/^\+7\d{10}$/.test(String(phone))) {
    return res.status(400).json({ message: "Телефон должен быть в формате +7 и 10 цифр" });
  }
  if (!agree) {
    return res.status(400).json({ message: "Нужно согласие на обработку данных" });
  }
  if (findUserByEmail(email)) {
    return res.status(409).json({ message: "Пользователь с таким email уже есть" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const id = `u-${Date.now()}`;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const role = isAdminEmail(normalizedEmail) ? "admin" : "user";
  const user = {
    id,
    name: name || `${firstName} ${lastName}`.trim(),
    email: normalizedEmail,
    passwordHash,
    firstName,
    lastName,
    agency,
    inn: String(inn || "").trim(),
    phone,
    marketingConsent: Boolean(marketingConsent),
    telegram: "",
    whatsapp: "",
    vk: "",
    max: "",
    role,
    accountType: normalizedType,
    agencyOwnerId: null,
    brokerLimit: normalizedType === "agency_owner" ? 100 : 0,
    emailVerified: false,
    createdAt: new Date().toISOString()
  };
  createUserRecord(user);
  const verifyToken = signActionToken(
    { action: "verify_email", userId: user.id, email: user.email },
    "24h"
  );
  const verifyLink = `${APP_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`;
  try {
    await sendEmail({
      to: user.email,
      subject: "Подтвердите email в BrokerMap",
      text: `Подтвердите email: ${verifyLink}`,
      html: `<p>Подтвердите email для входа в BrokerMap:</p><p><a href="${htmlEscape(verifyLink)}">Подтвердить email</a></p>`
    });
  } catch (error) {
    // Do not leave "half-created" users when email delivery is unavailable.
    deleteUserById(user.id);
    console.error("[mail] register verification send failed:", error?.message || error);
    return res.status(502).json({
      message: "Не удалось отправить письмо подтверждения. Проверьте настройки почты и попробуйте снова."
    });
  }
  return res.json({
    requiresEmailVerification: true,
    message: "Мы отправили письмо для подтверждения email. Откройте ссылку из письма. Если письма нет, проверьте папку Спам."
  });
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
  if (!user.emailVerified) {
    return res.status(403).json({
      message: "Email не подтвержден. Подтвердите почту по ссылке из письма."
    });
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

app.get("/api/auth/agency-invite-info", (req, res) => {
  const token = String(req.query.token || "");
  if (!token) {
    return res.status(400).json({ message: "Нужна ссылка из письма" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.action !== "agency_broker_invite" || !payload.userId || !payload.email) {
      return res.status(400).json({ message: "Некорректная ссылка приглашения" });
    }
    const broker = findUserById(payload.userId);
    const email = String(payload.email || "").toLowerCase();
    if (
      !broker ||
      broker.accountType !== "broker" ||
      !broker.agencyInvitePending ||
      String(broker.email).toLowerCase() !== email
    ) {
      return res.status(400).json({ message: "Приглашение недействительно или уже использовано" });
    }
    const owner = findUserById(broker.agencyOwnerId);
    const agencyName = (owner?.agency || owner?.name || "агентства").trim() || "агентства";
    return res.json({
      email: broker.email,
      agencyName
    });
  } catch {
    return res.status(400).json({ message: "Ссылка приглашения истекла или повреждена" });
  }
});

app.post("/api/auth/complete-agency-invite", async (req, res) => {
  const { token, firstName, lastName, password, phone, agree, marketingConsent } = req.body || {};
  if (!token || !firstName || !lastName || !password || !phone) {
    return res.status(400).json({ message: "Заполните все обязательные поля" });
  }
  if (!agree) {
    return res.status(400).json({ message: "Нужно согласие на обработку персональных данных" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ message: "Пароль должен быть не менее 6 символов" });
  }
  if (!/^\+7\d{10}$/.test(String(phone))) {
    return res.status(400).json({ message: "Телефон должен быть в формате +7 и 10 цифр" });
  }
  let payload;
  try {
    payload = jwt.verify(String(token), JWT_SECRET);
  } catch {
    return res.status(400).json({ message: "Ссылка приглашения истекла или повреждена" });
  }
  if (payload.action !== "agency_broker_invite" || !payload.userId || !payload.email) {
    return res.status(400).json({ message: "Некорректная ссылка приглашения" });
  }
  const broker = findUserById(payload.userId);
  const email = String(payload.email || "").toLowerCase();
  if (
    !broker ||
    broker.accountType !== "broker" ||
    !broker.agencyInvitePending ||
    String(broker.email).toLowerCase() !== email
  ) {
    return res.status(400).json({ message: "Приглашение недействительно или уже использовано" });
  }
  const passwordHash = await bcrypt.hash(String(password), 10);
  const fn = String(firstName).trim();
  const ln = String(lastName).trim();
  const name = `${fn} ${ln}`.trim();
  const ok = completeAgencyBrokerInvite(broker.id, {
    firstName: fn,
    lastName: ln,
    name,
    passwordHash,
    phone: String(phone).trim(),
    marketingConsent: Boolean(marketingConsent)
  });
  if (!ok) {
    return res.status(500).json({ message: "Не удалось сохранить профиль" });
  }
  const updated = findUserById(broker.id);
  const sessionToken = signUserToken(updated);
  setAuthCookie(res, sessionToken);
  return res.json({ token: sessionToken, user: publicUser(updated) });
});

app.get("/api/auth/verify-email", (req, res) => {
  const token = String(req.query.token || "");
  if (!token) {
    return res.status(400).send("<h2>Некорректная ссылка подтверждения</h2>");
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.action !== "verify_email" || !payload.userId || !payload.email) {
      return res.status(400).send("<h2>Некорректный токен подтверждения</h2>");
    }
    const user = findUserById(payload.userId);
    if (!user || String(user.email).toLowerCase() !== String(payload.email).toLowerCase()) {
      return res.status(400).send("<h2>Пользователь не найден</h2>");
    }
    markUserEmailVerified(user.id);
    return res.send(
      `<h2>Email подтвержден</h2><p>Теперь можно войти в аккаунт.</p><p><a href="${htmlEscape(
        `${APP_BASE_URL}/#/auth`
      )}">Перейти ко входу</a></p>`
    );
  } catch {
    return res.status(400).send("<h2>Ссылка подтверждения недействительна или истекла</h2>");
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const user = findUserByEmail(email);
  if (user) {
    const resetToken = signActionToken(
      {
        action: "reset_password",
        userId: user.id,
        email: user.email,
        pwdSig: hashPasswordSignature(user.passwordHash)
      },
      "1h"
    );
    const resetLink = `${APP_BASE_URL}/api/auth/reset-password?token=${encodeURIComponent(resetToken)}`;
    try {
      await sendEmail({
        to: user.email,
        subject: "Сброс пароля в BrokerMap",
        text: `Для сброса пароля перейдите по ссылке: ${resetLink}`,
        html: `<p>Для сброса пароля перейдите по ссылке:</p><p><a href="${htmlEscape(resetLink)}">Сбросить пароль</a></p>`
      });
    } catch (error) {
      console.error("[mail] forgot-password send failed:", error?.message || error);
      return res.status(502).json({
        message: "Письмо не отправлено. Проверьте настройки почты и попробуйте снова."
      });
    }
  }
  return res.json({
    message: "Если такой email зарегистрирован, мы отправили письмо со ссылкой для сброса пароля. Если письма нет, проверьте папку Спам."
  });
});

app.get("/api/auth/reset-password", (req, res) => {
  const token = String(req.query.token || "");
  if (!token) {
    return res.status(400).send("<h2>Некорректная ссылка сброса</h2>");
  }
  return res.send(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Сброс пароля</title>
<style>body{font-family:Inter,Arial,sans-serif;background:#f4f6fb;margin:0;padding:20px} .card{max-width:440px;margin:40px auto;background:#fff;border:1px solid #e5e9f2;border-radius:14px;padding:16px} input,button{width:100%;height:42px;border-radius:10px;border:1px solid #d8deeb;padding:0 12px;margin:8px 0} button{background:#1760ff;border-color:#1760ff;color:#fff;font-weight:600;cursor:pointer}</style>
</head><body><div class="card"><h2>Сброс пароля</h2><form method="post" action="/api/auth/reset-password">
<input type="hidden" name="token" value="${htmlEscape(token)}">
<label>Новый пароль</label><input name="newPassword" type="password" minlength="6" required>
<label>Повтор нового пароля</label><input name="confirmPassword" type="password" minlength="6" required>
<button type="submit">Сохранить новый пароль</button></form></div></body></html>`);
});

app.post("/api/auth/reset-password", async (req, res) => {
  const token = String(req.body.token || "");
  const newPassword = String(req.body.newPassword || "");
  const confirmPassword = String(req.body.confirmPassword || "");
  const wantsHtml = String(req.headers.accept || "").includes("text/html");
  if (!token || !newPassword || !confirmPassword) {
    const message = "Заполните все поля";
    return wantsHtml ? res.status(400).send(`<h2>${htmlEscape(message)}</h2>`) : res.status(400).json({ message });
  }
  if (newPassword.length < 6) {
    const message = "Новый пароль должен быть не менее 6 символов";
    return wantsHtml ? res.status(400).send(`<h2>${htmlEscape(message)}</h2>`) : res.status(400).json({ message });
  }
  if (newPassword !== confirmPassword) {
    const message = "Пароли не совпадают";
    return wantsHtml ? res.status(400).send(`<h2>${htmlEscape(message)}</h2>`) : res.status(400).json({ message });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.action !== "reset_password" || !payload.userId || !payload.email || !payload.pwdSig) {
      throw new Error("bad token");
    }
    const user = findUserById(payload.userId);
    if (!user || String(user.email).toLowerCase() !== String(payload.email).toLowerCase()) {
      throw new Error("user mismatch");
    }
    if (payload.pwdSig !== hashPasswordSignature(user.passwordHash)) {
      throw new Error("stale token");
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    updateUserPasswordHash(user.id, newHash);
    if (wantsHtml) {
      return res.send(
        `<h2>Пароль обновлен</h2><p><a href="${htmlEscape(`${APP_BASE_URL}/#/auth`)}">Перейти ко входу</a></p>`
      );
    }
    return res.json({ ok: true, message: "Пароль обновлен" });
  } catch {
    const message = "Ссылка для сброса пароля недействительна или истекла";
    return wantsHtml ? res.status(400).send(`<h2>${htmlEscape(message)}</h2>`) : res.status(400).json({ message });
  }
});

app.get("/api/auth/me", auth, (req, res) => {
  const user = findUserById(req.userId);
  if (!user) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }
  return res.json(publicUser(user));
});

/** Смена пароля только по ссылке из письма (forgot-password / reset), не по старому паролю в приложении. */
app.post("/api/auth/change-password", auth, (_req, res) => {
  return res.status(403).json({
    message:
      "Смена пароля только по ссылке из письма: на экране входа нажмите «Забыли пароль?» — мы отправим письмо на ваш email."
  });
});

app.patch("/api/me/profile", auth, (req, res) => {
  const body = req.body || {};
  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const phone = String(body.phone || "").trim();
  const agency = String(body.agency || "").trim();
  const inn = String(body.inn || "").trim();
  const telegram = String(body.telegram || "").trim();
  const whatsapp = String(body.whatsapp || "").trim();
  const vk = String(body.vk || "").trim();
  const max = String(body.max || "").trim();
  const marketingConsent = Boolean(body.marketingConsent);
  if (!firstName || !lastName) {
    return res.status(400).json({ message: "Укажите имя и фамилию" });
  }
  if (!/^\+7\d{10}$/.test(phone)) {
    return res.status(400).json({ message: "Телефон должен быть в формате +7 и 10 цифр" });
  }
  if (!agency) {
    return res.status(400).json({ message: "Укажите название агентства или ФИО ИП/самозанятого" });
  }
  const user = findUserById(req.userId);
  if (!user) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }
  const name = `${firstName} ${lastName}`.trim();
  const ok = updateUserProfile(user.id, {
    firstName,
    lastName,
    name,
    phone,
    agency,
    inn,
    telegram,
    whatsapp,
    vk,
    max,
    marketingConsent
  });
  if (!ok) {
    return res.status(500).json({ message: "Не удалось сохранить профиль" });
  }
  const updated = findUserById(req.userId);
  return res.json({ user: publicUser(updated) });
});

app.delete("/api/me", auth, (req, res) => {
  const user = findUserById(req.userId);
  if (!user) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }
  if (user.role === "admin") {
    return res.status(400).json({ message: "Удаление администратора через приложение недоступно." });
  }
  if (user.accountType === "agency_owner") {
    const n = countBrokersByAgencyOwner(user.id);
    if (n > 0) {
      return res.status(400).json({
        message: "Сначала удалите всех брокеров агентства в панели агентства, затем повторите удаление профиля."
      });
    }
  }
  const purgeOwned = () => {
    const owned = listPropertiesByOwner(user.id);
    for (const property of owned) {
      deletePropertyFilesOnDisk(property);
    }
    deletePropertiesByOwner(user.id);
    return owned.length;
  };
  if (user.agencyOwnerId && user.accountType === "broker") {
    reassignPropertiesToOwner(user.id, user.agencyOwnerId);
  } else {
    purgeOwned();
  }
  if (!deleteUserById(user.id)) {
    return res.status(500).json({ message: "Не удалось удалить аккаунт" });
  }
  clearAuthCookie(res);
  return res.json({ success: true });
});

// Список на карту — только для авторизованных; без полей contacts (телефоны в карточке списка не отдаём)
app.get("/api/properties", auth, (req, res) => {
  const minPrice = Number(req.query.minPrice || 0);
  const maxPrice = Number(req.query.maxPrice || Number.MAX_SAFE_INTEGER);
  const bedrooms = req.query.bedrooms ? Number(req.query.bedrooms) : null;
  const partnerCommissionMin = Number(req.query.partnerCommissionMin || 0);
  const list = listPropertyRowsFiltered(minPrice, maxPrice, bedrooms, partnerCommissionMin);
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

app.get("/api/admin/private-brokers", auth, requireAdmin, (req, res) => {
  const query = String(req.query.query || "").trim();
  return res.json(listPrivateBrokersForAdmin(query));
});

app.get("/api/admin/agencies", auth, requireAdmin, (req, res) => {
  const query = String(req.query.query || "").trim();
  return res.json(listAgenciesForAdmin(query));
});

app.get("/api/admin/agencies/:id", auth, requireAdmin, (req, res) => {
  const agencyUser = findUserById(req.params.id);
  if (!agencyUser || agencyUser.accountType !== "agency_owner") {
    return res.status(404).json({ message: "Агентство не найдено" });
  }
  const brokers = listBrokersByAgencyOwner(agencyUser.id);
  return res.json({
    agency: {
      id: agencyUser.id,
      email: agencyUser.email,
      name: agencyUser.name,
      agency: agencyUser.agency || "",
      phone: agencyUser.phone || "",
      inn: agencyUser.inn || "",
      brokerLimit: Number(agencyUser.brokerLimit || 0)
    },
    brokers
  });
});

app.patch("/api/admin/agencies/:id/broker-limit", auth, requireAdmin, (req, res) => {
  const agencyUser = findUserById(req.params.id);
  if (!agencyUser || agencyUser.accountType !== "agency_owner") {
    return res.status(404).json({ message: "Агентство не найдено" });
  }
  const value = Number(req.body.brokerLimit);
  if (!Number.isInteger(value) || value < 0 || value > 1000) {
    return res.status(400).json({ message: "brokerLimit должен быть целым числом от 0 до 1000" });
  }
  if (!updateAgencyBrokerLimit(agencyUser.id, value)) {
    return res.status(500).json({ message: "Не удалось обновить лимит" });
  }
  return res.json({ success: true, brokerLimit: value });
});

app.get("/api/admin/users/:id", auth, requireAdmin, (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }
  const userProperties = listPropertiesByOwner(user.id).map((p) => ({
    id: p.id,
    address: p.address,
    price: p.price,
    createdAt: p.createdAt
  }));
  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      phone: user.phone || "",
      agency: user.agency || "",
      inn: user.inn || "",
      role: user.role || "user",
      createdAt: user.createdAt
    },
    properties: userProperties
  });
});

app.delete("/api/admin/users/:id", auth, requireAdmin, (req, res) => {
  const userId = req.params.id;
  const user = findUserById(userId);
  if (!user) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }
  if (user.role === "admin") {
    return res.status(400).json({ message: "Нельзя удалить администратора через панель." });
  }
  const purgeUserData = (targetUserId) => {
    const owned = listPropertiesByOwner(targetUserId);
    for (const property of owned) {
      deletePropertyFilesOnDisk(property);
    }
    deletePropertiesByOwner(targetUserId);
    return owned.length;
  };

  let deletedPropertiesCount = purgeUserData(userId);
  let deletedBrokersCount = 0;
  if (user.accountType === "agency_owner") {
    const agencyBrokers = listBrokersByAgencyOwner(userId);
    for (const broker of agencyBrokers) {
      deletedPropertiesCount += purgeUserData(broker.id);
      deleteUserById(broker.id);
      deletedBrokersCount += 1;
    }
  }
  if (!deleteUserById(userId)) {
    return res.status(500).json({ message: "Не удалось удалить пользователя" });
  }
  return res.json({
    success: true,
    deletedProperties: deletedPropertiesCount,
    deletedBrokers: deletedBrokersCount
  });
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

app.get("/api/agency/brokers", auth, requireAgencyOwner, (req, res) => {
  const owner = req.currentUser || findUserById(req.userId);
  const brokers = listBrokersByAgencyOwner(req.userId);
  return res.json({
    brokerLimit: Number(owner?.brokerLimit || 0),
    brokerCount: brokers.length,
    brokers
  });
});

app.get("/api/agency/properties", auth, requireAgencyOwner, (req, res) => {
  return res.json(listPropertiesForAgencyOwner(req.userId));
});

app.patch("/api/agency/properties/:id/owner", auth, requireAgencyOwner, (req, res) => {
  const property = findPropertyById(req.params.id);
  if (!property) {
    return res.status(404).json({ message: "Объект не найден" });
  }
  const targetOwnerId = String(req.body.ownerId || "").trim();
  if (!targetOwnerId) {
    return res.status(400).json({ message: "ownerId обязателен" });
  }
  const allowedOwnerIds = new Set([req.userId, ...agencyAssignableBrokerIds(req.userId)]);
  if (!allowedOwnerIds.has(property.ownerId)) {
    return res.status(403).json({ message: "Этот объект не относится к вашему агентству" });
  }
  if (!allowedOwnerIds.has(targetOwnerId)) {
    return res.status(400).json({
      message: "Можно назначить только зарегистрированного брокера вашего агентства или само агентство"
    });
  }
  if (!reassignPropertyOwner(property.id, targetOwnerId)) {
    return res.status(500).json({ message: "Не удалось обновить ответственного брокера" });
  }
  return res.json({ success: true, propertyId: property.id, ownerId: targetOwnerId });
});

app.delete("/api/agency/properties/:id", auth, requireAgencyOwner, (req, res) => {
  const property = findPropertyById(req.params.id);
  if (!property) {
    return res.status(404).json({ message: "Объект не найден" });
  }
  const allowedOwnerIds = new Set([req.userId, ...agencyAssignableBrokerIds(req.userId)]);
  if (!allowedOwnerIds.has(property.ownerId)) {
    return res.status(403).json({ message: "Этот объект не относится к вашему агентству" });
  }
  deletePropertyFilesOnDisk(property);
  if (!deletePropertyById(property.id)) {
    return res.status(500).json({ message: "Не удалось удалить объект" });
  }
  return res.json({ success: true });
});

app.post("/api/agency/brokers", auth, requireAgencyOwner, async (req, res) => {
  const emailRaw = String(req.body?.email || "").trim().toLowerCase();
  if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(emailRaw)) {
    return res.status(400).json({ message: "Укажите корректный email сотрудника" });
  }
  if (findUserByEmail(emailRaw)) {
    return res.status(409).json({ message: "Пользователь с таким email уже есть" });
  }
  const owner = req.currentUser || findUserById(req.userId);
  const brokerLimit = Number(owner?.brokerLimit || 0);
  const currentBrokerCount = countBrokersByAgencyOwner(req.userId);
  if (brokerLimit > 0 && currentBrokerCount >= brokerLimit) {
    return res.status(400).json({ message: `Достигнут лимит брокеров для агентства (${brokerLimit}).` });
  }
  const randomGate = crypto.randomBytes(48).toString("hex");
  const passwordHash = await bcrypt.hash(randomGate, 10);
  const broker = {
    id: `u-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
    name: "Ожидает регистрации",
    email: emailRaw,
    passwordHash,
    firstName: "",
    lastName: "",
    agency: owner?.agency || "",
    inn: owner?.inn || "",
    phone: "",
    marketingConsent: false,
    telegram: "",
    whatsapp: "",
    vk: "",
    max: "",
    role: "user",
    accountType: "broker",
    agencyOwnerId: req.userId,
    brokerLimit: 0,
    emailVerified: false,
    agencyInvitePending: true,
    createdAt: new Date().toISOString()
  };
  createUserRecord(broker);
  const agencyLabel = (owner?.agency || owner?.name || "агентства").trim() || "агентства";
  const inviteToken = signActionToken(
    { action: "agency_broker_invite", userId: broker.id, email: broker.email },
    "14d"
  );
  const inviteUrl = `${APP_BASE_URL}/#/auth-agency-invite/${encodeURIComponent(inviteToken)}`;
  try {
    await sendEmail({
      to: broker.email,
      subject: `${agencyLabel} — приглашение в BrokerMap`,
      text: `Здравствуйте.\n\n${agencyLabel} приглашает вас присоединиться к платформе BrokerMap как сотрудника агентства (брокер).\n\nПерейдите по ссылке, чтобы указать телефон, ФИО и пароль и принять условия: ${inviteUrl}\n\nСсылка действительна 14 дней.`,
      html: `<p>Здравствуйте.</p><p><strong>${htmlEscape(agencyLabel)}</strong> приглашает вас в платформу <strong>BrokerMap</strong> как сотрудника агентства (брокер).</p><p>Чтобы завершить регистрацию — укажите телефон, имя, фамилию и пароль и примите условия обработки данных, перейдите по ссылке:</p><p><a href="${htmlEscape(
        inviteUrl
      )}">Принять приглашение</a></p><p style="color:#64748b;font-size:13px;">Ссылка действительна 14 дней.</p>`
    });
  } catch (error) {
    deleteUserById(broker.id);
    console.error("[mail] agency broker invite failed:", error?.message || error);
    return res.status(502).json({
      message:
        "Не удалось отправить приглашение на почту. Проверьте настройки SMTP и попробуйте снова."
    });
  }
  return res.status(201).json({
    id: broker.id,
    email: broker.email,
    name: broker.name,
    phone: broker.phone,
    agency: broker.agency,
    invitePending: true,
    createdAt: broker.createdAt
  });
});

app.delete("/api/agency/brokers/:id", auth, requireAgencyOwner, (req, res) => {
  const broker = findUserById(req.params.id);
  if (!broker || broker.agencyOwnerId !== req.userId || broker.accountType !== "broker") {
    return res.status(404).json({ message: "Брокер не найден" });
  }
  const transferredProperties = reassignPropertiesToOwner(broker.id, req.userId);
  if (!deleteUserById(broker.id)) {
    return res.status(500).json({ message: "Не удалось удалить брокера" });
  }
  return res.json({ success: true, transferredProperties });
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
