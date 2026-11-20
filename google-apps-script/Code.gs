/**
 * EV Low Priority Tracking → Google Sheets + Google Drive
 *
 * สคริปต์นี้รับข้อมูลจากระบบ แล้ว
 *   1) เขียน/อัปเดตแถวคำร้องลงชีท (ใช้คอลัมน์ "เลขที่คำร้อง" เป็นคีย์ — คอลัมน์อื่นที่ผู้ใช้เพิ่มเองจะไม่ถูกแก้)
 *   2) สร้างโฟลเดอร์แยกของแต่ละสถานีในโฟลเดอร์หลัก และอัปโหลดไฟล์ PDF/เอกสารแนบเข้าโฟลเดอร์นั้น
 *
 * วิธีติดตั้ง: ดูหน้า "เชื่อมต่อ Google" ในระบบ (เมนูผู้ดูแลระบบ) — ค่าด้านล่างระบบเติมให้แล้ว
 */
const CONFIG = {
  SECRET: '__SECRET__',          // รหัสลับ ต้องตรงกับในระบบ
  SHEET_ID: '__SHEET_ID__',      // Google Sheet ที่เก็บข้อมูลคำร้อง
  SHEET_GID: __SHEET_GID__,      // แท็บของชีท (gid ใน URL)
  FOLDER_ID: '__FOLDER_ID__',    // โฟลเดอร์หลักใน Google Drive
  KEY_HEADER: 'เลขที่คำร้อง',
  NAME_HEADER: 'ชื่อสถานี',
  FOLDER_HEADER: 'โฟลเดอร์เอกสาร',
};

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'ข้อมูลที่ส่งมาไม่ใช่ JSON' });
  }
  if (!req || req.secret !== CONFIG.SECRET) return json_({ ok: false, error: 'รหัสลับไม่ถูกต้อง' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    switch (req.action) {
      case 'ping': return json_(ping_());
      case 'upsertRows': return json_(upsertRows_(req.headers, req.rows));
      case 'uploadFile': return json_(uploadFile_(req));
      case 'trashFile': return json_(trashFile_(req.fileId));
      default: return json_({ ok: false, error: 'ไม่รู้จักคำสั่ง ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json_({ ok: true, service: 'ev-low-priority-sync' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === CONFIG.SHEET_GID) return sheets[i];
  }
  return sheets[0];
}

function root_() {
  return DriveApp.getFolderById(CONFIG.FOLDER_ID);
}

function ping_() {
  const sh = sheet_();
  return { ok: true, sheet: sh.getParent().getName() + ' › ' + sh.getName(), folder: root_().getName() };
}

// ---------------------------------------------------------------- โฟลเดอร์ของแต่ละสถานี
function folderName_(appNo, station) {
  return (String(appNo) + ' ' + String(station || '')).replace(/[\/\\]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function escapeQuery_(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// หาโฟลเดอร์ที่ชื่อขึ้นต้นด้วยเลขที่คำร้อง ถ้าไม่มีให้สร้าง (ถ้าชื่อสถานีเปลี่ยน จะเปลี่ยนชื่อโฟลเดอร์ตาม)
function stationFolder_(appNo, station) {
  const root = root_();
  const want = folderName_(appNo, station);
  const it = root.searchFolders("title contains '" + escapeQuery_(appNo) + "' and trashed = false");
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(String(appNo)) === 0) {
      if (f.getName() !== want) f.setName(want);
      return f;
    }
  }
  return root.createFolder(want);
}

// ---------------------------------------------------------------- แถวในชีท
function upsertRows_(headers, rows) {
  if (!headers || !headers.length) throw new Error('ไม่มีหัวคอลัมน์');
  const sh = sheet_();
  const allHeaders = headers.indexOf(CONFIG.FOLDER_HEADER) < 0 ? headers.concat([CONFIG.FOLDER_HEADER]) : headers;

  // หัวตาราง: เพิ่มเฉพาะคอลัมน์ที่ยังไม่มี (ต่อท้าย) เพื่อไม่ทับคอลัมน์ที่ผู้ใช้สร้างเอง
  const lastCol = Math.max(sh.getLastColumn(), 1);
  let current = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v).trim(); });
  if (current.every(function (v) { return !v; })) current = [];
  const missing = allHeaders.filter(function (h) { return current.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    current = current.concat(missing);
    sh.getRange(1, 1, 1, current.length).setFontWeight('bold').setBackground('#f3e8fb');
    sh.setFrozenRows(1);
  }

  const keyCol = current.indexOf(CONFIG.KEY_HEADER) + 1;
  const lastRow = sh.getLastRow();
  const keys = lastRow > 1
    ? sh.getRange(2, keyCol, lastRow - 1, 1).getValues().map(function (r) { return String(r[0]).replace(/^'/, ''); })
    : [];

  const folders = {};
  rows.forEach(function (row) {
    const key = String(row[CONFIG.KEY_HEADER]).replace(/^'/, '');
    const folder = stationFolder_(key, row[CONFIG.NAME_HEADER]);
    folders[key] = folder.getUrl();
    row[CONFIG.FOLDER_HEADER] = '=HYPERLINK("' + folder.getUrl() + '","เปิดโฟลเดอร์")';

    let idx = keys.indexOf(key);
    let r;
    if (idx < 0) {
      r = Math.max(sh.getLastRow(), 1) + 1;
      keys.push(key);
    } else {
      r = idx + 2;
    }
    // อ่านแถวเดิม (รวมสูตรในคอลัมน์ของผู้ใช้) แล้วแทนเฉพาะคอลัมน์ของระบบ
    const range = sh.getRange(r, 1, 1, current.length);
    const values = range.getValues()[0];
    const formulas = range.getFormulas()[0];
    const merged = values.map(function (v, i) { return formulas[i] ? formulas[i] : v; });
    allHeaders.forEach(function (h) {
      const c = current.indexOf(h);
      if (c >= 0 && Object.prototype.hasOwnProperty.call(row, h)) merged[c] = row[h] == null ? '' : row[h];
    });
    range.setValues([merged]);
  });
  return { ok: true, folders: folders };
}

// ---------------------------------------------------------------- ไฟล์
function uploadFile_(req) {
  if (!req.appNo || !req.data) throw new Error('ข้อมูลไฟล์ไม่ครบ');
  const folder = stationFolder_(req.appNo, req.station);
  const blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || 'application/pdf', req.fileName || 'file.pdf');
  const file = folder.createFile(blob);
  if (req.description) file.setDescription(req.description);
  return { ok: true, fileId: file.getId(), url: file.getUrl(), folderUrl: folder.getUrl() };
}

function trashFile_(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (err) {
    // ไฟล์ถูกลบไปแล้ว หรือไม่มีสิทธิ์ — ถือว่าสำเร็จ
  }
  return { ok: true };
}
