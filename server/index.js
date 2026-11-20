'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const contentDisposition = require('content-disposition');
const { db, tx, hashPassword, verifyPassword, nextAppNo, nowLocal: now, REGIONS, DATA_DIR } = require('./db');
const googleSync = require('./google-sync');

const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SESSION_HOURS = 12;
const MAX_FILE_MB = 20;
const CRITERIA_COUNT = 8; // คุณลักษณะสถานีที่ต้องมีครบทุกข้อ (ข้อ 2 ในแบบฟอร์ม)

// หมวดไฟล์/หลักฐาน (attachments.condition_no) และผู้มีสิทธิ์บันทึก
const CONDITIONS = {
  0: { label: 'แบบฟอร์มคำร้องขอใช้ไฟฟ้า', roles: ['field', 'admin'] },
  1: { label: 'หลักฐานการขึ้นทะเบียนเครื่องอัดประจุไฟฟ้ากับ กฟภ.', roles: ['field', 'region', 'admin'] },
  2: { label: 'ผลตรวจสอบมาตรฐานการติดตั้งระบบอัดประจุยานยนต์ไฟฟ้าก่อนติดตั้งมิเตอร์', roles: ['field', 'region', 'admin'] },
  3: { label: 'ผลการทดสอบระบบปฏิบัติการโครงข่ายไฟฟ้า CPO กับ PEA EVMS', roles: ['tfd', 'admin'] },
  4: { label: 'ผลการตรวจวัดทดสอบความปลอดภัย', roles: ['field', 'region', 'admin'] },
};
const condName = (n) => (n >= 1 && n <= 3 ? `เงื่อนไขที่ ${n} (${CONDITIONS[n].label})` : CONDITIONS[n].label);
const RESULT_LABEL = { pass: 'ผ่าน', fail: 'ไม่ผ่าน' };
const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx', '.zip']);

// อัตราค่าทดสอบ
const FEES = {
  safety: { label: 'ค่าทดสอบความปลอดภัย', unit: 'เครื่อง', prices: [10000] },
  cpo: { label: 'ค่าทดสอบ CPO', unit: 'มิเตอร์', prices: [2400, 6500] },
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// ---------------------------------------------------------------- auth
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token, maxAgeSec) {
  res.setHeader('Set-Cookie',
    `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}` +
    (process.env.COOKIE_SECURE === '1' ? '; Secure' : ''));
}

const publicUser = (u) => u && ({
  id: u.id, username: u.username, display_name: u.display_name, role: u.role, office: u.office, email: u.email,
});

