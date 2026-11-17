'use strict';
// ฐานข้อมูล SQLite (ใช้ node:sqlite ที่มากับ Node.js 22+ ไม่ต้องคอมไพล์ native module)
process.removeAllListeners('warning'); // ปิด ExperimentalWarning ของ node:sqlite
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'ev-low.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('field','tfd','region','admin')),
  office        TEXT,                     -- field: กฟส.ในพื้นที่ใช้ไฟฟ้า · region (กบล. กฟข.): รหัส กฟข. เช่น 1.กฟน.1
  email         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- รายชื่อ กฟส.ในพื้นที่ใช้ไฟฟ้า และ กฟข. ที่สังกัด (ผู้ดูแลระบบจัดการได้)
CREATE TABLE IF NOT EXISTS offices (
  id         INTEGER PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  region     TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id                 INTEGER PRIMARY KEY,
  app_no             TEXT UNIQUE NOT NULL,
  office             TEXT NOT NULL,            -- กฟส.ในพื้นที่ใช้ไฟฟ้า
  region             TEXT,                     -- กฟข. เช่น 3.กฟก.2
  province           TEXT,
  district           TEXT,
  ca_no              TEXT,
  meter_no           TEXT,
  request_date       TEXT,
  station_name       TEXT NOT NULL,
  station_address    TEXT,
  company            TEXT,                     -- ชื่อย่อ/แบรนด์ เช่น OR, EA, EGAT
  applicant_name     TEXT NOT NULL,
  contact_name       TEXT,
  email              TEXT,
  phone              TEXT,
  lat                REAL,
  lng                REAL,
  total_kw           REAL,
  total_kva          REAL,
  data               TEXT NOT NULL,            -- ข้อมูลส่วนที่เหลือของแบบฟอร์ม (JSON)
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','ready','completed','cancelled')),
  ready_at           TEXT,                     -- วันเวลาที่เงื่อนไขครบ 3 ข้อ
  low_effective_date TEXT,                     -- วันที่มีผลอัตรา Low (YYYY-MM-DD)
  low_letter_no      TEXT,                     -- เลขที่หนังสือเปลี่ยนอัตรา
  sap_note           TEXT,
  sap_recorded_by    INTEGER REFERENCES users(id),
  completed_at       TEXT,
  cancelled_reason   TEXT,
  source             TEXT NOT NULL DEFAULT 'form',   -- form | import
  import_key         TEXT,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ไฟล์/หลักฐานของคำร้อง (ไฟล์แนบ หรือ ลิงก์ หรือ เลขที่หนังสือ) แยกตาม condition_no
--  0 = แบบฟอร์มคำร้องขอใช้ไฟฟ้า (PDF)                               (กฟส.ในพื้นที่ใช้ไฟฟ้า)
--  1 = หลักฐานการขึ้นทะเบียนเครื่องอัดประจุไฟฟ้ากับ กฟภ.          (กฟส.ในพื้นที่ใช้ไฟฟ้า)
--  2 = ผลตรวจสอบมาตรฐานการติดตั้งก่อนติดตั้งมิเตอร์                 (กฟส.ในพื้นที่ใช้ไฟฟ้า)
--  3 = ผลการทดสอบระบบปฏิบัติการโครงข่าย CPO กับ PEA EVMS           (กทฟ.)
--  4 = ผลการตรวจวัดทดสอบความปลอดภัย (IEC 60364-6 / IEC 61851)      (กฟส.ในพื้นที่ใช้ไฟฟ้า / กทฟ.)
-- เงื่อนไข 1–3 ถือว่าครบเมื่อมีหลักฐานอย่างน้อย 1 รายการที่ผลไม่ใช่ "ไม่ผ่าน"
CREATE TABLE IF NOT EXISTS attachments (
  id             INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  condition_no   INTEGER NOT NULL CHECK (condition_no IN (0,1,2,3,4)),
  stored_name    TEXT,                     -- ไฟล์ในเครื่อง (NULL ถ้าเป็นลิงก์)
  original_name  TEXT,
  mime           TEXT,
  size           INTEGER,
  url            TEXT,                     -- ลิงก์ภายนอก เช่น Google Drive
  doc_no         TEXT,                     -- เลขที่หนังสือ
  doc_date       TEXT,                     -- วันที่หนังสือ (YYYY-MM-DD)
  result         TEXT CHECK (result IN ('pass','fail')),
  note           TEXT,
  uploaded_by    INTEGER REFERENCES users(id),
  uploaded_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ใบแจ้งหนี้ค่าทดสอบ
--  safety = ค่าตรวจวัดทดสอบความปลอดภัย 10,000 บาท/เครื่อง
--  cpo    = ค่าทดสอบ CPO 2,400 หรือ 6,500 บาท/มิเตอร์
CREATE TABLE IF NOT EXISTS invoices (
  id             INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('safety','cpo')),
  request_no     TEXT NOT NULL,            -- เลขที่คำร้อง 12 หลัก
  units          INTEGER NOT NULL,
  unit_price     REAL NOT NULL,
  amount         REAL NOT NULL,
  issued_date    TEXT,
  note           TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id),
  action         TEXT NOT NULL,
  detail         TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  message        TEXT NOT NULL,
  is_read        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ค่าตั้งระบบ (เช่น การเชื่อมต่อ Google Sheets / Drive)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- คิวส่งข้อมูลไป Google (row = แถวคำร้องในชีท, file = อัปโหลดไฟล์เข้า Drive, trash = ลบไฟล์ใน Drive)
CREATE TABLE IF NOT EXISTS sync_queue (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('row','file','trash')),
  ref        TEXT NOT NULL,
  seq        INTEGER NOT NULL DEFAULT 0,      -- เพิ่มทุกครั้งที่ถูกเข้าคิวซ้ำ เพื่อไม่ลบงานที่มีการแก้ไขระหว่างส่ง
  attempts   INTEGER NOT NULL DEFAULT 0,
  next_at    INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (kind, ref)
);

