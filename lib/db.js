const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "app.db");
const LEGACY_JSON = path.join(__dirname, "..", "db.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

let _db;

function getDb() {
  if (!_db) {
    throw new Error("Database not initialized");
  }
  return _db;
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name || "",
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    agency: row.agency || "",
    inn: row.inn || "",
    phone: row.phone || "",
    marketingConsent: Boolean(row.marketing_consent),
    telegram: row.telegram || "",
    whatsapp: row.whatsapp || "",
    vk: row.vk || "",
    max: row.max || "",
    role: row.role || "user",
    createdAt: row.created_at
  };
}

function rowToProperty(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title || "",
    address: row.address || "",
    lat: row.lat,
    lon: row.lon,
    price: row.price,
    area: row.area,
    bedrooms: row.bedrooms,
    floor: row.floor,
    totalFloors: row.total_floors,
    ceilingHeight: row.ceiling_height,
    finishing: row.finishing || "",
    readiness: row.readiness || "",
    description: row.description || "",
    photos: safeJson(row.photos_json, []),
    pdfUrl: row.pdf_url || "",
    commissionTotal: row.commission_total,
    commissionPartner: row.commission_partner,
    contacts: safeJson(row.contacts_json, {}),
    createdAt: row.created_at
  };
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function migrateFromJson(db) {
  if (!fs.existsSync(LEGACY_JSON)) {
    return;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(LEGACY_JSON, "utf-8") || "{}");
  } catch {
    return;
  }
  if (!raw.users || !raw.properties) {
    return;
  }
  const insertUser = db.prepare(`
    INSERT OR REPLACE INTO users (
      id, email, password_hash, name, first_name, last_name, phone, agency, inn, marketing_consent,
      telegram, whatsapp, vk, max, role, created_at
    ) VALUES (
      @id, @email, @passwordHash, @name, @firstName, @lastName, @phone, @agency, @inn, @marketingConsent,
      @telegram, @whatsapp, @vk, @max, @role, @createdAt
    )
  `);
  const insertProperty = db.prepare(`
    INSERT OR REPLACE INTO properties (
      id, owner_id, title, address, lat, lon, price, area, bedrooms, floor, total_floors, ceiling_height,
      finishing, readiness, description, photos_json, pdf_url, commission_total, commission_partner, contacts_json, created_at
    ) VALUES (
      @id, @ownerId, @title, @address, @lat, @lon, @price, @area, @bedrooms, @floor, @totalFloors, @ceilingHeight,
      @finishing, @readiness, @description, @photosJson, @pdfUrl, @commissionTotal, @commissionPartner, @contactsJson, @createdAt
    )
  `);
  const tx = db.transaction(() => {
    for (const u of raw.users) {
      insertUser.run({
        id: u.id,
        email: u.email,
        passwordHash: u.passwordHash,
        name: u.name || "",
        firstName: u.firstName || "",
        lastName: u.lastName || "",
        phone: u.phone || "",
        agency: u.agency || "",
        inn: u.inn || "",
        marketingConsent: u.marketingConsent ? 1 : 0,
        telegram: u.telegram || "",
        whatsapp: u.whatsapp || "",
        vk: u.vk || "",
        max: u.max || "",
        role: u.role || "user",
        createdAt: u.createdAt || new Date().toISOString()
      });
    }
    for (const p of raw.properties) {
      insertProperty.run({
        id: p.id,
        ownerId: p.ownerId,
        title: p.title || p.address,
        address: p.address,
        lat: p.lat,
        lon: p.lon,
        price: p.price,
        area: p.area,
        bedrooms: p.bedrooms,
        floor: p.floor ?? null,
        totalFloors: p.totalFloors ?? null,
        ceilingHeight: p.ceilingHeight ?? null,
        finishing: p.finishing || "",
        readiness: p.readiness || "",
        description: p.description || "",
        photosJson: JSON.stringify(p.photos || []),
        pdfUrl: p.pdfUrl || "",
        commissionTotal: p.commissionTotal,
        commissionPartner: p.commissionPartner,
        contactsJson: JSON.stringify(p.contacts || {}),
        createdAt: p.createdAt || new Date().toISOString()
      });
    }
  });
  tx();
  fs.renameSync(LEGACY_JSON, `${LEGACY_JSON}.migrated-${Date.now()}`);
}

function applyAdminEmails(db, adminEmailList) {
  if (!adminEmailList || !adminEmailList.length) {
    return;
  }
  const stmt = db.prepare("UPDATE users SET role = 'admin' WHERE lower(email) = lower(?)");
  for (const email of adminEmailList) {
    if (String(email).trim()) {
      stmt.run(String(email).trim());
    }
  }
}