app.use((req, _res, next) => {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) {
    const row = db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`).get(token, Date.now());
    if (row) {
      req.user = row;
      req.sessionToken = token;
    }
  }
  next();
});

const requireAuth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'กรุณาเข้าสู่ระบบ')));
const requireRole = (...roles) => (req, _res, next) =>
  (roles.includes(req.user?.role) ? next() : next(new HttpError(403, 'ไม่มีสิทธิ์ดำเนินการ')));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username || '').trim());
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) fail(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
    .run(token, user.id, Date.now() + SESSION_HOURS * 3600e3);
  setSessionCookie(res, token, SESSION_HOURS * 3600);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/me/password', requireAuth, (req, res) => {
  const { current, next: newPass } = req.body || {};
  if (!verifyPassword(String(current || ''), req.user.password_hash)) fail(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  if (String(newPass || '').length < 6) fail(400, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPass), req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- helpers
// ทุกการเปลี่ยนแปลงของคำร้องผ่านฟังก์ชันนี้ จึงใช้เป็นจุดส่งแถวคำร้องเข้าคิว Google Sheets ด้วย
function logEvent(appId, userId, action, detail = null) {
  db.prepare('INSERT INTO events (application_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?)')
    .run(appId, userId, action, detail, now());
  googleSync.queueApp(appId);
}

function notify(userIds, appId, type, message) {
  const ins = db.prepare(
    'INSERT INTO notifications (user_id, application_id, type, message, created_at) VALUES (?,?,?,?,?)');
  const ts = now();
  for (const uid of new Set(userIds)) ins.run(uid, appId, type, message, ts);
}
const fieldUsersOf = (office) =>
  db.prepare("SELECT id FROM users WHERE role = 'field' AND active = 1 AND office = ?").all(office).map((r) => r.id);
const tfdUsers = () =>
  db.prepare("SELECT id FROM users WHERE role = 'tfd' AND active = 1").all().map((r) => r.id);
const regionUsersOf = (region) => (region
  ? db.prepare("SELECT id FROM users WHERE role = 'region' AND active = 1 AND office = ?").all(region).map((r) => r.id) : []);

function getApp(id) {
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(Number(id));
  if (!row) fail(404, 'ไม่พบคำร้อง');
  return row;
}

const sameOffice = (user, row) => user.role === 'field' && user.office === row.office;
const sameRegion = (user, row) => user.role === 'region' && !!row.region && user.office === row.region;
// กฟส. ดู/บันทึกได้เฉพาะคำร้องของ กฟส. ตนเอง, กบล. เฉพาะในเขตตนเอง; กทฟ./ผู้ดูแลระบบ ทุกพื้นที่
// (ภาพรวมทั่วประเทศดูได้เฉพาะตัวเลขสรุปและหมุดบนแผนที่ที่ไม่มีรายละเอียด — /api/stats?scope=all, /api/map)
const inArea = (user, row) =>
  (user.role === 'field' ? sameOffice(user, row) : user.role === 'region' ? sameRegion(user, row) : true);
const canView = inArea;
const isOpen = (row) => row.status === 'pending' || row.status === 'ready';
const canEditForm = (user, row) =>
  (user.role === 'admin' && row.status !== 'cancelled') || (sameOffice(user, row) && isOpen(row));
// ---------------------------------------------------------------- การชำระเงินค่าทดสอบ (ต้องครบก่อนตรวจเงื่อนไข 1–3)
// แต่ละรายการ (ค่าทดสอบความปลอดภัย / ค่าทดสอบ CPO) ผ่านเมื่อ "ไม่ต้องชำระ" หรือมีเลขที่คำร้องอย่างน้อย 1 ใบและชำระครบทุกใบ
const PAY_ITEM = (type, alias = 'a') => `(COALESCE(json_extract(${alias}.data, '$.payment.${type}.exempt'), 0) = 1
  OR (EXISTS (SELECT 1 FROM invoices i WHERE i.application_id = ${alias}.id AND i.type = '${type}')
      AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.application_id = ${alias}.id AND i.type = '${type}' AND i.paid = 0)))`;
// สถานะผลทดสอบความปลอดภัย (ข้อมูลประกอบ ไม่ใช่เงื่อนไข): none = ยังไม่มีผล, pass = มีผลผ่าน, recorded = บันทึกแล้วแต่ไม่ระบุผล, fail = ไม่ผ่านทั้งหมด
const SAFETY = (alias = 'a') => `(SELECT CASE WHEN COUNT(*) = 0 THEN 'none' WHEN SUM(t.result = 'pass') > 0 THEN 'pass'
  WHEN SUM(COALESCE(t.result, '') NOT IN ('pass','fail')) > 0 THEN 'recorded' ELSE 'fail' END
  FROM attachments t WHERE t.application_id = ${alias}.id AND t.condition_no = 4)`;
const PAID = (alias = 'a') => `(${PAY_ITEM('safety', alias)} AND ${PAY_ITEM('cpo', alias)})`;

function paymentInfo(appId) {
  const a = db.prepare(`SELECT data, ${PAY_ITEM('safety')} AS s, ${PAY_ITEM('cpo')} AS c FROM applications a WHERE id = ?`).get(Number(appId));
  const pay = JSON.parse(a?.data || '{}').payment || {};
  const item = (type, done) => ({ done: !!done, exempt: !!pay[type]?.exempt, reason: pay[type]?.reason || '' });
  const safety = item('safety', a?.s); const cpo = item('cpo', a?.c);
  return { safety, cpo, done: safety.done && cpo.done };
}
const paymentDone = (appId) => paymentInfo(appId).done;

const canUpload = (user, row, cond) =>
  isOpen(row) && CONDITIONS[cond]?.roles.includes(user.role) && inArea(user, row)
  && (cond < 1 || cond > 3 || paymentDone(row.id)) // เงื่อนไข 1–3 ต้องชำระค่าทดสอบครบก่อน
  && !(cond === 3 && isVolta(row.data)); // PEA VOLTA ผ่านเงื่อนไข 3 แล้ว ไม่ต้องทดสอบ CPO

// กฟข. ของ กฟส. จากรายชื่อในระบบ
const officeRow = (name) => db.prepare('SELECT * FROM offices WHERE name = ? AND active = 1').get(String(name || ''));
// เลขที่คำร้องค่าทดสอบ/การชำระเงิน: กฟส. ของคำร้อง หรือ กบล. กฟข. ในเขต
const canInvoice = (user, row) => row.status !== 'cancelled' && (user.role === 'admin' || sameOffice(user, row) || sameRegion(user, row));
const canRecordLow = (user, row) =>
  (row.status === 'ready' || row.status === 'completed') && (user.role === 'admin' || sameOffice(user, row));

// สถานีที่ใช้ PEA VOLTA Platform (ข้อ 8): ผ่านเงื่อนไขที่ 3 โดยไม่ต้องทดสอบ CPO–PEA EVMS
// เพราะเทียบเคียงกับหลักเกณฑ์การทดสอบ CPO ตามหนังสือ กบท.(บย)683/2567 (อนุมัติ ผวก. 13 พ.ค. 2567)
// ข้อมูลเก่าที่ยังไม่มี cpo.platform ดูจากชื่อระบบ CPO ที่มีคำว่า VOLTA
const VOLTA_LETTER = 'กบท.(บย)683/2567';
const VOLTA = (alias = 'a') => `(COALESCE(json_extract(${alias}.data, '$.cpo.platform'),
  CASE WHEN json_extract(${alias}.data, '$.cpo.system_name') LIKE '%VOLTA%' THEN 'volta' END) = 'volta')`;
function isVolta(data) {
  const cpo = (typeof data === 'string' ? JSON.parse(data || '{}') : data || {}).cpo || {};
  return cpo.platform ? cpo.platform === 'volta' : /volta/i.test(cpo.system_name || '');
}
// ชื่อย่อ CPO สำหรับกรอบสี่เหลี่ยมในรายการคำร้อง (ข้อมูลเก่าใช้ชื่อย่อบริษัทที่นำเข้าจาก Excel)
const CPO_SHORT = (alias = 'a') => `CASE WHEN ${VOLTA(alias)} THEN 'VOLTA'
  ELSE COALESCE(NULLIF(json_extract(${alias}.data, '$.cpo.short'), ''), ${alias}.company) END`;

// เงื่อนไขครบ = มีหลักฐานอย่างน้อย 1 รายการที่ผลไม่ใช่ "ไม่ผ่าน" (เงื่อนไข 3: หรือใช้ PEA VOLTA)
const MET = (n, alias = 'a') =>
  `(${n === 3 ? `${VOLTA(alias)} OR ` : ''}EXISTS (SELECT 1 FROM attachments t WHERE t.application_id = ${alias}.id AND t.condition_no = ${n} AND COALESCE(t.result,'pass') <> 'fail'))`;

function conditionFlags(appId) {
  const rows = db.prepare(`SELECT DISTINCT condition_no FROM attachments
    WHERE application_id = ? AND COALESCE(result,'pass') <> 'fail'`).all(appId);
  const set = new Set(rows.map((r) => r.condition_no));
  const volta = isVolta(db.prepare('SELECT data FROM applications WHERE id = ?').get(appId)?.data);
  return { c1: set.has(1), c2: set.has(2), c3: set.has(3) || volta, c3_volta: volta };
}

// คำนวณสถานะใหม่หลังเพิ่ม/ลบหลักฐาน และแจ้งเตือนเมื่อเงื่อนไขครบ 3 ข้อ
function recomputeStatus(appId, userId) {
  const row = getApp(appId);
  if (!isOpen(row)) return row.status;
  const f = conditionFlags(appId);
  const complete = paymentDone(appId) && f.c1 && f.c2 && f.c3;
  if (complete && row.status === 'pending') {
    db.prepare("UPDATE applications SET status = 'ready', ready_at = ?, updated_at = ? WHERE id = ?")
      .run(now(), now(), appId);
    logEvent(appId, userId, 'ready', 'เงื่อนไขครบทั้ง 3 ข้อ — รอ กฟส.ในพื้นที่ใช้ไฟฟ้า เปลี่ยนอัตรา Low ในระบบ SAP');
    notify(fieldUsersOf(row.office), appId, 'ready',
      `${row.app_no} ${row.station_name}: เงื่อนไขครบ 3 ข้อแล้ว กรุณาเปลี่ยนอัตรา Low ในระบบ SAP และบันทึกวันที่มีผล`);
    return 'ready';
  }
  if (!complete && row.status === 'ready') {
    db.prepare("UPDATE applications SET status = 'pending', ready_at = NULL, updated_at = ? WHERE id = ?")
      .run(now(), appId);
    logEvent(appId, userId, 'unready', paymentDone(appId)
      ? 'เงื่อนไขไม่ครบ 3 ข้อ (มีการลบหลักฐานหรือผลไม่ผ่าน)' : 'การชำระเงินค่าทดสอบยังไม่ครบ');
    return 'pending';
  }
  return row.status;
}

// เรียกหลังมีการเปลี่ยนแปลงเรื่องการชำระเงิน: แจ้งเตือนเมื่อชำระครบ แล้วคำนวณสถานะใหม่
function afterPaymentChange(appId, userId, wasDone) {
  const row = getApp(appId);
  if (!isOpen(row)) return row.status;
  if (!wasDone && paymentDone(appId)) {
    logEvent(appId, userId, 'paid', 'ชำระเงินค่าทดสอบครบแล้ว — ตรวจสอบเงื่อนไข 1–3 ได้');
    const msg = `${row.app_no} ${row.station_name}: ชำระเงินค่าทดสอบครบแล้ว`;
    if (!isVolta(row.data)) notify(tfdUsers(), appId, 'paid', `${msg} — ดำเนินการทดสอบระบบ CPO กับ PEA EVMS ได้`);
    notify(regionUsersOf(row.region), appId, 'paid', `${msg} — ดำเนินการตรวจวัดทดสอบความปลอดภัยได้`);
  }
  return recomputeStatus(appId, userId);
}

const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const num = (v) => {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
// วันที่แบบไทยสำหรับข้อความประวัติ เช่น 2026-11-17 → 17 พ.ย. 2569
const thaiDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
const isUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || ''));

// ตรวจสอบและจัดรูปข้อมูลแบบฟอร์มขอใช้ไฟฟ้า EV Low Priority
function normalizeForm(body) {
  const b = body || {};
  const errors = [];
  const rows = (arr, map) => (Array.isArray(arr) ? arr : []).map(map).filter(Boolean).slice(0, 50);

  const chargers = rows(b.chargers, (r) => {
    const c = { brand: str(r?.brand, 100), model: str(r?.model, 100), kw: num(r?.kw), qty: num(r?.qty) };
    return c.brand || c.model || c.kw ? c : null;
  });
  const equipment = rows(b.equipment, (r) => {
    const e = { type: str(r?.type, 200), kw: num(r?.kw), qty: num(r?.qty) };
    return e.type || e.kw ? e : null;
  });
  const sumKw = (list) => Math.round(list.reduce((s, r) => s + (r.kw || 0) * (r.qty || 0), 0) * 100) / 100;
  const pick = (v, allowed) => (allowed.includes(v) ? v : '');
  const strList = (v, max = 20) => (Array.isArray(v) ? v.map((x) => str(x, 60)).filter(Boolean).slice(0, max) : []);

  const criteria = Array.from({ length: CRITERIA_COUNT }, (_, i) => Boolean(b.criteria?.[i]));
  const data = {
    applicant_type: pick(b.applicant_type, ['juristic', 'person', 'government']),
    location_type: str(b.location_type, 100),
    location_other: str(b.location_other, 200),
    criteria,
    charge_channels: strList(b.charge_channels),
    channel_other: str(b.channel_other, 200),
    service_hours: pick(b.service_hours, ['24', 'lt24']),
    chargers,
    equipment,
    equipment_total_kw: sumKw(equipment),
    revenue: strList(b.revenue),
    revenue_other: str(b.revenue_other, 200),
    cpo: pick(b.cpo?.platform, ['volta', 'other']) === 'volta'
      ? { platform: 'volta', system_name: 'PEA VOLTA', short: 'VOLTA', provider: 'การไฟฟ้าส่วนภูมิภาค (กฟภ.)', email: '', phone: '' }
      : {
        platform: pick(b.cpo?.platform, ['other']),
        system_name: str(b.cpo?.system_name, 200),
        short: str(b.cpo?.short, 8).toUpperCase(),
        provider: str(b.cpo?.provider, 200),
        email: str(b.cpo?.email, 200),
        phone: str(b.cpo?.phone, 50),
      },
    documents: strList(b.documents, 60),
    documents_other: str(b.documents_other, 500),
    test_60364: pick(b.test_60364, ['pea', 'third_party']),
    test_61851: pick(b.test_61851, ['registered', 'pea']),
    remark: str(b.remark, 2000),
  };

  const cols = {
    region: str(b.region, 50),
    province: str(b.province, 100),
    district: str(b.district, 100),
    ca_no: str(b.ca_no, 30),
    meter_no: str(b.meter_no, 30),
    request_date: isDate(b.request_date) ? b.request_date : null,
    station_name: str(b.station_name, 300),
    station_address: str(b.station_address, 1000),
    applicant_name: str(b.applicant_name, 300),
    contact_name: str(b.contact_name, 200),
    email: str(b.email, 200),
    phone: str(b.phone, 50),
    lat: num(b.lat),
    lng: num(b.lng),
    total_kw: sumKw(chargers),
    total_kva: num(b.total_kva),
  };

  if (!cols.station_name) errors.push('ชื่อสถานีอัดประจุไฟฟ้า');
  if (!cols.applicant_name) errors.push('ชื่อผู้ขอใช้ไฟฟ้า');
  if (!cols.ca_no) errors.push('Contract Account (CA)');
  if (!cols.meter_no) errors.push('Meter No. / PEA No.');
  if (!data.location_type) errors.push('ข้อ 1 สถานีอัดประจุไฟฟ้าอยู่ในพื้นที่');
  if (data.location_type === 'อื่นๆ' && !data.location_other) errors.push('ข้อ 1 ระบุพื้นที่ (อื่นๆ)');
  if (!criteria.every(Boolean)) errors.push('ข้อ 2 คุณลักษณะสถานีต้องมีครบทุกข้อ');
  if (!data.charge_channels.length) errors.push('ข้อ 2 ช่องทางการอัดประจุไฟฟ้าอย่างน้อย 1 ช่องทาง');
  if (!data.service_hours) errors.push('ข้อ 3 เวลาเปิดให้บริการ');
  if (cols.lat != null && (cols.lat < -90 || cols.lat > 90)) errors.push('ข้อ 4 ค่า Latitude ไม่ถูกต้อง');
  if (cols.lng != null && (cols.lng < -180 || cols.lng > 180)) errors.push('ข้อ 4 ค่า Longitude ไม่ถูกต้อง');
  if (!chargers.some((c) => c.qty > 0 && (c.brand || c.model))) errors.push('ข้อ 5 รายละเอียดเครื่องอัดประจุไฟฟ้าอย่างน้อย 1 รายการ');
  if (!data.cpo.platform) errors.push('ข้อ 8 ระบบ CPO (เลือก PEA VOLTA หรืออื่นๆ)');
  if (data.cpo.platform === 'other') {
    if (!data.cpo.system_name) errors.push('ข้อ 8 ชื่อระบบให้บริการ (CPO / Platform)');
    if (!data.cpo.short) errors.push('ข้อ 8 ชื่อย่อ CPO');
    if (!data.cpo.provider) errors.push('ข้อ 8 ชื่อผู้ให้บริการ (CPO)');
  }
  if (!data.test_60364) errors.push('ข้อ 9.1 ผู้ดำเนินการตรวจวัดตาม IEC 60364-6');
  if (!data.test_61851) errors.push('ข้อ 9.2 การทดสอบตาม IEC 61851');

  return { cols, data, errors };
}

// ขอบเขตข้อมูล: รายการคำร้อง/CSV ของ กฟส./กบล. เป็นพื้นที่ตนเองเสมอ
// scope=all ใช้ได้เฉพาะตัวเลขสรุป (/api/stats) — ส่ง allowAll = true
function scopeWhere(user, params, scope, allowAll = false) {
  if (scope === 'all' && allowAll) return '1=1';
  if (user.role === 'field') {
    params.push(user.office);
    return 'a.office = ?';
  }
  if (user.role === 'region') {
    params.push(user.office);
    return 'a.region = ?';
  }
  return '1=1';
}

// กฟส./กฟข. ของคำร้อง: กฟส. ใช้การไฟฟ้าของตนเองเสมอ, ผู้ดูแลระบบเลือกจากรายชื่อ, กฟข. อ้างอิงจากรายชื่อ กฟส.
function resolveArea(user, body, current) {
  const name = user.role === 'admin' ? (str(body?.office, 100) || current?.office || '') : (current?.office || user.office || '');
  if (!name) fail(400, 'กรุณาเลือก กฟส.ในพื้นที่ใช้ไฟฟ้า');
  const o = officeRow(name);
  if (o) return { office: o.name, region: o.region };
  if (user.role === 'admin' && name !== current?.office) {
    fail(400, `ไม่พบ "${name}" ในรายชื่อ กฟส. — เพิ่มที่หน้า "การไฟฟ้า (กฟส.)" ก่อน`);
  }
  // ข้อมูลเดิมที่ กฟส. ยังไม่อยู่ในรายชื่อ: ใช้ กฟข. ที่ระบุมา
  const region = REGIONS.includes(body?.region) ? body.region : current?.region;
  if (!REGIONS.includes(region)) fail(400, `"${name}" ยังไม่อยู่ในรายชื่อ กฟส. กรุณาแจ้งผู้ดูแลระบบให้เพิ่ม`);
  return { office: name, region };
}

function listApplications(user, q = {}) {
  const params = [];
  const where = [scopeWhere(user, params, q.scope)];
  if (['pending', 'ready', 'completed', 'cancelled'].includes(q.status)) {
    where.push('a.status = ?'); params.push(q.status);
  } else if (q.status === 'open') {
    where.push("a.status IN ('pending','ready')");
  }
  if (['1', '2', '3'].includes(String(q.missing))) {
    where.push(`a.status = 'pending' AND NOT ${MET(Number(q.missing))}`);
  }
  if (q.office && user.role !== 'field') { where.push('a.office = ?'); params.push(String(q.office)); }
  if (q.region && !['field', 'region'].includes(user.role)) { where.push('a.region = ?'); params.push(String(q.region)); }
  if (q.missing === 'payment') where.push(`a.status = 'pending' AND NOT ${PAID()}`);
  if (q.missing === 'safety') {
    where.push("a.status IN ('pending','ready') AND NOT EXISTS (SELECT 1 FROM attachments t WHERE t.application_id = a.id AND t.condition_no = 4)");
  }
  if (q.q) {
    const like = `%${String(q.q).trim()}%`;
    where.push(`(a.app_no LIKE ? OR a.station_name LIKE ? OR a.applicant_name LIKE ? OR a.company LIKE ?
      OR a.ca_no LIKE ? OR a.meter_no LIKE ? OR a.province LIKE ? OR a.office LIKE ?
      OR json_extract(a.data, '$.cpo.short') LIKE ? OR json_extract(a.data, '$.cpo.system_name') LIKE ?)`);
    params.push(like, like, like, like, like, like, like, like, like, like);
  }
  return db.prepare(`
    SELECT a.id, a.app_no, a.office, a.region, a.province, a.district, a.ca_no, a.meter_no, a.request_date,
           a.station_name, a.company, a.applicant_name, a.total_kw, a.total_kva, a.status, a.ready_at,
           a.low_effective_date, a.low_letter_no, a.completed_at, a.created_at, a.source, a.lat, a.lng,
           ${MET(1)} AS c1, ${MET(2)} AS c2, ${MET(3)} AS c3, ${VOLTA()} AS volta, ${CPO_SHORT()} AS cpo_short,
           (SELECT group_concat(request_no, ' ') FROM invoices i WHERE i.application_id = a.id AND i.type = 'safety') AS inv_safety,
           (SELECT group_concat(request_no, ' ') FROM invoices i WHERE i.application_id = a.id AND i.type = 'cpo') AS inv_cpo,
           ${PAID()} AS paid,
           ${SAFETY()} AS safety
    FROM applications a
    WHERE ${where.join(' AND ')}
    ORDER BY CASE a.status WHEN 'ready' THEN 0 WHEN 'pending' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
             COALESCE(a.request_date, a.created_at) DESC, a.id DESC
    LIMIT 2000`).all(...params).map((r) => ({ ...r, c1: !!r.c1, c2: !!r.c2, c3: !!r.c3, volta: !!r.volta, paid: !!r.paid }));
}

// ---------------------------------------------------------------- applications
app.get('/api/stats', requireAuth, (req, res) => {
  const params = [];
  const scope = scopeWhere(req.user, params, req.query.scope, true);
  const counts = db.prepare(`SELECT a.status, COUNT(*) AS n FROM applications a WHERE ${scope} GROUP BY a.status`).all(...params);
  const by = Object.fromEntries(counts.map((r) => [r.status, r.n]));
  const missing = {};
  for (const n of [1, 2, 3]) {
    missing[n] = db.prepare(`SELECT COUNT(*) AS n FROM applications a WHERE ${scope} AND a.status = 'pending'
      AND NOT ${MET(n)}`).get(...params).n;
  }
  missing.payment = db.prepare(`SELECT COUNT(*) AS n FROM applications a WHERE ${scope} AND a.status = 'pending'
    AND NOT ${PAID()}`).get(...params).n;
  const avg = db.prepare(`SELECT AVG(julianday(a.low_effective_date) - julianday(COALESCE(a.request_date, a.created_at))) AS d
    FROM applications a WHERE ${scope} AND a.status = 'completed' AND a.low_effective_date IS NOT NULL`).get(...params).d;
  const safetyPending = db.prepare(`SELECT COUNT(*) AS n FROM applications a WHERE ${scope} AND a.status IN ('pending','ready')
    AND NOT EXISTS (SELECT 1 FROM attachments t WHERE t.application_id = a.id AND t.condition_no = 4)`).get(...params).n;
  res.json({
    safety_pending: safetyPending,
    total: counts.reduce((s, r) => s + r.n, 0),
    pending: by.pending || 0, ready: by.ready || 0, completed: by.completed || 0, cancelled: by.cancelled || 0,
    missing, avg_days_to_complete: avg == null ? null : Math.round(avg),
  });
});

app.get('/api/lookups', requireAuth, (_req, res) => {
  const list = (sql) => db.prepare(sql).all().map((r) => r.v).filter(Boolean);
  res.json({
    offices: db.prepare('SELECT name, region FROM offices WHERE active = 1 ORDER BY region, name').all(),
    regions: REGIONS,
    provinces: list('SELECT DISTINCT province AS v FROM applications WHERE province IS NOT NULL AND province <> \'\' ORDER BY 1'),
  });
});

app.get('/api/applications', requireAuth, (req, res) => res.json(listApplications(req.user, req.query)));

// หมุดแผนที่ทั่วประเทศ: คำร้องในพื้นที่ตนเองมีรายละเอียดและลิงก์, พื้นที่อื่นมีเฉพาะพิกัด/สถานะ/กฟส./จังหวัด (ไม่มี id ชื่อสถานี ผู้ขอใช้ไฟฟ้า)
app.get('/api/map', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.app_no, a.office, a.region, a.province, a.station_name, a.company, a.applicant_name, a.status,
           a.low_effective_date, a.lat, a.lng, ${MET(1)} AS c1, ${MET(2)} AS c2, ${MET(3)} AS c3, ${PAID()} AS paid,
           ${CPO_SHORT()} AS cpo_short
    FROM applications a WHERE a.lat IS NOT NULL AND a.lng IS NOT NULL`).all();
  const all = req.query.scope === 'all';
  res.json(rows.filter((r) => all || inArea(req.user, r)).map((r) => (inArea(req.user, r)
    ? { ...r, mine: true, c1: !!r.c1, c2: !!r.c2, c3: !!r.c3, paid: !!r.paid }
    : { mine: false, office: r.office, region: r.region, province: r.province, status: r.status, lat: r.lat, lng: r.lng })));
});