-- เอกสารหลักฐานที่เกี่ยวข้อง (แบบฟอร์ม/ระเบียบ/ข้อตกลง) ให้ทุกคนดาวน์โหลด — ผู้ดูแลระบบจัดการ ไฟล์อยู่ที่ DATA_DIR/docs
CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'other',
  description   TEXT,
  stored_name   TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime          TEXT,
  size          INTEGER,
  sort          INTEGER NOT NULL DEFAULT 0,
  uploaded_by   INTEGER REFERENCES users(id),
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

// กฟข. ทั้ง 12 เขต (ตัวเลขนำหน้าใช้เรียงลำดับ: 1 เหนือ, 2 ตะวันออกเฉียงเหนือ, 3 กลาง, 4 ใต้)
const REGIONS = ['1.กฟน.1', '1.กฟน.2', '1.กฟน.3', '2.กฟฉ.1', '2.กฟฉ.2', '2.กฟฉ.3',
  '3.กฟก.1', '3.กฟก.2', '3.กฟก.3', '4.กฟต.1', '4.กฟต.2', '4.กฟต.3'];

// ---------------------------------------------------------------- migrations (ฐานข้อมูลรุ่นก่อน)
const columnsOf = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));

function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// แปลงผลทดสอบความปลอดภัยจาก Excel ({url, doc_no, iec60364, iec61851}) เป็นหลักฐานหมวด 4
function safetyEvidence(s) {
  const r60364 = s.iec60364 || '-';
  const r61851 = s.iec61851 || '-';
  const anyFail = [s.iec60364, s.iec61851].includes('ไม่ผ่าน');
  const allPass = s.iec60364 === 'ผ่าน' && s.iec61851 === 'ผ่าน';
  return {
    url: s.url || null,
    doc_no: s.doc_no || null,
    result: anyFail ? 'fail' : allPass ? 'pass' : null,
    note: `IEC 60364-6: ${r60364} · IEC 61851: ${r61851}`,
  };
}