function seedIfEmpty(db) {
  const n = db.prepare("SELECT count(*) as c FROM properties").get().c;
  if (n > 0) {
    return;
  }
  const sample = [
    {
      id: "sample-1",
      ownerId: "seed",
      title: "Апартаменты в Сити",
      address: "Москва, Пресненская набережная, 8",
      lat: 55.7497,
      lon: 37.5377,
      price: 47500000,
      area: 94,
      bedrooms: 2,
      floor: 18,
      totalFloors: 75,
      ceilingHeight: 3.2,
      finishing: "finished",
      readiness: "resale",
      description: "Премиальные апартаменты с панорамным видом на Москва-Сити.",
      photos: [
        "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200"
      ],
      pdfUrl: "",
      commissionTotal: 6,
      commissionPartner: 3.5,
      createdAt: new Date().toISOString(),
      contacts: {
        phone: "+7 (999) 123-45-67",
        telegram: "@example"
      }
    },
    {
      id: "sample-2",
      ownerId: "seed",
      title: "Вилла у моря",
      address: "Сочи, Курортный проспект, 105",
      lat: 43.5605,
      lon: 39.7427,
      price: 98000000,
      area: 220,
      bedrooms: 4,
      floor: 2,
      totalFloors: 2,
      ceilingHeight: 3.5,
      finishing: "finished",
      readiness: "resale",
      description: "Современная вилла с бассейном и приватной террасой.",
      photos: [
        "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1200"
      ],
      pdfUrl: "",
      commissionTotal: 7,
      commissionPartner: 4.2,
      createdAt: new Date().toISOString(),
      contacts: {
        phone: "+7 (999) 888-88-88",
        telegram: "@example2"
      }
    }
  ];
  const insert = db.prepare(`
    INSERT INTO properties (
      id, owner_id, title, address, lat, lon, price, area, bedrooms, floor, total_floors, ceiling_height,
      finishing, readiness, description, photos_json, pdf_url, commission_total, commission_partner, contacts_json, created_at
    ) VALUES (
      @id, @ownerId, @title, @address, @lat, @lon, @price, @area, @bedrooms, @floor, @totalFloors, @ceilingHeight,
      @finishing, @readiness, @description, @photosJson, @pdfUrl, @commissionTotal, @commissionPartner, @contactsJson, @createdAt
    )
  `);
  for (const p of sample) {
    insert.run({
      id: p.id,
      ownerId: p.ownerId,
      title: p.title,
      address: p.address,
      lat: p.lat,
      lon: p.lon,
      price: p.price,
      area: p.area,
      bedrooms: p.bedrooms,
      floor: p.floor,
      totalFloors: p.totalFloors,
      ceilingHeight: p.ceilingHeight,
      finishing: p.finishing,
      readiness: p.readiness,
      description: p.description,
      photosJson: JSON.stringify(p.photos),
      pdfUrl: p.pdfUrl,
      commissionTotal: p.commissionTotal,
      commissionPartner: p.commissionPartner,
      contactsJson: JSON.stringify(p.contacts),
      createdAt: p.createdAt
    });
  }
}

function initDb(options = {}) {
  ensureDataDir();
  const adminEmails = options.adminEmails || [];
  const createNew = !fs.existsSync(DB_FILE);
  _db = new Database(DB_FILE);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      agency TEXT,
      inn TEXT,
      marketing_consent INTEGER DEFAULT 0,
      telegram TEXT,
      whatsapp TEXT,
      vk TEXT,
      max TEXT,
      role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT,
      address TEXT,
      lat REAL,
      lon REAL,
      price REAL,
      area REAL,
      bedrooms INTEGER,
      floor INTEGER,
      total_floors INTEGER,
      ceiling_height REAL,
      finishing TEXT,
      readiness TEXT,
      description TEXT,
      photos_json TEXT,
      pdf_url TEXT,
      commission_total REAL,
      commission_partner REAL,
      contacts_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner_id);
    CREATE INDEX IF NOT EXISTS idx_properties_commission ON properties(commission_partner);
  `);

  const totalRows = _db.prepare("SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM properties) AS t").get().t;
  const empty = totalRows === 0;
  if (fs.existsSync(LEGACY_JSON) && empty) {
    migrateFromJson(_db);
  }
  applyAdminEmails(_db, adminEmails);
  seedIfEmpty(_db);
  return _db;
}

function findUserByEmail(email) {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE lower(email) = lower(?)")
    .get(String(email || "").trim());
  return rowToUser(row);
}

function findUserById(id) {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id);
  return rowToUser(row);
}

function createUserRecord(user) {
  getDb()
    .prepare(
      `INSERT INTO users (
        id, email, password_hash, name, first_name, last_name, phone, agency, inn, marketing_consent,
        telegram, whatsapp, vk, max, role, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      user.id,
      user.email,
      user.passwordHash,
      user.name || "",
      user.firstName || "",
      user.lastName || "",
      user.phone || "",
      user.agency || "",
      user.inn || "",
      user.marketingConsent ? 1 : 0,
      user.telegram || "",
      user.whatsapp || "",
      user.vk || "",
      user.max || "",
      user.role || "user",
      user.createdAt
    );
}