app.get('/api/applications/export.csv', requireAuth, (req, res) => {
  const STATUS = { pending: 'รอเงื่อนไข', ready: 'รอเปลี่ยนอัตราใน SAP', completed: 'เสร็จสมบูรณ์', cancelled: 'ยกเลิก' };
  const yn = (b) => (b ? 'ครบ' : '-');
  const SAFETY_TEXT = { none: 'ยังไม่มีผล', pass: 'ผ่าน', recorded: 'บันทึกแล้ว', fail: 'ไม่ผ่าน' };
  const header = ['เลขที่คำร้อง', 'วันที่ยื่นคำร้อง', 'ชื่อสถานี', 'ชื่อย่อ CPO / บริษัท', 'ผู้ขอใช้ไฟฟ้า', 'กฟส.ในพื้นที่ใช้ไฟฟ้า', 'กฟข.', 'อำเภอ', 'จังหวัด',
    'CA', 'Meter No.', 'kW รวม', 'kVA', 'เงื่อนไข 1 ขึ้นทะเบียน', 'เงื่อนไข 2 ตรวจการติดตั้ง', 'เงื่อนไข 3 ทดสอบ CPO-EVMS',
    'เลขที่คำร้องค่าทดสอบความปลอดภัย', 'เลขที่คำร้องค่าทดสอบ CPO', 'ชำระค่าทดสอบครบ', 'ผลทดสอบความปลอดภัย',
    'สถานะ', 'วันที่ครบเงื่อนไข', 'หนังสือเปลี่ยนอัตรา', 'วันที่มีผลอัตรา Low'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = listApplications(req.user, req.query).map((r) => [r.app_no, r.request_date, r.station_name, r.cpo_short,
    r.applicant_name, r.office, r.region, r.district, r.province, r.ca_no, r.meter_no, r.total_kw, r.total_kva,
    yn(r.c1), yn(r.c2), r.volta ? 'ครบ (PEA VOLTA)' : yn(r.c3), r.inv_safety, r.inv_cpo, r.paid ? 'ครบ' : 'ค้างชำระ', SAFETY_TEXT[r.safety], STATUS[r.status], r.ready_at, r.low_letter_no, r.low_effective_date].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', contentDisposition(`ev-low-priority-${now().slice(0, 10)}.csv`));
  res.send('﻿' + [header.map(esc).join(','), ...lines].join('\r\n'));
});

// company (ชื่อย่อบริษัท) ไม่อยู่ในแบบฟอร์มแล้ว — คงค่าเดิมของข้อมูลที่นำเข้าจาก Excel ไว้
const APP_COLS = ['region', 'province', 'district', 'ca_no', 'meter_no', 'request_date', 'station_name', 'station_address',
  'applicant_name', 'contact_name', 'email', 'phone', 'lat', 'lng', 'total_kw', 'total_kva'];

// ไฟล์ PDF ที่แนบมาพร้อมการรับคำร้อง: แบบฟอร์มคำร้อง + หลักฐานเงื่อนไข 1–3
// ตอนรับคำร้องแนบได้เฉพาะแบบฟอร์มคำร้อง — หลักฐานเงื่อนไข 1–3 บันทึกได้หลังชำระค่าทดสอบครบ
const INTAKE_FIELDS = { form_pdf: 0 };
const TMP_DIR = path.join(UPLOAD_DIR, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
const intakeUpload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (_req, _file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`),
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 16 },
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => {
    const ok = path.extname(file.originalname).toLowerCase() === '.pdf';
    cb(ok ? null : new HttpError(400, `ไฟล์ ${file.originalname} ไม่ใช่ PDF`), ok);
  },
}).fields(Object.keys(INTAKE_FIELDS).map((name) => ({ name, maxCount: name === 'form_pdf' ? 1 : 5 })));

app.post('/api/applications', requireAuth, requireRole('field', 'admin'), intakeUpload, (req, res) => {
  let body = req.body;
  if (req.is('multipart/form-data')) {
    try { body = JSON.parse(req.body?.payload || '{}'); } catch { fail(400, 'ข้อมูลคำร้องไม่ถูกต้อง'); }
  }
  const { cols, data, errors } = normalizeForm(body);
  if (!req.files?.form_pdf?.length) errors.push('แนบแบบฟอร์มคำร้องขอใช้ไฟฟ้า (PDF)');
  if (errors.length) fail(400, `กรุณากรอกข้อมูลให้ครบถ้วน: ${errors.join(', ')}`);
  const { office, region } = resolveArea(req.user, body, null);
  cols.region = region;
  // อ้างอิงอ็อบเจ็กต์เดิมใน req.files เพื่อให้ตัวจัดการ error ลบไฟล์ถูกที่ถ้าบันทึกไม่สำเร็จ
  const files = Object.entries(req.files || {}).flatMap(([field, list]) => list.map((f) => Object.assign(f, { cond: INTAKE_FIELDS[field] })));

  const { id, status } = tx(() => {
    const appNo = nextAppNo(cols.request_date);
    const ts = now();
    const r = db.prepare(`INSERT INTO applications (app_no, office, ${APP_COLS.join(', ')}, data, created_by, created_at, updated_at)
      VALUES (${Array(APP_COLS.length + 6).fill('?').join(',')})`)
      .run(appNo, office, ...APP_COLS.map((k) => cols[k]), JSON.stringify(data), req.user.id, ts, ts);
    const newId = Number(r.lastInsertRowid);
    logEvent(newId, req.user.id, 'create', `รับคำร้องขอใช้ไฟฟ้า EV Low Priority (${office})`);

    if (files.length) {
      const dir = path.join(UPLOAD_DIR, String(newId));
      fs.mkdirSync(dir, { recursive: true });
      const ins = db.prepare(`INSERT INTO attachments (application_id, condition_no, stored_name, original_name, mime, size, result, uploaded_by, uploaded_at)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const f of files) {
        const dest = path.join(dir, f.filename);
        fs.renameSync(f.path, dest);
        f.path = dest;
        const r = ins.run(newId, f.cond, path.relative(UPLOAD_DIR, dest), f.originalname, 'application/pdf', f.size, f.cond === 0 ? null : 'pass', req.user.id, ts);
        googleSync.queueFile(Number(r.lastInsertRowid));
        logEvent(newId, req.user.id, 'upload', `แนบ${condName(f.cond)} พร้อมคำร้อง: ${f.originalname}`);
      }
    }
    if (isVolta(data)) logEvent(newId, req.user.id, 'volta', `ใช้ PEA VOLTA Platform — ผ่านเงื่อนไขที่ 3 (เทียบเคียงหลักเกณฑ์การทดสอบ CPO ตามหนังสือ ${VOLTA_LETTER})`);
    else notify(tfdUsers(), newId, 'new', `คำร้องใหม่ ${appNo} ${cols.station_name} (${office}) รอผลการทดสอบระบบ CPO กับ PEA EVMS`);
    notify(regionUsersOf(cols.region), newId, 'new',
      `คำร้องใหม่ ${appNo} ${cols.station_name} (${office}) รอผลการตรวจวัดทดสอบความปลอดภัย`);
    return { id: newId, status: recomputeStatus(newId, req.user.id) };
  });
  res.status(201).json({ id, status });
});

