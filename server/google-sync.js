'use strict';
/*
 * ส่งข้อมูลคำร้องไป Google Sheets และไฟล์แนบไป Google Drive ผ่าน Google Apps Script Web App
 * - ทุกการเปลี่ยนแปลงจะเข้าคิว (sync_queue) แล้วตัวทำงานเบื้องหลังส่งให้ทีละชุด
 * - ส่งไม่สำเร็จจะลองใหม่อัตโนมัติ (รอนานขึ้นเรื่อยๆ สูงสุด 1 ชั่วโมง) ข้อมูลไม่หาย
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, nowLocal, DATA_DIR } = require('./db');

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SCRIPT_FILE = path.join(__dirname, '..', 'google-apps-script', 'Code.gs');
const TICK_MS = 5000;
const ROW_BATCH = 25;
const CATEGORY = { 0: 'แบบฟอร์มคำร้อง', 1: 'เงื่อนไข 1 ขึ้นทะเบียน', 2: 'เงื่อนไข 2 ตรวจการติดตั้ง', 3: 'เงื่อนไข 3 ทดสอบ CPO', 4: 'ผลทดสอบความปลอดภัย' };
const STATUS = { pending: 'รอเงื่อนไข', ready: 'รอเปลี่ยนอัตรา Low (SAP)', completed: 'เสร็จสมบูรณ์', cancelled: 'ยกเลิก' };

// ---------------------------------------------------------------- settings
const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? '';
const setSetting = (key, value) => db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value == null ? '' : String(value));

function settings() {
  if (!getSetting('google_secret')) setSetting('google_secret', crypto.randomBytes(24).toString('base64url'));
  return {
    url: getSetting('google_webapp_url'),
    secret: getSetting('google_secret'),
    sheet_id: getSetting('google_sheet_id'),
    sheet_gid: getSetting('google_sheet_gid') || '0',
    folder_id: getSetting('google_folder_id'),
    enabled: getSetting('google_enabled') === '1',
    last_ok_at: getSetting('google_last_ok_at'),
    last_error: getSetting('google_last_error'),
    last_error_at: getSetting('google_last_error_at'),
  };
}
const isReady = (s = settings()) => s.enabled && !!s.url && !!s.secret;

// ---------------------------------------------------------------- queue
function enqueue(kind, ref) {
  db.prepare(`INSERT INTO sync_queue (kind, ref, seq, next_at) VALUES (?, ?, 1, 0)
    ON CONFLICT(kind, ref) DO UPDATE SET seq = seq + 1, next_at = 0, attempts = 0`).run(kind, String(ref));
}
const queueApp = (appId) => enqueue('row', appId);
const queueFile = (attachmentId) => enqueue('file', attachmentId);
const queueTrash = (driveFileId) => driveFileId && enqueue('trash', driveFileId);

function queueAll() {
  const apps = db.prepare('SELECT id FROM applications').all();
  const files = db.prepare('SELECT id FROM attachments WHERE stored_name IS NOT NULL AND drive_file_id IS NULL').all();
  for (const a of apps) queueApp(a.id);
  for (const f of files) queueFile(f.id);
  return { rows: apps.length, files: files.length };
}

function done(item) {
  db.prepare('DELETE FROM sync_queue WHERE id = ? AND seq = ?').run(item.id, item.seq);
}
function failed(items, err) {
  const msg = String(err?.message || err).slice(0, 500);
  for (const it of items) {
    const attempts = it.attempts + 1;
    const wait = Math.min(3600e3, 30e3 * 2 ** Math.min(attempts - 1, 7));
    db.prepare('UPDATE sync_queue SET attempts = ?, next_at = ?, last_error = ? WHERE id = ? AND seq = ?')
      .run(attempts, Date.now() + wait, msg, it.id, it.seq);
  }
  setSetting('google_last_error', msg);
  setSetting('google_last_error_at', nowLocal());
}

// ---------------------------------------------------------------- เรียก Apps Script
async function call(action, payload = {}, s = settings()) {
  if (!s.url) throw new Error('ยังไม่ได้ตั้งค่า Web App URL');
  const res = await fetch(s.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, action, secret: s.secret }),
    redirect: 'follow',
    signal: AbortSignal.timeout(180e3),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(res.ok
      ? 'Apps Script ไม่ได้ตอบกลับเป็น JSON (ตรวจว่า Deploy เป็น Web app และตั้ง "Who has access" เป็น Anyone)'
      : `เรียก Apps Script ไม่สำเร็จ (HTTP ${res.status})`);
  }
  if (!data.ok) throw new Error(data.error || 'Apps Script แจ้งข้อผิดพลาด');
  return data;
}

// ---------------------------------------------------------------- แถวในชีท
const HEADERS = ['เลขที่คำร้อง', 'วันที่ยื่นคำร้อง', 'ชื่อสถานี', 'บริษัท', 'ผู้ขอใช้ไฟฟ้า', 'กฟส.ในพื้นที่ใช้ไฟฟ้า', 'กฟข.',
  'อำเภอ', 'จังหวัด', 'Contract Account (CA)', 'Meter No.', 'Lat', 'Long', 'kW รวม', 'kVA', 'CPO / Platform',
  'ผู้ติดต่อ', 'เบอร์โทร', 'สถานะ',
  'เงื่อนไข 1 ขึ้นทะเบียน', 'หลักฐานเงื่อนไข 1', 'เงื่อนไข 2 ตรวจการติดตั้ง', 'หลักฐานเงื่อนไข 2',
  'เงื่อนไข 3 ทดสอบ CPO-EVMS', 'หลักฐานเงื่อนไข 3', 'ผลทดสอบความปลอดภัย', 'หลักฐานผลทดสอบความปลอดภัย',
  'แบบฟอร์มคำร้อง (PDF)',
  'เลขที่คำร้องค่าทดสอบความปลอดภัย', 'ค่าทดสอบความปลอดภัย (บาท)', 'ชำระค่าทดสอบความปลอดภัย',
  'เลขที่คำร้องค่าทดสอบ CPO', 'ค่าทดสอบ CPO (บาท)', 'ชำระค่าทดสอบ CPO',
  'วันที่ครบเงื่อนไข', 'หนังสือเปลี่ยนอัตรา', 'วันที่มีผลอัตรา Low', 'อัปเดตล่าสุด'];

const asText = (v) => (v == null || v === '' ? '' : `'${v}`); // ให้ชีทเก็บเป็นข้อความ (ไม่ตัดเลข 0 นำหน้า)
const link = (url, label) => (url ? `=HYPERLINK("${String(url).replace(/"/g, '%22')}","${String(label).replace(/"/g, "'")}")` : '');
const region = (r) => String(r || '').replace(/^\d+\./, '');

function evidenceSummary(list) {
  if (!list.length) return { state: '', link: '' };
  const ok = list.some((t) => t.result !== 'fail');
  const best = list.filter((t) => t.result !== 'fail').at(-1) || list.at(-1);
  const url = best.drive_url || best.url;
  const label = best.original_name || best.doc_no || 'เปิดเอกสาร';
  return { state: ok ? 'ผ่าน/ครบ' : 'ไม่ผ่าน', link: url ? link(url, label) : (best.doc_no || best.note || '') };
}

function buildRow(appId) {
  const a = db.prepare('SELECT * FROM applications WHERE id = ?').get(Number(appId));
  if (!a) return null;
  const d = JSON.parse(a.data || '{}');
  const att = db.prepare('SELECT * FROM attachments WHERE application_id = ? ORDER BY COALESCE(doc_date, uploaded_at), id').all(a.id);
  const inv = db.prepare('SELECT * FROM invoices WHERE application_id = ? ORDER BY id').all(a.id);
  const by = (n) => att.filter((t) => t.condition_no === n);
  const c = Object.fromEntries([1, 2, 3, 4].map((n) => [n, evidenceSummary(by(n))]));
  const form = by(0).at(-1);
  const invOf = (type) => inv.filter((i) => i.type === type);
  const payState = (type) => {
    if (d.payment?.[type]?.exempt) return 'ไม่ต้องชำระ';
    const list = invOf(type);
    if (!list.length) return '';
    if (list.every((i) => i.paid)) return `ชำระแล้ว ${list.map((i) => i.paid_date).filter(Boolean).sort().at(-1) || ''}`.trim();
    return 'ค้างชำระ';
  };
  return {
    'เลขที่คำร้อง': a.app_no,
    'วันที่ยื่นคำร้อง': a.request_date || a.created_at.slice(0, 10),
    'ชื่อสถานี': a.station_name,
    'บริษัท': a.company || '',
    'ผู้ขอใช้ไฟฟ้า': a.applicant_name,
    'กฟส.ในพื้นที่ใช้ไฟฟ้า': a.office,
    'กฟข.': region(a.region),
    'อำเภอ': a.district || '',
    'จังหวัด': a.province || '',
    'Contract Account (CA)': asText(a.ca_no),
    'Meter No.': asText(a.meter_no),
    'Lat': a.lat ?? '',
    'Long': a.lng ?? '',
    'kW รวม': a.total_kw ?? '',
    'kVA': a.total_kva ?? '',
    'CPO / Platform': d.cpo?.system_name || '',
    'ผู้ติดต่อ': a.contact_name || '',
    'เบอร์โทร': asText(a.phone),
    'สถานะ': STATUS[a.status] || a.status,
    'เงื่อนไข 1 ขึ้นทะเบียน': c[1].state, 'หลักฐานเงื่อนไข 1': c[1].link,
    'เงื่อนไข 2 ตรวจการติดตั้ง': c[2].state, 'หลักฐานเงื่อนไข 2': c[2].link,
    'เงื่อนไข 3 ทดสอบ CPO-EVMS': c[3].state, 'หลักฐานเงื่อนไข 3': c[3].link,
    'ผลทดสอบความปลอดภัย': c[4].state, 'หลักฐานผลทดสอบความปลอดภัย': c[4].link,
    'แบบฟอร์มคำร้อง (PDF)': form?.drive_url ? link(form.drive_url, form.original_name || 'คำร้อง.pdf') : (form ? 'รออัปโหลด' : ''),
    'เลขที่คำร้องค่าทดสอบความปลอดภัย': asText(invOf('safety').map((i) => i.request_no).join(', ')),
    'ค่าทดสอบความปลอดภัย (บาท)': invOf('safety').reduce((s, i) => s + i.amount, 0) || '',
    'ชำระค่าทดสอบความปลอดภัย': payState('safety'),
    'ชำระค่าทดสอบ CPO': payState('cpo'),
    'เลขที่คำร้องค่าทดสอบ CPO': asText(invOf('cpo').map((i) => i.request_no).join(', ')),
    'ค่าทดสอบ CPO (บาท)': invOf('cpo').reduce((s, i) => s + i.amount, 0) || '',
    'วันที่ครบเงื่อนไข': a.ready_at ? a.ready_at.slice(0, 10) : '',
    'หนังสือเปลี่ยนอัตรา': a.low_letter_no || '',
    'วันที่มีผลอัตรา Low': a.low_effective_date || '',
    'อัปเดตล่าสุด': nowLocal(),
  };
}

async function runRows(items) {
  const rows = []; const live = [];
  for (const it of items) {
    const r = buildRow(it.ref);
    if (r) { rows.push(r); live.push(it); } else done(it); // คำร้องถูกลบแล้ว
  }
  if (!rows.length) return;
  try {
    const res = await call('upsertRows', { headers: HEADERS, rows });
    for (const [appNo, url] of Object.entries(res.folders || {})) {
      db.prepare('UPDATE applications SET drive_folder_url = ? WHERE app_no = ?').run(url, appNo);
    }
    live.forEach(done);
    setSetting('google_last_ok_at', nowLocal());
  } catch (err) { failed(live, err); }
}

async function runFile(it) {
  const t = db.prepare(`SELECT t.*, a.app_no, a.station_name FROM attachments t JOIN applications a ON a.id = t.application_id
    WHERE t.id = ?`).get(Number(it.ref));
  if (!t || !t.stored_name || t.drive_file_id) return done(it);
  try {
    const full = path.resolve(UPLOAD_DIR, t.stored_name);
    if (!fs.existsSync(full)) return done(it);
    const res = await call('uploadFile', {
      appNo: t.app_no, station: t.station_name,
      fileName: `[${CATEGORY[t.condition_no] || 'เอกสาร'}] ${t.original_name}`,
      mime: t.mime || 'application/octet-stream',
      description: [t.doc_no && `เลขที่ ${t.doc_no}`, t.doc_date && `ลงวันที่ ${t.doc_date}`, t.result && `ผล${t.result === 'pass' ? 'ผ่าน' : 'ไม่ผ่าน'}`, t.note]
        .filter(Boolean).join(' · '),
      data: fs.readFileSync(full).toString('base64'),
    });
    db.prepare('UPDATE attachments SET drive_file_id = ?, drive_url = ? WHERE id = ?').run(res.fileId, res.url, t.id);
    if (res.folderUrl) db.prepare('UPDATE applications SET drive_folder_url = ? WHERE id = ?').run(res.folderUrl, t.application_id);
    done(it);
    queueApp(t.application_id); // อัปเดตลิงก์ไฟล์ในชีท
    setSetting('google_last_ok_at', nowLocal());
  } catch (err) { failed([it], err); }
}

async function runTrash(it) {
  try { await call('trashFile', { fileId: it.ref }); done(it); } catch (err) { failed([it], err); }
}

// ---------------------------------------------------------------- ตัวทำงานเบื้องหลัง
let busy = false;
async function tick() {
  if (busy || !isReady()) return;
  busy = true;
  try {
    const now = Date.now();
    for (const it of db.prepare("SELECT * FROM sync_queue WHERE kind = 'file' AND next_at <= ? ORDER BY id LIMIT 3").all(now)) await runFile(it);
    for (const it of db.prepare("SELECT * FROM sync_queue WHERE kind = 'trash' AND next_at <= ? ORDER BY id LIMIT 5").all(now)) await runTrash(it);
    const rows = db.prepare("SELECT * FROM sync_queue WHERE kind = 'row' AND next_at <= ? ORDER BY id LIMIT ?").all(now, ROW_BATCH);
    if (rows.length) await runRows(rows);
  } catch (err) {
    console.error('Google sync error:', err);
  } finally {
    busy = false;
  }
}
function start() { setInterval(tick, TICK_MS).unref(); }

function status() {
  const s = settings();
  const count = (kind) => db.prepare('SELECT COUNT(*) AS n FROM sync_queue WHERE kind = ?').get(kind).n;
  return {
    url: s.url, secret: s.secret, sheet_id: s.sheet_id, sheet_gid: s.sheet_gid, folder_id: s.folder_id, enabled: s.enabled,
    last_ok_at: s.last_ok_at, last_error: s.last_error, last_error_at: s.last_error_at,
    queue: { rows: count('row'), files: count('file'), trash: count('trash') },
    errors: db.prepare('SELECT kind, ref, attempts, last_error FROM sync_queue WHERE last_error IS NOT NULL ORDER BY id LIMIT 5').all(),
    synced_files: db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE drive_file_id IS NOT NULL').get().n,
    folders: db.prepare('SELECT COUNT(*) AS n FROM applications WHERE drive_folder_url IS NOT NULL').get().n,
  };
}

function scriptSource() {
  const s = settings();
  return fs.readFileSync(SCRIPT_FILE, 'utf8')
    .replace('__SECRET__', s.secret)
    .replace('__SHEET_ID__', s.sheet_id || 'ใส่ SHEET ID')
    .replace('__SHEET_GID__', String(Number(s.sheet_gid) || 0))
    .replace('__FOLDER_ID__', s.folder_id || 'ใส่ FOLDER ID');
}

module.exports = {
  settings, setSetting, status, start, call, queueApp, queueFile, queueTrash, queueAll, scriptSource, tick, HEADERS,
};