(function migrate() {
  // เพิ่มบทบาท region (กบล. กฟข.) — SQLite แก้ CHECK ไม่ได้ ต้องสร้างตาราง users ใหม่ (ขั้นตอนตามเอกสาร SQLite)
  const userSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get().sql;
  if (!userSql.includes("'region'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('field','tfd','region','admin')), office TEXT, email TEXT,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
      INSERT INTO users_new SELECT id, username, password_hash, display_name, role, office, email, active, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
      PRAGMA foreign_keys = ON;`);
  }

  const appCols = columnsOf('applications');
  for (const [name, def] of [['region', 'TEXT'], ['province', 'TEXT'], ['district', 'TEXT'], ['meter_no', 'TEXT'],
    ['company', 'TEXT'], ['low_letter_no', 'TEXT'], ['source', "TEXT NOT NULL DEFAULT 'form'"], ['import_key', 'TEXT'],
    ['drive_folder_url', 'TEXT']]) {
    if (!appCols.has(name)) db.exec(`ALTER TABLE applications ADD COLUMN ${name} ${def}`);
  }
  // ตาราง attachments รุ่นเก่า (stored_name NOT NULL / condition_no 1–3) ต้องสร้างใหม่เพราะ SQLite แก้ CHECK ไม่ได้
  const attSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'attachments'").get().sql;
  if (!attSql.includes('(0,1,2,3,4)')) {
    const keep = [...columnsOf('attachments')].filter((c) => ['id', 'application_id', 'condition_no', 'stored_name', 'original_name',
      'mime', 'size', 'url', 'doc_no', 'doc_date', 'result', 'note', 'uploaded_by', 'uploaded_at'].includes(c)).join(', ');
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      ALTER TABLE attachments RENAME TO attachments_old;
      CREATE TABLE attachments (
        id INTEGER PRIMARY KEY,
        application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        condition_no INTEGER NOT NULL CHECK (condition_no IN (0,1,2,3,4)),
        stored_name TEXT, original_name TEXT, mime TEXT, size INTEGER,
        url TEXT, doc_no TEXT, doc_date TEXT, result TEXT CHECK (result IN ('pass','fail')),
        note TEXT, uploaded_by INTEGER REFERENCES users(id),
        uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
      INSERT INTO attachments (${keep}) SELECT ${keep} FROM attachments_old;
      DROP TABLE attachments_old;
      COMMIT;
      PRAGMA foreign_keys = ON;`);
  }
  // ไฟล์ที่อัปโหลดขึ้น Google Drive แล้ว
  const attCols = columnsOf('attachments');
  for (const name of ['drive_file_id', 'drive_url']) {
    if (!attCols.has(name)) db.exec(`ALTER TABLE attachments ADD COLUMN ${name} TEXT`);
  }

  // การชำระเงินค่าทดสอบ (ติ๊กว่าลูกค้าชำระแล้ว ต่อเลขที่คำร้องแต่ละใบ)
  const invCols = columnsOf('invoices');
  for (const [name, def] of [['paid', 'INTEGER NOT NULL DEFAULT 0'], ['paid_date', 'TEXT'], ['paid_by', 'INTEGER'], ['paid_at', 'TEXT']]) {
    if (!invCols.has(name)) db.exec(`ALTER TABLE invoices ADD COLUMN ${name} ${def}`);
  }
  // คำร้องที่นำเข้าจาก Excel และระบุ "ไม่ต้องชำระค่าทดสอบ" → ไม่ต้องชำระทั้ง 2 รายการ
  const noFee = db.prepare(`SELECT id, data FROM applications WHERE source = 'import'
    AND json_extract(data, '$.payment') IS NULL AND json_extract(data, '$.y3') LIKE '%ไม่ต้องชำระ%'`).all();
  for (const r of noFee) {
    const d = JSON.parse(r.data);
    const reason = `ข้อมูลจาก Excel: ${d.y3}`;
    d.payment = { safety: { exempt: true, reason }, cpo: { exempt: true, reason } };
    db.prepare('UPDATE applications SET data = ? WHERE id = ?').run(JSON.stringify(d), r.id);
  }

  // ผลทดสอบความปลอดภัยที่เคยนำเข้าจาก Excel (data.safety_test) → หลักฐานหมวด 4
  const rows = db.prepare(`SELECT id, data, request_date FROM applications a WHERE source = 'import'
    AND json_extract(data, '$.safety_test') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM attachments t WHERE t.application_id = a.id AND t.condition_no = 4)`).all();
  if (rows.length) {
    const ins = db.prepare(`INSERT INTO attachments (application_id, condition_no, url, doc_no, doc_date, result, note, uploaded_at)
      VALUES (?, 4, ?, ?, ?, ?, ?, ?)`);
    tx(() => rows.forEach((r) => {
      const s = JSON.parse(r.data).safety_test;
      const ins1 = safetyEvidence(s);
      ins.run(r.id, ins1.url, ins1.doc_no, s.date || null, ins1.result, ins1.note, `${s.date || r.request_date || '2000-01-01'} 00:00:00`);
    }));
  }
})();