app.get('/api/applications/:id', requireAuth, (req, res) => {
  const row = getApp(req.params.id);
  if (!canView(req.user, row)) fail(403, 'คำร้องนี้อยู่นอกพื้นที่ของคุณ — เปิดดูรายละเอียดได้เฉพาะคำร้องใน กฟส. หรือเขตของตนเอง');
  const attachments = db.prepare(`
    SELECT t.id, t.condition_no, t.original_name, t.mime, t.size, t.url, t.doc_no, t.doc_date, t.result, t.note, t.drive_url,
           t.uploaded_at, t.uploaded_by, t.stored_name IS NOT NULL AS has_file,
           u.display_name AS uploaded_by_name, u.office AS uploaded_by_office
    FROM attachments t LEFT JOIN users u ON u.id = t.uploaded_by
    WHERE t.application_id = ? ORDER BY t.condition_no, COALESCE(t.doc_date, t.uploaded_at), t.id`).all(row.id);
  const events = db.prepare(`
    SELECT e.action, e.detail, e.created_at, u.display_name AS user_name, u.office AS user_office
    FROM events e LEFT JOIN users u ON u.id = e.user_id
    WHERE e.application_id = ? ORDER BY e.created_at DESC, e.id DESC`).all(row.id);
  const invoices = db.prepare(`SELECT i.*, u.display_name AS created_by_name FROM invoices i
    LEFT JOIN users u ON u.id = i.created_by WHERE i.application_id = ? ORDER BY i.type, i.id`).all(row.id);
  const creator = row.created_by && db.prepare('SELECT display_name FROM users WHERE id = ?').get(row.created_by);
  const sapBy = row.sap_recorded_by && db.prepare('SELECT display_name FROM users WHERE id = ?').get(row.sap_recorded_by);
  const u = req.user;
  res.json({
    ...row,
    data: JSON.parse(row.data),
    created_by_name: creator?.display_name,
    sap_recorded_by_name: sapBy?.display_name,
    conditions: conditionFlags(row.id),
    cpo_short: db.prepare(`SELECT ${CPO_SHORT()} AS s FROM applications a WHERE a.id = ?`).get(row.id).s,
    volta_doc: isVolta(row.data)
      ? db.prepare('SELECT id, title FROM documents WHERE title LIKE ? ORDER BY id LIMIT 1').get(`%${VOLTA_LETTER}%`) || null : null,
    attachments: attachments.map((a) => ({
      ...a, has_file: !!a.has_file, can_delete: isOpen(row) && (u.role === 'admin' || a.uploaded_by === u.id),
    })),
    events,
    invoices: invoices.map((i) => ({ ...i, can_delete: isOpen(row) && (u.role === 'admin' || i.created_by === u.id) })),
    fees: FEES,
    payment: paymentInfo(row.id),
    permissions: {
      in_area: inArea(u, row),
      payment: isOpen(row) && canInvoice(u, row),
      edit: canEditForm(u, row),
      upload: Object.fromEntries([0, 1, 2, 3, 4].map((n) => [n, canUpload(u, row, n)])),
      invoice: canInvoice(u, row),
      record_low: canRecordLow(u, row),
      cancel: isOpen(row) && (u.role === 'admin' || sameOffice(u, row)),
    },
  });
});

