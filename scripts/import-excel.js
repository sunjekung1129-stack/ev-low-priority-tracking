'use strict';
/*
 * นำเข้าข้อมูลคำร้อง EV Low Priority จากไฟล์ Excel (รูปแบบเดียวกับ Book1.xlsx)
 *   npm run import -- "C:\path\to\Book1.xlsx"            นำเข้า
 *   npm run import -- "C:\path\to\Book1.xlsx" --dry-run  ตรวจสอบอย่างเดียว ไม่บันทึก
 * คอลัมน์อ้างอิงจากชื่อหัวตาราง (แถวที่ 1) จึงสลับตำแหน่งคอลัมน์ได้
 * แถวที่เคยนำเข้าแล้ว (CA เดิม) จะถูกข้าม จึงรันซ้ำกับไฟล์ที่อัปเดตได้
 */
const path = require('node:path');
const ExcelJS = require('exceljs');
const { db, tx, nextAppNo, nowLocal, safetyEvidence } = require('../server/db');
const googleSync = require('../server/google-sync'); // เข้าคิวส่งขึ้น Google Sheets (ถ้าเปิดใช้)

const file = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!file) {
  console.error('ระบุไฟล์ Excel: npm run import -- "path\\to\\file.xlsx" [--dry-run]');
  process.exit(1);
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function cellValue(cell) {
  let v = cell.value;
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (v.error) return null;
    if ('result' in v) v = v.result;
    else if (v.hyperlink) v = v.hyperlink;
    else if (v.richText) v = v.richText.map((t) => t.text).join('');
    else if (v.text) v = v.text;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = norm(v);
  return s === '' || s === 'N/A' ? null : s;
}

const toDate = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const toNum = (v) => (v == null || v === '' || Number.isNaN(Number(String(v).replace(/,/g, ''))) ? null : Number(String(v).replace(/,/g, '')));
const toResult = (v) => (v === 'ผ่าน' ? 'pass' : v === 'ไม่ผ่าน' ? 'fail' : null);
const isUrl = (v) => /^https?:\/\//i.test(v || '');

function splitProduct(text) {
  if (!text) return null;
  const parts = text.split(' ');
  const kw = text.match(/(\d+(?:\.\d+)?)\s*KW/i);
  return { brand: parts[0], model: parts.slice(1).join(' ') || parts[0], kw: kw ? Number(kw[1]) : null };
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  // หาคอลัมน์จากชื่อหัวตาราง: ตรงทุกตัวอักษรก่อน แล้วค่อยขึ้นต้นด้วย
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i] = norm(cellValue(c) ?? c.value); });
  const colOf = (name) => {
    let i = headers.findIndex((h) => h === name);
    if (i < 0) i = headers.findIndex((h) => h && h.startsWith(name));
    return i;
  };
  const required = ['สถานี EV', 'กฟฟ.หน้างาน'];
  for (const r of required) if (colOf(r) < 0) throw new Error(`ไม่พบคอลัมน์ "${r}" ในแถวหัวตาราง`);

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (name) => { const i = colOf(name); return i < 0 ? null : cellValue(row.getCell(i)); };
    const station = get('สถานี EV');
    const office = get('กฟฟ.หน้างาน');
    if (!station || !office) continue; // แถวว่าง/แถวสูตรตัวอย่าง

    const [lat, lng] = (get('Lat,Long') || '').split(',').map((s) => toNum(s?.trim()));
    const chargers = [];
    for (const n of [1, 2]) {
      const p = splitProduct(get(`Ev Product ${n}`));
      if (p) chargers.push({ ...p, qty: toNum(get(`Q'ty ${n}`)) || 1, registration: get(`Product list ${n}`) });
    }
    rows.push({
      excelRow: r,
      request_date: toDate(get('วันที่ยื่นคำร้อง')),
      letter_no: get('เลขหนังสือ'),
      station_name: station,
      contact_name: get('ผู้ประสานงาน'),
      phone: get('เบอร์โทร'),
      company: get('Company'),
      applicant_name: get('Company_Full') || get('Company') || station,
      received_by: get('รับคำร้อง โดย'),
      ca_no: get('Contract Acc. M/I'),
      office,
      region: get('กฟข.'),
      district: get('อำเภอ'),
      province: get('จังหวัด'),
      bp: get('BP'),
      meter_no: get('Meter No. /PEA No .'),
      premise: get('Premise'),
      rate_name: get('อัตราค่าไฟฟ้า'),
      registration: get('Product list'),
      chargers,
      platform: get('Platform'),
      erc_no: get('เลขที่จดแจ้ง/อนุญาต'),
      kva: toNum(get('kVA')),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      inspect: { doc: get('1.หนังสือ'), date: toDate(get('1.วันที่หนังสือ')), result: toResult(get('ตรวจสอบมาตรฐานการติดตั้งสถานีอัดประจุ')) },
      safety: {
        doc: get('2.หนังสือ'), date: toDate(get('2.วันที่หนังสือ')),
        iec60364: get('ตรวจวัดและทดสอบความปลอดภัยสถานีอัดประจุ'), iec61851: get('ตรวจวัดและทดสอบสถานะการอัดประจุ'),
      },
      y3: get('แจ้ง Y3'),
      cpo: { doc: get('4.หนังสือ'), date: toDate(get('4.วันที่หนังสือ')), result: toResult(get('ทดสอบปฏิบัติการโครงข่าย CPO')) },
      low_letter_no: get('หนังสือเปลี่ยนอัตรา'),
      low_date: toDate(get('วันที่หนังสือเปลี่ยนอัตรา')),
      next_step: get('การดำเนินการต่อไป'),
    });
  }
  rows.sort((a, b) => String(a.request_date).localeCompare(String(b.request_date)) || a.excelRow - b.excelRow);

  const exists = db.prepare('SELECT app_no FROM applications WHERE import_key = ?');
  let imported = 0;
  let skipped = 0;
  const summary = { completed: 0, ready: 0, pending: 0 };

  for (const x of rows) {
    const key = `xlsx:${x.ca_no || x.station_name}`;
    const dup = exists.get(key);
    if (dup) { skipped++; console.log(`ข้าม แถว ${x.excelRow} ${x.station_name} (มีแล้ว ${dup.app_no})`); continue; }

    // หลักฐาน 3 เงื่อนไข
    const evidence = [];
    const reqTs = `${x.request_date || nowLocal().slice(0, 10)} 00:00:00`;
    if (x.registration === 'ขึ้นทะเบียนแล้ว') {
      evidence.push({ cond: 1, result: 'pass', date: null,
        note: `ขึ้นทะเบียนแล้ว: ${x.chargers.map((c) => `${c.brand} ${c.model}`).join(', ') || '-'}` });
    }
    const docEvidence = (cond, d) => {
      if (!d.doc && !d.result) return;
      evidence.push({ cond, url: isUrl(d.doc) ? d.doc : null, doc_no: isUrl(d.doc) ? null : d.doc, date: d.date, result: d.result });
    };
    docEvidence(2, x.inspect);
    docEvidence(3, x.cpo);
    if (x.safety.doc || x.safety.iec60364 || x.safety.iec61851) {
      const se = safetyEvidence({ ...x.safety, url: isUrl(x.safety.doc) ? x.safety.doc : null, doc_no: isUrl(x.safety.doc) ? null : x.safety.doc });
      evidence.push({ cond: 4, ...se, date: x.safety.date });
    }

    const met = (n) => evidence.some((e) => e.cond === n && e.result !== 'fail');
    const allMet = met(1) && met(2) && met(3);
    const gotLow = /ได้รับอัตรา Low/.test(x.next_step || '') && x.low_date;
    const status = gotLow ? 'completed' : allMet ? 'ready' : 'pending';
    const condDates = evidence.filter((e) => e.cond >= 1 && e.cond <= 3).map((e) => e.date).filter(Boolean).sort();
    const readyAt = allMet ? `${condDates[condDates.length - 1] || x.request_date} 00:00:00` : null;
    summary[status]++;

    const data = {
      imported: true,
      import_file: path.basename(file),
      import_row: x.excelRow,
      applicant_type: 'juristic',
      letter_no: x.letter_no,
      received_by: x.received_by,
      bp: x.bp,
      premise: x.premise,
      rate_name: x.rate_name,
      erc_no: x.erc_no,
      y3: x.y3,
      // "ไม่ต้องชำระค่าทดสอบ" ใน Excel → ขั้นชำระเงินถือว่าผ่าน (ไม่ต้องชำระทั้ง 2 รายการ)
      ...(/ไม่ต้องชำระ/.test(x.y3 || '') ? { payment: {
        safety: { exempt: true, reason: `ข้อมูลจาก Excel: ${x.y3}` }, cpo: { exempt: true, reason: `ข้อมูลจาก Excel: ${x.y3}` },
      } } : {}),
      chargers: x.chargers.map(({ registration, ...c }) => c),
      equipment: [],
      cpo: { system_name: x.platform || '', provider: x.company || '' },
      safety_test: x.safety.doc || x.safety.iec60364 ? {
        url: isUrl(x.safety.doc) ? x.safety.doc : null, doc_no: isUrl(x.safety.doc) ? null : x.safety.doc,
        date: x.safety.date, iec60364: x.safety.iec60364, iec61851: x.safety.iec61851,
      } : null,
      criteria: null, // ไม่มีข้อมูลในไฟล์ Excel
    };
    const totalKw = x.chargers.reduce((s, c) => s + (c.kw || 0) * (c.qty || 0), 0) || null;

    if (dryRun) {
      imported++;
      console.log(`[dry-run] แถว ${x.excelRow} ${x.station_name} · ${x.office} · ${status} · หลักฐาน ${evidence.length} รายการ`);
      continue;
    }

    tx(() => {
      const appNo = nextAppNo(x.request_date);
      const r = db.prepare(`INSERT INTO applications (app_no, office, region, province, district, ca_no, meter_no, request_date,
        station_name, company, applicant_name, contact_name, phone, lat, lng, total_kw, total_kva, data, status, ready_at,
        low_effective_date, low_letter_no, sap_note, completed_at, source, import_key, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        appNo, x.office, x.region, x.province, x.district, x.ca_no, x.meter_no, x.request_date, x.station_name, x.company,
        x.applicant_name, x.contact_name, x.phone, x.lat, x.lng, totalKw, x.kva, JSON.stringify(data), status, readyAt,
        gotLow ? x.low_date : null, gotLow ? x.low_letter_no : null, null,
        gotLow ? `${x.low_date} 00:00:00` : null, 'import', key, reqTs, nowLocal());
      const id = Number(r.lastInsertRowid);
      const ev = db.prepare('INSERT INTO events (application_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?)');
      const att = db.prepare(`INSERT INTO attachments (application_id, condition_no, url, doc_no, doc_date, result, note, uploaded_at)
        VALUES (?,?,?,?,?,?,?,?)`);
      ev.run(id, null, 'create', `รับคำร้อง${x.letter_no ? ` (หนังสือ ${x.letter_no})` : ''} — นำเข้าจาก ${path.basename(file)} แถว ${x.excelRow}`, reqTs);
      for (const e of evidence) {
        const ts = e.date ? `${e.date} 00:00:00` : reqTs;
        att.run(id, e.cond, e.url || null, e.doc_no || null, e.date, e.result, e.note || null, ts);
        const what = e.cond === 4 ? 'ผลการตรวจวัดทดสอบความปลอดภัย' : `หลักฐานเงื่อนไขที่ ${e.cond}`;
        ev.run(id, null, 'upload', `${what}${e.doc_no ? ` ${e.doc_no}` : ''}${e.result ? ` — ผล${e.result === 'pass' ? 'ผ่าน' : 'ไม่ผ่าน'}` : ''}${e.note ? ` (${e.note})` : ''}`, ts);
      }
      if (readyAt) ev.run(id, null, 'ready', 'เงื่อนไขครบทั้ง 3 ข้อ', readyAt);
      if (gotLow) ev.run(id, null, 'low_rate', `เปลี่ยนอัตรา Low แล้ว${x.low_letter_no ? ` — หนังสือ ${x.low_letter_no}` : ''}`, `${x.low_date} 00:00:00`);
      googleSync.queueApp(id);
      imported++;
      console.log(`นำเข้า ${appNo} ${x.station_name} · ${x.office} · ${status}`);
    });
  }

  console.log(`\n${dryRun ? '[dry-run] ' : ''}นำเข้า ${imported} รายการ, ข้าม ${skipped} รายการ`
    + ` (เสร็จสมบูรณ์ ${summary.completed}, รอ SAP ${summary.ready}, รอเงื่อนไข ${summary.pending})`);
})().catch((err) => { console.error('นำเข้าไม่สำเร็จ:', err.message); process.exit(1); });