db.exec(`
CREATE INDEX IF NOT EXISTS idx_app_office_status ON applications(office, status);
CREATE INDEX IF NOT EXISTS idx_app_region ON applications(region);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_import_key ON applications(import_key) WHERE import_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_att_app ON attachments(application_id, condition_no);
CREATE INDEX IF NOT EXISTS idx_evt_app ON events(application_id);
CREATE INDEX IF NOT EXISTS idx_inv_app ON invoices(application_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
`);

// ---------------------------------------------------------------- helpers
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === test.length && crypto.timingSafeEqual(expected, test);
}

// เลขที่คำร้อง EVL-<ปี พ.ศ.>-<ลำดับ> ตามปีของวันที่ยื่นคำร้อง
function nextAppNo(isoDate) {
  const year = isoDate && /^\d{4}/.test(isoDate) ? Number(isoDate.slice(0, 4)) : new Date().getFullYear();
  const prefix = `EVL-${year + 543}-`;
  const last = db.prepare('SELECT app_no FROM applications WHERE app_no LIKE ? ORDER BY app_no DESC LIMIT 1').get(`${prefix}%`);
  const seq = last ? Number(last.app_no.slice(prefix.length)) + 1 : 1;
  return prefix + String(seq).padStart(4, '0');
}

const nowLocal = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// ผู้ใช้ตัวอย่างสำหรับทดลองระบบ (สร้างเฉพาะครั้งแรกที่ฐานข้อมูลยังว่าง)
function seedUsers() {
  const ins = db.prepare(
    'INSERT INTO users (username, password_hash, display_name, role, office) VALUES (?,?,?,?,?)'
  );
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n === 0) {
    const seed = [
      ['admin', 'admin1234', 'ผู้ดูแลระบบ', 'admin', null],
      ['field1', 'pea1234', 'พนักงาน กฟจ.เชียงใหม่', 'field', 'กฟจ.เชียงใหม่'],
      ['field2', 'pea1234', 'พนักงาน กฟจ.ชลบุรี', 'field', 'กฟจ.ชลบุรี'],
      ['tfd1', 'pea1234', 'พนักงาน กทฟ.', 'tfd', 'กทฟ.'],
    ];
    tx(() => seed.forEach(([u, p, d, r, o]) => ins.run(u, hashPassword(p), d, r, o)));
    console.log('สร้างผู้ใช้ตัวอย่าง: admin/admin1234, field1/pea1234, field2/pea1234, tfd1/pea1234');
  }
  // รายชื่อ กฟส. เริ่มต้น: จากข้อมูลที่นำเข้าจาก Excel (ซึ่งระบุ กฟข. มาด้วย) + การไฟฟ้าของบัญชีทดลอง
  if (db.prepare('SELECT COUNT(*) AS n FROM offices').get().n === 0) {
    const insOffice = db.prepare('INSERT OR IGNORE INTO offices (name, region) VALUES (?, ?)');
    tx(() => {
      for (const r of db.prepare(`SELECT DISTINCT office, region FROM applications WHERE source = 'import' AND region IS NOT NULL`).all()) {
        if (REGIONS.includes(r.region)) insOffice.run(r.office, r.region);
      }
      insOffice.run('กฟจ.เชียงใหม่', '1.กฟน.1');
      insOffice.run('กฟจ.ชลบุรี', '3.กฟก.2');
    });
  }
  // บัญชีทดลอง กบล. กฟข. (เพิ่มให้ฐานข้อมูลเดิมที่ยังไม่มีบทบาทนี้)
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'region'").get() && !db.prepare("SELECT 1 FROM users WHERE username = 'region1'").get()) {
    ins.run('region1', hashPassword('pea1234'), 'พนักงาน กบล. กฟน.1', 'region', '1.กฟน.1');
    console.log('สร้างผู้ใช้ตัวอย่าง กบล. กฟข.: region1/pea1234 (กฟน.1)');
  }
}
seedUsers();

module.exports = { db, tx, hashPassword, verifyPassword, nextAppNo, nowLocal, safetyEvidence, REGIONS, DATA_DIR };