app.put('/api/applications/:id', requireAuth, (req, res) => {
  const row = getApp(req.params.id);
  if (!canEditForm(req.user, row)) fail(403, 'ไม่สามารถแก้ไขคำร้องนี้ได้');
  const { cols, data, errors } = normalizeForm(req.body);
  if (errors.length) fail(400, `กรุณากรอกข้อมูลให้ครบถ้วน: ${errors.join(', ')}`);
  const { office, region } = resolveArea(req.user, req.body, row);
  cols.region = region;
  // เก็บข้อมูลที่ไม่ได้อยู่ในแบบฟอร์ม (เช่น ข้อมูลที่นำเข้าจาก Excel) ไว้
  const merged = { ...JSON.parse(row.data), ...data };
  tx(() => {
    db.prepare(`UPDATE applications SET office = ?, ${APP_COLS.map((k) => `${k} = ?`).join(', ')}, data = ?, updated_at = ? WHERE id = ?`)
      .run(office, ...APP_COLS.map((k) => cols[k]), JSON.stringify(merged), now(), row.id);
    logEvent(row.id, req.user.id, 'update', 'แก้ไขข้อมูลคำร้อง');
    if (isVolta(row.data) !== isVolta(merged)) {
      logEvent(row.id, req.user.id, 'volta', isVolta(merged)
        ? `เปลี่ยนระบบ CPO เป็น PEA VOLTA Platform — ผ่านเงื่อนไขที่ 3 (ตามหนังสือ ${VOLTA_LETTER})`
        : 'เปลี่ยนระบบ CPO จาก PEA VOLTA เป็นระบบอื่น — ต้องมีผลทดสอบ CPO–PEA EVMS (เงื่อนไขที่ 3)');
    }
  });
  const status = recomputeStatus(row.id, req.user.id);
  res.json({ ok: true, status });
});

app.post('/api/applications/:id/cancel', requireAuth, (req, res) => {
  const row = getApp(req.params.id);
  if (!(isOpen(row) && (req.user.role === 'admin' || sameOffice(req.user, row)))) fail(403, 'ไม่สามารถยกเลิกคำร้องนี้ได้');
  const reason = str(req.body?.reason, 1000);
  if (!reason) fail(400, 'กรุณาระบุเหตุผลการยกเลิก');
  tx(() => {
    db.prepare("UPDATE applications SET status='cancelled', cancelled_reason=?, updated_at=? WHERE id=?").run(reason, now(), row.id);
    logEvent(row.id, req.user.id, 'cancel', `ยกเลิกคำร้อง: ${reason}`);
  });
  res.json({ ok: true });
});

// บันทึกวันที่มีผลอัตรา Low หลังเปลี่ยนอัตราในระบบ SAP แล้ว → เสร็จสมบูรณ์
app.post('/api/applications/:id/low-rate', requireAuth, (req, res) => {
  const row = getApp(req.params.id);
  if (!canRecordLow(req.user, row)) fail(403, 'ยังไม่สามารถบันทึกวันที่มีผลอัตรา Low ได้ (เงื่อนไขต้องครบ 3 ข้อ)');
  // ต้องจัดทำข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้าก่อน จึงบันทึกวันที่มีผลอัตรา Low ได้
  if (req.body?.contract_amended !== true) fail(400, 'กรุณาติ๊ก “จัดทำข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้าแล้ว” ก่อนบันทึกวันที่มีผลอัตรา Low');
  const date = req.body?.low_effective_date;
  if (!isDate(date)) fail(400, 'กรุณาระบุวันที่มีผลอัตรา Low ให้ถูกต้อง');
  // เลขที่หนังสือ/หมายเหตุ: ไม่มีในหน้าจอแล้ว — แก้เฉพาะเมื่อส่งมา ไม่งั้นคงค่าเดิม (เช่น ข้อมูลที่นำเข้าจาก Excel)
  const has = (k) => req.body && Object.hasOwn(req.body, k);
  const note = has('note') ? str(req.body.note, 1000) : row.sap_note;
  const letter = has('low_letter_no') ? str(req.body.low_letter_no, 100) || null : row.low_letter_no;
  const ca = str(req.body?.ca_no, 30);
  const data = JSON.parse(row.data || '{}');
  const amendedNow = !data.contract_amended?.done;
  if (amendedNow) data.contract_amended = { done: true, by: req.user.id, at: now() };
  tx(() => {
    const first = row.status === 'ready';
    db.prepare(`UPDATE applications SET status='completed', low_effective_date=?, low_letter_no=?, sap_note=?, sap_recorded_by=?,
      completed_at=COALESCE(completed_at, ?), ca_no=COALESCE(NULLIF(?, ''), ca_no), data=?, updated_at=? WHERE id=?`)
      .run(date, letter, note, req.user.id, now(), ca, JSON.stringify(data), now(), row.id);
    logEvent(row.id, req.user.id, first ? 'low_rate' : 'low_rate_edit',
      `${amendedNow ? 'จัดทำข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้าแล้ว · ' : ''}${first ? 'เปลี่ยนอัตรา Low ในระบบ SAP แล้ว' : 'แก้ไขวันที่มีผลอัตรา Low'} — มีผลตั้งแต่ ${thaiDate(date)}`);
    if (first) {
      notify(tfdUsers(), row.id, 'completed', `${row.app_no} ${row.station_name}: เปลี่ยนอัตรา Low แล้ว มีผล ${date}`);
    }
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- evidence (ไฟล์ / ลิงก์)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(UPLOAD_DIR, String(Number(req.params.id)));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 10 },
  defParamCharset: 'utf8', // ชื่อไฟล์ภาษาไทย
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new HttpError(400, `ไม่รองรับไฟล์ ${file.originalname} (รองรับ PDF, รูปภาพ, Word, Excel, ZIP)`), ok);
  },
});