function listAllUsersForAdmin() {
  return getDb()
    .prepare(
      "SELECT * FROM users ORDER BY datetime(created_at) DESC"
    )
    .all()
    .map((row) => {
      const u = rowToUser(row);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        firstName: u.firstName,
        lastName: u.lastName,
        agency: u.agency,
        inn: u.inn,
        role: u.role,
        createdAt: u.createdAt
      };
    });
}

function listPropertyRowsFiltered(minPrice, maxPrice, bedrooms) {
  let sql = "SELECT * FROM properties WHERE price >= ? AND price <= ?";
  const params = [minPrice, maxPrice];
  if (bedrooms !== null && bedrooms !== undefined) {
    sql += " AND bedrooms = ?";
    params.push(bedrooms);
  }
  sql += " ORDER BY commission_partner DESC";
  return getDb()
    .prepare(sql)
    .all(...params)
    .map((row) => rowToProperty(row));
}

function findPropertyById(id) {
  const row = getDb().prepare("SELECT * FROM properties WHERE id = ?").get(id);
  return rowToProperty(row);
}

function listPropertiesByOwner(ownerId) {
  return getDb()
    .prepare("SELECT * FROM properties WHERE owner_id = ? ORDER BY datetime(created_at) DESC")
    .all(ownerId)
    .map((r) => rowToProperty(r));
}

function insertProperty(p) {
  getDb()
    .prepare(
      `INSERT INTO properties (
        id, owner_id, title, address, lat, lon, price, area, bedrooms, floor, total_floors, ceiling_height,
        finishing, readiness, description, photos_json, pdf_url, commission_total, commission_partner, contacts_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      p.id,
      p.ownerId,
      p.title,
      p.address,
      p.lat,
      p.lon,
      p.price,
      p.area,
      p.bedrooms,
      p.floor,
      p.totalFloors,
      p.ceilingHeight,
      p.finishing,
      p.readiness,
      p.description,
      JSON.stringify(p.photos || []),
      p.pdfUrl || "",
      p.commissionTotal,
      p.commissionPartner,
      JSON.stringify(p.contacts || {}),
      p.createdAt
    );
}

function updatePropertyRow(p) {
  getDb()
    .prepare(
      `UPDATE properties SET
        title = ?, address = ?, lat = ?, lon = ?, price = ?, area = ?, bedrooms = ?, floor = ?, total_floors = ?,
        ceiling_height = ?, finishing = ?, readiness = ?, description = ?, photos_json = ?, pdf_url = ?,
        commission_total = ?, commission_partner = ?, contacts_json = ?
      WHERE id = ? AND owner_id = ?`
    )
    .run(
      p.title,
      p.address,
      p.lat,
      p.lon,
      p.price,
      p.area,
      p.bedrooms,
      p.floor,
      p.totalFloors,
      p.ceilingHeight,
      p.finishing,
      p.readiness,
      p.description,
      JSON.stringify(p.photos || []),
      p.pdfUrl || "",
      p.commissionTotal,
      p.commissionPartner,
      JSON.stringify(p.contacts || {}),
      p.id,
      p.ownerId
    );
}

function deletePropertyByOwner(id, ownerId) {
  const r = getDb().prepare("DELETE FROM properties WHERE id = ? AND owner_id = ?").run(id, ownerId);
  return r.changes > 0;
}

function countAllProperties() {
  return getDb().prepare("SELECT count(*) as c FROM properties").get().c;
}

function countAllUsers() {
  return getDb().prepare("SELECT count(*) as c FROM users").get().c;
}

function listAllPropertiesForAdmin() {
  const rows = getDb()
    .prepare(
      `SELECT
        p.id,
        p.owner_id,
        p.title,
        p.address,
        p.price,
        p.created_at,
        u.email AS owner_email,
        u.name AS owner_name
      FROM properties p
      LEFT JOIN users u ON p.owner_id = u.id
      ORDER BY datetime(p.created_at) DESC`
    )
    .all();
  return rows.map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    ownerEmail: row.owner_email || "—",
    ownerName: row.owner_name || "—",
    title: row.title || "",
    address: row.address || "",
    price: row.price,
    createdAt: row.created_at
  }));
}

function deletePropertyById(id) {
  return getDb().prepare("DELETE FROM properties WHERE id = ?").run(id).changes > 0;
}

function stripContacts(p) {
  if (!p) {
    return p;
  }
  const o = { ...p };
  delete o.contacts;
  return o;
}

module.exports = {
  initDb,
  getDb,
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
  rowToUser,
  rowToProperty,
  listAllPropertiesForAdmin,
  deletePropertyById
};