// ตรวจสิทธิ์ก่อนรับไฟล์ เพื่อไม่ให้ไฟล์ถูกเขียนลงดิสก์โดยไม่จำเป็น
function checkUploadPermission(req, _res, next) {
  const row = getApp(req.params.id);
  const cond = Number(req.query.condition);
  if (!CONDITIONS[cond]) fail(400, 'ระบุเงื่อนไขไม่ถูกต้อง');
  if (!canUpload(req.user, row, cond)) {
    if (!isOpen(row)) fail(403, 'คำร้องนี้ปิดงานแล้ว');
    if (cond === 3 && req.user.role !== 'tfd' && req.user.role !== 'admin') fail(403, 'เงื่อนไขที่ 3 บันทึกได้เฉพาะ กทฟ.');
    if (cond >= 1 && cond <= 3 && !paymentDone(row.id)) {
      fail(403, 'ต้องบันทึกการชำระเงินค่าทดสอบความปลอดภัยและค่าทดสอบ CPO ให้ครบก่อน จึงจะบันทึกเงื่อนไขได้');
    }
    if (CONDITIONS[cond].roles.includes(req.user.role) && !inArea(req.user, row)) {
      fail(403, req.user.role === 'region'
        ? `บันทึกได้เฉพาะคำร้องใน กฟข. ของตนเอง (คำร้องนี้อยู่ใน ${(row.region || 'กฟข. ที่ไม่ระบุ').replace(/^\d+\./, '')})`
        : `บันทึกได้เฉพาะคำร้องของ กฟส. ตนเอง (คำร้องนี้เป็นของ ${row.office})`);
    }
    fail(403, 'ไม่มีสิทธิ์บันทึกหลักฐานหมวดนี้');
  }
  req.appRow = row;
  req.condition = cond;
  next();
}

// หลักฐานทุกหมวดเป็นไฟล์หรือลิงก์ — ไม่รับเลขที่/วันที่หนังสือแล้ว (คอลัมน์ doc_no/doc_date คงไว้สำหรับข้อมูลเดิมที่นำเข้าจาก Excel)
function evidenceMeta(body) {
  const b = body || {};
  return {
    doc_no: null,
    doc_date: null,
    result: ['pass', 'fail'].includes(b.result) ? b.result : null,
    note: str(b.note, 500) || null,
  };
}

function saveEvidence(req, items) {
  const { appRow: row, condition: cond } = req;
  return tx(() => {
    const ins = db.prepare(`INSERT INTO attachments
      (application_id, condition_no, stored_name, original_name, mime, size, url, doc_no, doc_date, result, note, uploaded_by, uploaded_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const it of items) {
      const r = ins.run(row.id, cond, it.stored_name ?? null, it.original_name ?? null, it.mime ?? null, it.size ?? null, it.url ?? null,
        it.doc_no, it.doc_date, it.result, it.note, req.user.id, now());
      if (it.stored_name) googleSync.queueFile(Number(r.lastInsertRowid));
    }
    const m = items[0];
    const what = items.map((it) => it.original_name || it.doc_no || it.url).join(', ');
    logEvent(row.id, req.user.id, 'upload',
      `เพิ่ม${condName(cond)}: ${what}${m.result ? ` — ผล${RESULT_LABEL[m.result]}` : ''}`);
    return recomputeStatus(row.id, req.user.id);
  });
}

app.post('/api/applications/:id/attachments', requireAuth, checkUploadPermission, upload.array('files', 10), (req, res) => {
  const files = req.files || [];
  if (!files.length) fail(400, 'กรุณาเลือกไฟล์');
  const meta = evidenceMeta(req.body);
  const status = saveEvidence(req, files.map((f) => ({
    ...meta, stored_name: path.relative(UPLOAD_DIR, f.path), original_name: f.originalname, mime: f.mimetype, size: f.size,
  })));
  res.status(201).json({ ok: true, status });
});

// หลักฐานแบบลิงก์ (เช่น Google Drive)
app.post('/api/applications/:id/evidence', requireAuth, checkUploadPermission, (req, res) => {
  const meta = evidenceMeta(req.body);
  const url = str(req.body?.url, 2000);
  if (url && !isUrl(url)) fail(400, 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://');
  if (!url) fail(400, 'กรุณาแนบไฟล์ หรือระบุลิงก์เอกสาร');
  const status = saveEvidence(req, [{ ...meta, url: url || null }]);
  res.status(201).json({ ok: true, status });
});

app.get('/api/attachments/:id', requireAuth, (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(req.params.id));
  if (!att) fail(404, 'ไม่พบไฟล์');
  if (!canView(req.user, getApp(att.application_id))) fail(403, 'ไฟล์นี้เป็นของคำร้องนอกพื้นที่ของคุณ');
  if (!att.stored_name) fail(404, 'หลักฐานนี้ไม่มีไฟล์แนบ');
  const full = path.resolve(UPLOAD_DIR, att.stored_name);
  if (!full.startsWith(path.resolve(UPLOAD_DIR) + path.sep) || !fs.existsSync(full)) fail(404, 'ไม่พบไฟล์ในระบบ');
  const inline = req.query.inline === '1' && /^(application\/pdf|image\/(png|jpeg))$/.test(att.mime || '');
  res.setHeader('Content-Disposition', contentDisposition(att.original_name, { type: inline ? 'inline' : 'attachment' }));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(att.mime || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
});

app.delete('/api/attachments/:id', requireAuth, (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(req.params.id));
  if (!att) fail(404, 'ไม่พบหลักฐาน');
  const row = getApp(att.application_id);
  if (!isOpen(row) || !(req.user.role === 'admin' || att.uploaded_by === req.user.id)) fail(403, 'ไม่สามารถลบหลักฐานนี้ได้');
  const status = tx(() => {
    db.prepare('DELETE FROM attachments WHERE id = ?').run(att.id);
    googleSync.queueTrash(att.drive_file_id); // ย้ายไฟล์ใน Google Drive ไปถังขยะด้วย
    logEvent(row.id, req.user.id, 'delete_file',
      `ลบ${condName(att.condition_no)}: ${att.original_name || att.doc_no || att.url}`);
    return recomputeStatus(row.id, req.user.id);
  });
  if (att.stored_name) fs.rm(path.resolve(UPLOAD_DIR, att.stored_name), { force: true }, () => {});
  res.json({ ok: true, status });
});

// ---------------------------------------------------------------- invoices (ใบแจ้งหนี้ค่าทดสอบ)
app.post('/api/applications/:id/invoices', requireAuth, (req, res) => {
  const row = getApp(req.params.id);
  if (!canInvoice(req.user, row)) fail(403, 'ไม่มีสิทธิ์บันทึกเลขที่คำร้องค่าทดสอบของคำร้องนี้');
  const b = req.body || {};
  const fee = FEES[b.type];
  if (!fee) fail(400, 'ประเภทค่าทดสอบไม่ถูกต้อง');
  const requestNo = String(b.request_no || '').replace(/[\s-]/g, '');
  if (!/^\d{12}$/.test(requestNo)) fail(400, 'เลขที่คำร้องต้องเป็นตัวเลข 12 หลัก');
  const units = Number(b.units);
  if (!Number.isInteger(units) || units < 1 || units > 999) fail(400, `จำนวน${fee.unit} ต้องเป็นจำนวนเต็ม 1–999`);
  const unitPrice = Number(b.unit_price ?? fee.prices[0]);
  if (!fee.prices.includes(unitPrice)) fail(400, `อัตรา${fee.label} ต้องเป็น ${fee.prices.map((p) => p.toLocaleString()).join(' หรือ ')} บาท`);
  if (b.issued_date && !isDate(b.issued_date)) fail(400, 'วันที่ไม่ถูกต้อง');
  // เลขที่คำร้องห้ามซ้ำกับสถานีอื่น — ในสถานีเดียวกัน ค่าทดสอบความปลอดภัยกับค่าทดสอบ CPO ใช้เลขเดียวกันได้ (แต่ประเภทเดียวกันห้ามซ้ำ)
  const dup = db.prepare(`SELECT a.id, a.app_no, i.type FROM invoices i JOIN applications a ON a.id = i.application_id
    WHERE i.request_no = ? AND (i.application_id <> ? OR i.type = ?)`).get(requestNo, row.id, b.type);
  if (dup) fail(400, dup.id === row.id
    ? `เลขที่คำร้อง ${requestNo} บันทึกเป็น${fee.label}ของสถานีนี้แล้ว`
    : `เลขที่คำร้อง ${requestNo} ถูกใช้แล้วในคำร้อง ${dup.app_no} — เลขที่คำร้องห้ามซ้ำกับสถานีอื่น`);
  const amount = units * unitPrice;
  const note = str(b.note, 500) || null;
  const status = tx(() => {
    const wasDone = paymentDone(row.id);
    db.prepare(`INSERT INTO invoices (application_id, type, request_no, units, unit_price, amount, issued_date, note, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(row.id, b.type, requestNo, units, unitPrice, amount, b.issued_date || null, note, req.user.id, now());
    logEvent(row.id, req.user.id, 'invoice',
      `บันทึกเลขที่คำร้อง${fee.label} ${requestNo}: ${units} ${fee.unit} × ${unitPrice.toLocaleString()} = ${amount.toLocaleString()} บาท`);
    return afterPaymentChange(row.id, req.user.id, wasDone);
  });
  res.status(201).json({ ok: true, status });
});

// ติ๊ก/ยกเลิก "ลูกค้าชำระเงินแล้ว" ของเลขที่คำร้องแต่ละใบ
app.post('/api/invoices/:id/payment', requireAuth, (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(req.params.id));
  if (!inv) fail(404, 'ไม่พบเลขที่คำร้อง');
  const row = getApp(inv.application_id);
  if (!isOpen(row) || !canInvoice(req.user, row)) fail(403, 'ไม่มีสิทธิ์บันทึกการชำระเงินของคำร้องนี้');
  const paid = req.body?.paid === true || req.body?.paid === 1;
  const paidDate = req.body?.paid_date || now().slice(0, 10);
  if (paid && !isDate(paidDate)) fail(400, 'วันที่ชำระเงินไม่ถูกต้อง');
  const fee = FEES[inv.type];
  const status = tx(() => {
    const wasDone = paymentDone(row.id);
    db.prepare('UPDATE invoices SET paid = ?, paid_date = ?, paid_by = ?, paid_at = ? WHERE id = ?')
      .run(paid ? 1 : 0, paid ? paidDate : null, paid ? req.user.id : null, paid ? now() : null, inv.id);
    logEvent(row.id, req.user.id, paid ? 'payment' : 'payment_undo', paid
      ? `ลูกค้าชำระ${fee.label} เลขที่คำร้อง ${inv.request_no} (${inv.amount.toLocaleString()} บาท) ชำระวันที่ ${thaiDate(paidDate)}`
      : `ยกเลิกการชำระ${fee.label} เลขที่คำร้อง ${inv.request_no}`);
    return afterPaymentChange(row.id, req.user.id, wasDone);
  });
  res.json({ ok: true, status, payment: paymentInfo(row.id) });
});

// ตั้งว่า "ไม่ต้องชำระ" ค่าทดสอบรายการนั้น (เช่น ผู้ขอใช้ไฟฟ้าจัดหาหน่วยงานภายนอกทดสอบเอง)
app.post('/api/applications/:id/payment-exempt', requireAuth, (req, res) => {
  const row = getApp(req.params.id);
  if (!isOpen(row) || !canInvoice(req.user, row)) fail(403, 'ไม่มีสิทธิ์บันทึกการชำระเงินของคำร้องนี้');
  const type = req.body?.type;
  const fee = FEES[type];
  if (!fee) fail(400, 'ประเภทค่าทดสอบไม่ถูกต้อง');
  const exempt = req.body?.exempt === true;
  const reason = str(req.body?.reason, 300);
  if (exempt && !reason) fail(400, 'กรุณาระบุเหตุผลที่ไม่ต้องชำระ');
  const status = tx(() => {
    const wasDone = paymentDone(row.id);
    const data = JSON.parse(row.data);
    data.payment = { ...(data.payment || {}), [type]: exempt ? { exempt: true, reason } : { exempt: false } };
    db.prepare('UPDATE applications SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), now(), row.id);
    logEvent(row.id, req.user.id, exempt ? 'payment_exempt' : 'payment_exempt_undo',
      exempt ? `ไม่ต้องชำระ${fee.label}: ${reason}` : `ยกเลิก "ไม่ต้องชำระ${fee.label}"`);
    return afterPaymentChange(row.id, req.user.id, wasDone);
  });
  res.json({ ok: true, status, payment: paymentInfo(row.id) });
});

app.delete('/api/invoices/:id', requireAuth, (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(req.params.id));
  if (!inv) fail(404, 'ไม่พบเลขที่คำร้อง');
  const row = getApp(inv.application_id);
  if (!isOpen(row) || !(req.user.role === 'admin' || inv.created_by === req.user.id)) fail(403, 'ไม่สามารถลบเลขที่คำร้องนี้ได้');
  const status = tx(() => {
    const wasDone = paymentDone(row.id);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
    logEvent(row.id, req.user.id, 'invoice_delete', `ลบเลขที่คำร้อง${FEES[inv.type].label} ${inv.request_no}`);
    return afterPaymentChange(row.id, req.user.id, wasDone);
  });
  res.json({ ok: true, status });
});

// ---------------------------------------------------------------- notifications
app.get('/api/notifications', requireAuth, (req, res) => {
  const items = db.prepare(`SELECT n.*, a.app_no FROM notifications n LEFT JOIN applications a ON a.id = n.application_id
    WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50`).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).n;
  res.json({ unread, items });
});
app.post('/api/notifications/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});
app.post('/api/notifications/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- offices (รายชื่อ กฟส. — ผู้ดูแลระบบ)
app.get('/api/offices', requireAuth, requireRole('admin'), (_req, res) => {
  res.json(db.prepare(`SELECT o.*, (SELECT COUNT(*) FROM applications a WHERE a.office = o.name) AS app_count,
    (SELECT COUNT(*) FROM users u WHERE u.role = 'field' AND u.office = o.name) AS user_count
    FROM offices o ORDER BY o.region, o.name`).all());
});

function validOffice(b) {
  const name = str(b?.name, 100).replace(/\s+/g, ' ');
  const region = String(b?.region || '').trim();
  if (!name) fail(400, 'กรุณาระบุชื่อ กฟส.');
  if (!REGIONS.includes(region)) fail(400, 'กรุณาเลือก กฟข.');
  return { name, region };
}

app.post('/api/offices', requireAuth, requireRole('admin'), (req, res) => {
  const o = validOffice(req.body);
  if (db.prepare('SELECT 1 FROM offices WHERE name = ?').get(o.name)) fail(400, `มี "${o.name}" ในรายชื่อแล้ว`);
  db.prepare('INSERT INTO offices (name, region) VALUES (?, ?)').run(o.name, o.region);
  res.status(201).json({ ok: true });
});

// เปลี่ยน กฟข. / เปิด-ปิดใช้งาน (เปลี่ยน กฟข. แล้วคำร้องที่ยังไม่ปิดของ กฟส. นี้จะย้าย กฟข. ตาม)
app.put('/api/offices/:id', requireAuth, requireRole('admin'), (req, res) => {
  const cur = db.prepare('SELECT * FROM offices WHERE id = ?').get(Number(req.params.id));
  if (!cur) fail(404, 'ไม่พบ กฟส.');
  const region = String(req.body?.region || cur.region);
  if (!REGIONS.includes(region)) fail(400, 'กฟข. ไม่ถูกต้อง');
  const active = req.body?.active === false || req.body?.active === 0 ? 0 : 1;
  tx(() => {
    db.prepare('UPDATE offices SET region = ?, active = ? WHERE id = ?').run(region, active, cur.id);
    if (region !== cur.region) {
      db.prepare("UPDATE applications SET region = ? WHERE office = ? AND status IN ('pending','ready')").run(region, cur.name);
    }
  });
  res.json({ ok: true });
});

// นำเข้าหลายรายการ: วางจาก Excel ได้ บรรทัดละ "ชื่อ กฟส. <Tab หรือ ,> กฟข." เช่น "กฟส.สันทราย	กฟน.1"
app.post('/api/offices/bulk', requireAuth, requireRole('admin'), (req, res) => {
  const lines = String(req.body?.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) fail(400, 'ไม่มีข้อมูล');
  const short = Object.fromEntries(REGIONS.map((r) => [r.replace(/^\d+\./, ''), r]));
  const added = []; const updated = []; const errors = [];
  tx(() => {
    for (const [i, line] of lines.entries()) {
      const parts = line.split(/\t|,/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) { errors.push(`บรรทัด ${i + 1}: ต้องมีชื่อ กฟส. และ กฟข.`); continue; }
      const regionRaw = parts[parts.length - 1].replace(/\s+/g, '');
      const region = REGIONS.includes(regionRaw) ? regionRaw : short[regionRaw];
      const name = parts.slice(0, -1).join(' ').replace(/\s+/g, ' ');
      if (!region) { if (i === 0) continue; errors.push(`บรรทัด ${i + 1}: ไม่รู้จัก กฟข. "${parts[parts.length - 1]}"`); continue; } // บรรทัดแรกอาจเป็นหัวตาราง
      const cur = db.prepare('SELECT * FROM offices WHERE name = ?').get(name);
      if (!cur) { db.prepare('INSERT INTO offices (name, region) VALUES (?, ?)').run(name, region); added.push(name); }
      else if (cur.region !== region || !cur.active) { db.prepare('UPDATE offices SET region = ?, active = 1 WHERE id = ?').run(region, cur.id); updated.push(name); }
    }
  });
  res.json({ added: added.length, updated: updated.length, errors });
});

// ---------------------------------------------------------------- users (admin)
app.get('/api/users', requireAuth, requireRole('admin'), (_req, res) => {
  res.json(db.prepare('SELECT id, username, display_name, role, office, email, active, created_at FROM users ORDER BY role, office, username').all());
});

function validateUser(b, isNew) {
  const u = {
    username: str(b.username, 50), display_name: str(b.display_name, 200), role: str(b.role, 10),
    office: str(b.office, 100) || null, email: str(b.email, 200) || null, password: String(b.password || ''),
  };
  if (isNew && !/^[a-zA-Z0-9._-]{3,50}$/.test(u.username)) fail(400, 'ชื่อผู้ใช้ต้องเป็น a-z, 0-9, . _ - อย่างน้อย 3 ตัว');
  if (!u.display_name) fail(400, 'กรุณาระบุชื่อที่แสดง');
  if (!['field', 'tfd', 'region', 'admin'].includes(u.role)) fail(400, 'บทบาทไม่ถูกต้อง');
  if (u.role === 'field' && !officeRow(u.office)) fail(400, 'ผู้ใช้ กฟส.ในพื้นที่ใช้ไฟฟ้า ต้องเลือก กฟส. ที่สังกัดจากรายชื่อ');
  if (u.role === 'region' && !REGIONS.includes(u.office)) fail(400, 'ผู้ใช้ กบล. กฟข. ต้องเลือก กฟข. ที่สังกัด');
  if (u.role === 'tfd' && !u.office) u.office = 'กทฟ.';
  if ((isNew || u.password) && u.password.length < 6) fail(400, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
  return u;
}

app.post('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  const u = validateUser(req.body || {}, true);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u.username)) fail(400, 'ชื่อผู้ใช้นี้มีอยู่แล้ว');
  const r = db.prepare('INSERT INTO users (username, password_hash, display_name, role, office, email) VALUES (?,?,?,?,?,?)')
    .run(u.username, hashPassword(u.password), u.display_name, u.role, u.office, u.email);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

app.put('/api/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) fail(404, 'ไม่พบผู้ใช้');
  const u = validateUser(req.body || {}, false);
  const active = req.body?.active === false || req.body?.active === 0 ? 0 : 1;
  if (id === req.user.id && (!active || u.role !== 'admin')) fail(400, 'ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตนเองได้');
  tx(() => {
    db.prepare('UPDATE users SET display_name=?, role=?, office=?, email=?, active=? WHERE id=?')
      .run(u.display_name, u.role, u.office, u.email, active, id);
    if (u.password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(u.password), id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Google Sheets / Drive (admin)
// รับได้ทั้ง ID หรือลิงก์เต็มที่คัดลอกจากเบราว์เซอร์
const idFrom = (v, re) => { const s = String(v || '').trim(); const m = s.match(re); return m ? m[1] : s; };

app.get('/api/google', requireAuth, requireRole('admin'), (_req, res) => res.json(googleSync.status()));

app.put('/api/google', requireAuth, requireRole('admin'), (req, res) => {
  const b = req.body || {};
  const sheetLink = String(b.sheet || '');
  const sheetId = idFrom(sheetLink, /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  const gid = (sheetLink.match(/[#&?]gid=(\d+)/) || [])[1] ?? (b.sheet_gid ?? '0');
  const folderId = idFrom(b.folder, /\/folders\/([A-Za-z0-9_-]+)/);
  const url = String(b.url || '').trim();
  if (sheetId && !/^[A-Za-z0-9_-]{20,}$/.test(sheetId)) fail(400, 'ลิงก์ Google Sheet ไม่ถูกต้อง');
  if (folderId && !/^[A-Za-z0-9_-]{10,}$/.test(folderId)) fail(400, 'ลิงก์โฟลเดอร์ Google Drive ไม่ถูกต้อง');
  if (url && !/^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
    fail(400, 'Web App URL ต้องเป็นลิงก์ที่ได้จากการ Deploy เช่น https://script.google.com/macros/s/…/exec');
  }
  const wasEnabled = googleSync.settings().enabled;
  googleSync.setSetting('google_sheet_id', sheetId);
  googleSync.setSetting('google_sheet_gid', String(Number(gid) || 0));
  googleSync.setSetting('google_folder_id', folderId);
  googleSync.setSetting('google_webapp_url', url);
  googleSync.setSetting('google_enabled', b.enabled && url ? '1' : '0');
  // เปิดใช้ครั้งแรก: ส่งข้อมูลที่มีอยู่ทั้งหมดขึ้นไป
  const queued = !wasEnabled && b.enabled && url ? googleSync.queueAll() : null;
  res.json({ ok: true, queued });
});

app.post('/api/google/test', requireAuth, requireRole('admin'), async (req, res) => {
  const s = { ...googleSync.settings(), url: String(req.body?.url || googleSync.settings().url).trim() };
  try {
    const r = await googleSync.call('ping', {}, s);
    res.json({ ok: true, sheet: r.sheet, folder: r.folder });
  } catch (err) {
    res.status(400).json({ error: `เชื่อมต่อไม่สำเร็จ: ${err.message}` });
  }
});

app.post('/api/google/sync-all', requireAuth, requireRole('admin'), (_req, res) => {
  const q = googleSync.queueAll();
  googleSync.tick();
  res.json({ ok: true, ...q });
});

app.post('/api/google/regenerate-secret', requireAuth, requireRole('admin'), (_req, res) => {
  googleSync.setSetting('google_secret', crypto.randomBytes(24).toString('base64url'));
  res.json({ ok: true });
});

app.get('/api/google/script', requireAuth, requireRole('admin'), (_req, res) => {
  res.type('text/plain; charset=utf-8').send(googleSync.scriptSource());
});

// ---------------------------------------------------------------- เอกสารหลักฐานที่เกี่ยวข้อง
// ทุกบทบาทดู/ดาวน์โหลดได้ · ผู้ดูแลระบบเพิ่ม/แก้ไข/ลบ · ไฟล์เก็บที่ DATA_DIR/docs (ไม่ส่งขึ้น Google)
const DOC_DIR = path.join(DATA_DIR, 'docs');
fs.mkdirSync(DOC_DIR, { recursive: true });
const DOC_CATEGORIES = ['intake', 'conditions', 'safety', 'contract', 'rules', 'other'];
const docUpload = multer({
  storage: multer.diskStorage({
    destination: DOC_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new HttpError(400, `ไม่รองรับไฟล์ ${file.originalname} (รองรับ PDF, รูปภาพ, Word, Excel, ZIP)`), ok);
  },
});
const docMeta = (b, current = {}) => {
  const title = str(b?.title ?? current.title, 300);
  if (!title) fail(400, 'กรุณาระบุชื่อเอกสาร');
  const category = DOC_CATEGORIES.includes(b?.category) ? b.category : (current.category || 'other');
  const sort = Number.isInteger(Number(b?.sort)) && b?.sort !== '' && b?.sort != null ? Number(b.sort) : (current.sort ?? 0);
  return { title, category, description: str(b?.description ?? current.description, 1000) || null, sort };
};
const publicDoc = (d) => ({ id: d.id, title: d.title, category: d.category, description: d.description, original_name: d.original_name,
  mime: d.mime, size: d.size, sort: d.sort, uploaded_at: d.uploaded_at, uploaded_by_name: d.uploaded_by_name || null });

app.get('/api/documents', requireAuth, (_req, res) => {
  res.json(db.prepare(`SELECT d.*, u.display_name AS uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
    ORDER BY d.sort, d.id`).all().map(publicDoc));
});

app.get('/api/documents/:id/file', requireAuth, (req, res) => {
  const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!d) fail(404, 'ไม่พบเอกสาร');
  const full = path.resolve(DOC_DIR, d.stored_name);
  if (!full.startsWith(path.resolve(DOC_DIR) + path.sep) || !fs.existsSync(full)) fail(404, 'ไม่พบไฟล์ในระบบ');
  const inline = req.query.inline === '1' && /^(application\/pdf|image\/(png|jpeg))$/.test(d.mime || '');
  res.setHeader('Content-Disposition', contentDisposition(d.original_name, { type: inline ? 'inline' : 'attachment' }));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(d.mime || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
});

app.post('/api/documents', requireAuth, requireRole('admin'), docUpload.single('file'), (req, res) => {
  const f = req.file;
  if (!f) fail(400, 'กรุณาเลือกไฟล์เอกสาร');
  const m = docMeta(req.body);
  const r = db.prepare(`INSERT INTO documents (title, category, description, stored_name, original_name, mime, size, sort, uploaded_by)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(m.title, m.category, m.description, path.basename(f.path), f.originalname, f.mimetype, f.size, m.sort, req.user.id);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

app.put('/api/documents/:id', requireAuth, requireRole('admin'), (req, res) => {
  const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!d) fail(404, 'ไม่พบเอกสาร');
  const m = docMeta(req.body, d);
  db.prepare('UPDATE documents SET title = ?, category = ?, description = ?, sort = ? WHERE id = ?').run(m.title, m.category, m.description, m.sort, d.id);
  res.json({ ok: true });
});

app.delete('/api/documents/:id', requireAuth, requireRole('admin'), (req, res) => {
  const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!d) fail(404, 'ไม่พบเอกสาร');
  db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
  fs.rm(path.resolve(DOC_DIR, d.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

// ---------------------------------------------------------------- errors
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'ไม่พบ API')));
app.use((err, req, res, _next) => {
  const uploaded = Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat();
  if (req.file) uploaded.push(req.file); // อัปโหลดไฟล์เดี่ยว (เอกสารหลักฐาน)
  for (const f of uploaded) fs.rm(f.path, { force: true }, () => {});
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์มีขนาดเกิน ${MAX_FILE_MB} MB` : `อัปโหลดไม่สำเร็จ (${err.code})`;
    return res.status(400).json({ error: msg });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'เกิดข้อผิดพลาดในระบบ' : err.message });
});

app.listen(PORT, () => {
  console.log(`EV Low Priority Tracking พร้อมใช้งานที่ http://localhost:${PORT}`);
  googleSync.start();
});
