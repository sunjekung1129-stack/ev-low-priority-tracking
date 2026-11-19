'use strict';
// สร้างเว็บเดโมสำหรับ GitHub Pages ลงโฟลเดอร์ demo-dist/
// - ข้อมูลคำร้องทั้งหมดเป็นข้อมูลสมมติ สร้างผ่าน API ของเซิร์ฟเวอร์จริงบนฐานข้อมูลว่าง (ไม่แตะ data/ เลย)
// - รายชื่อ กฟส. มาจาก demo/offices.json (ชื่อหน่วยงาน ไม่ใช่ข้อมูลลูกค้า)
// - หน้าเว็บใช้ public/* ชุดเดียวกับระบบจริง และรันโค้ด server/*.js ในเบราว์เซอร์ผ่าน demo/boot.js
// ใช้: npm run demo:build
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'demo-dist');
const PORT = 3988;
const BASE = `http://localhost:${PORT}`;

// ---------------------------------------------------------------- ข้อมูลสมมติ
const PROVINCES = { // จังหวัด → พิกัดโดยประมาณ (กฟส. = กฟจ.<จังหวัด>)
  เชียงใหม่: [18.79, 98.98], เชียงราย: [19.91, 99.83], ลำปาง: [18.29, 99.49], น่าน: [18.78, 100.78],
  พิษณุโลก: [16.82, 100.26], สุโขทัย: [17.01, 99.82], กำแพงเพชร: [16.48, 99.52],
  นครสวรรค์: [15.70, 100.14], ลพบุรี: [14.80, 100.65], เพชรบูรณ์: [16.42, 101.16],
  อุดรธานี: [17.41, 102.79], ขอนแก่น: [16.43, 102.84], หนองคาย: [17.88, 102.74], สกลนคร: [17.16, 104.15],
  อุบลราชธานี: [15.24, 104.85], ร้อยเอ็ด: [16.05, 103.65], ศรีสะเกษ: [15.12, 104.33],
  นครราชสีมา: [14.97, 102.10], บุรีรัมย์: [14.99, 103.10], สุรินทร์: [14.88, 103.49], ชัยภูมิ: [15.81, 102.03],
  พระนครศรีอยุธยา: [14.35, 100.57], ปทุมธานี: [14.02, 100.53], สระบุรี: [14.53, 100.91],
  ชลบุรี: [13.36, 100.98], ระยอง: [12.68, 101.28], ฉะเชิงเทรา: [13.69, 101.07],
  นครปฐม: [13.82, 100.06], สมุทรสาคร: [13.55, 100.27], กาญจนบุรี: [14.02, 99.53],
  ราชบุรี: [13.54, 99.82], เพชรบุรี: [13.11, 99.94], ประจวบคีรีขันธ์: [11.81, 99.80], ชุมพร: [10.49, 99.18],
  สุราษฎร์ธานี: [9.14, 99.33], นครศรีธรรมราช: [8.43, 99.96], ภูเก็ต: [7.88, 98.39], ตรัง: [7.56, 99.61],
  สงขลา: [7.19, 100.60], ยะลา: [6.54, 101.28],
};
// แบรนด์สมมติ (ไม่ใช่บริษัทจริง)
const BRANDS = [
  ['VOLTA', 'โวลตา ชาร์จจิ้ง'], ['GRNC', 'กรีนชาร์จ เน็ตเวิร์ค'], ['SPRK', 'สปาร์ค อีวี'], ['DMEV', 'ดีมอล อีวี พาร์ค'],
  ['ECO', 'อีโค่ พลัส เอนเนอร์ยี'], ['FAST', 'ฟาสต์ฟิล ชาร์จ'], ['SKY', 'สกายไลน์ โมบิลิตี้'], ['TH', 'ไทยอีวี สเตชั่น'],
];
const PLACES = ['สาขาตัวเมือง', 'ริมถนนสายหลัก', 'หน้าห้างสรรพสินค้า', 'ปั๊มน้ำมัน กม.12', 'ศูนย์การค้า', 'โรงแรมริเวอร์', 'จุดพักรถ', 'ตลาดเช้า'];
const LOCATIONS = ['สถานีบริการเชื้อเพลิงสำหรับรถยนต์', 'สถานีอัดประจุไฟฟ้าโดยเฉพาะ', 'ห้างสรรพสินค้า', 'โรงแรม', 'ร้านค้า/ร้านสะดวกซื้อ'];
const CHARGER_MODELS = [['DemoCharge', 'DC-60'], ['DemoCharge', 'DC-120'], ['VoltBox', 'AC-22'], ['PowerPost', 'DC-180']];

// ตัวสุ่มแบบกำหนดค่าเริ่มต้น เพื่อให้สร้างซ้ำได้ข้อมูลเดิม
let seed = 20261117;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const digits = (n) => Array.from({ length: n }, () => int(0, 9)).join('');
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const TODAY = iso(new Date());

// ---------------------------------------------------------------- เรียก API ของเซิร์ฟเวอร์ชั่วคราว
async function call(cookie, method, url, body) {
  const opt = { method, headers: cookie ? { cookie } : {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(BASE + url, opt);
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(data)}`);
  return { data, setCookie: r.headers.get('set-cookie') };
}
async function login(username, password) {
  const r = await call(null, 'POST', '/api/login', { username, password });
  return r.setCookie.split(';')[0];
}
async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/api/me`); return; } catch { await new Promise((r) => setTimeout(r, 150)); }
  }
  throw new Error('เซิร์ฟเวอร์ชั่วคราวไม่ตอบสนอง');
}
// PDF ตัวอย่างขนาดเล็ก (ข้อความภาษาอังกฤษเพื่อไม่ต้องฝังฟอนต์)
function samplePdf(title, lines = ['(sample file, not a real document)']) {
  const clean = (t) => String(t).replace(/[()\\]/g, '');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = [`BT /F1 16 Tf 60 770 Td (DEMO - ${clean(title)}) Tj ET`,
    ...lines.map((l, i) => `BT /F1 11 Tf 60 ${740 - i * 18} Td (${clean(l)}) Tj ET`)].join('\n');
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: 'application/pdf' });
}

async function seedData() {
  const admin = await login('admin', 'admin1234');
  // รายชื่อ กฟส. ทั้งหมด
  const offices = JSON.parse(fs.readFileSync(path.join(__dirname, 'offices.json'), 'utf8'));
  const short = (r) => r.replace(/^\d+\./, '');
  await call(admin, 'POST', '/api/offices/bulk', { text: offices.map(([n, r]) => `${n}\t${short(r)}`).join('\n') });

  // แผนสถานะ: เสร็จสมบูรณ์ 22 · รอเปลี่ยนอัตรา 4 · รอเงื่อนไข 12 (ค้างชำระ 4, ค้างเงื่อนไขต่าง ๆ 8) · ยกเลิก 2
  const plan = [
    ...Array(22).fill('completed'), ...Array(4).fill('ready'), ...Array(4).fill('unpaid'),
    ...Array(3).fill('c1'), ...Array(3).fill('c3'), ...Array(2).fill('c2'), ...Array(2).fill('cancelled'),
  ];
  // ให้บัญชีทดลอง field1 (เชียงใหม่) และ field2 (ชลบุรี) มีงานในพื้นที่ของตน
  const forced = { 0: 'เชียงใหม่', 22: 'เชียงใหม่', 26: 'เชียงใหม่', 30: 'เชียงใหม่', 1: 'ชลบุรี', 23: 'ชลบุรี', 27: 'ชลบุรี', 33: 'ชลบุรี' };
  const provs = Object.keys(PROVINCES);
  const usedReq = new Set();
  const reqNo = () => { let n; do { n = `1${digits(11)}`; } while (usedReq.has(n)); usedReq.add(n); return n; };
  const created = [];

  for (const [i, kind] of plan.entries()) {
    const prov = forced[i] || pick(provs);
    const [lat, lng] = PROVINCES[prov];
    const [code, brand] = pick(BRANDS);
    const n = int(1, 9);
    const age = kind === 'completed' ? int(150, 560) : kind === 'cancelled' ? int(60, 300) : int(5, 140);
    const requestDate = addDays(TODAY, -age);
    const chargers = Array.from({ length: int(1, 2) }, () => { const [b, m] = pick(CHARGER_MODELS); return { brand: b, model: m, kw: m.includes('22') ? 22 : Number(m.replace(/\D/g, '')), qty: int(1, 3) }; });
    const payload = {
      office: `กฟจ.${prov}`, request_date: requestDate, station_name: `${brand} ${pick(PLACES)} ${prov} ${n}`,
      company: code, applicant_name: `บริษัท ${brand} จำกัด`, applicant_type: 'juristic',
      station_address: `เลขที่ ${int(1, 999)} หมู่ ${int(1, 12)} (ที่อยู่สมมติ)`, district: 'เมือง', province: prov,
      contact_name: 'ผู้ติดต่อ (สมมติ)', email: 'demo@example.com', phone: `08${digits(8)}`,
      ca_no: `0200${digits(8)}`, meter_no: `65${digits(8)}`,
      lat: Number((lat + (rnd() - 0.5) * 0.12).toFixed(5)), lng: Number((lng + (rnd() - 0.5) * 0.12).toFixed(5)),
      location_type: pick(LOCATIONS), criteria: Array(8).fill(true), charge_channels: ['Application', 'QR Code'],
      service_hours: '24', chargers, equipment: [], revenue: ['per_kwh'], total_kva: pick([100, 160, 250, 315, 500]),
      cpo: { system_name: `${brand} App`, provider: brand }, documents: [], test_60364: 'pea', test_61851: 'registered',
    };
    const fd = new FormData();
    fd.append('payload', JSON.stringify(payload));
    fd.append('form_pdf', samplePdf('EV Low Priority request form'), 'แบบฟอร์มคำร้อง (ตัวอย่าง).pdf');
    const { data: { id } } = await call(admin, 'POST', '/api/applications', fd);
    created.push({ id, kind, requestDate });
    if (kind === 'unpaid') continue;
    if (kind === 'cancelled') { await call(admin, 'POST', `/api/applications/${id}/cancel`, { reason: 'ผู้ขอใช้ไฟฟ้าขอยกเลิก (ข้อมูลสมมติ)' }); continue; }

    // ชำระค่าทดสอบ (บางรายการ "ไม่ต้องชำระ")
    const paidDate = addDays(requestDate, int(3, 20));
    const units = chargers.reduce((s, c) => s + c.qty, 0);
    if (rnd() < 0.15) {
      await call(admin, 'POST', `/api/applications/${id}/payment-exempt`, { type: 'safety', exempt: true, reason: 'ผู้ขอใช้ไฟฟ้าจัดหาหน่วยงานภายนอกที่ขึ้นทะเบียนกับ กฟภ. เป็นผู้ทดสอบ' });
    } else {
      await call(admin, 'POST', `/api/applications/${id}/invoices`, { type: 'safety', request_no: reqNo(), units, unit_price: 10000, issued_date: addDays(requestDate, 1) });
    }
    await call(admin, 'POST', `/api/applications/${id}/invoices`, { type: 'cpo', request_no: reqNo(), units: 1, unit_price: pick([2400, 6500]), issued_date: addDays(requestDate, 1) });
    const app = (await call(admin, 'GET', `/api/applications/${id}`)).data;
    for (const inv of app.invoices) await call(admin, 'POST', `/api/invoices/${inv.id}/payment`, { paid: true, paid_date: paidDate });

    // เงื่อนไข 1–3 และผลทดสอบความปลอดภัย
    // หลักฐานทุกหมวดเป็นไฟล์ PDF ตัวอย่าง (ระบบไม่มีเลขที่/วันที่หนังสือแล้ว)
    const EV_FILE = { 1: ['Charger registration with PEA (sample)', 'หลักฐานการขึ้นทะเบียนเครื่องอัดประจุไฟฟ้า (ตัวอย่าง).pdf'],
      2: ['Installation inspection result (sample)', 'ผลตรวจสอบมาตรฐานการติดตั้ง (ตัวอย่าง).pdf'],
      3: ['CPO - PEA EVMS test result (sample)', 'ผลทดสอบระบบ CPO กับ PEA EVMS (ตัวอย่าง).pdf'],
      4: ['Safety test result IEC 60364-6 / IEC 61851 (sample)', 'ผลการตรวจวัดทดสอบความปลอดภัย (ตัวอย่าง).pdf'] };
    const ev = (cond, extra = {}) => {
      const fd = new FormData();
      fd.append('files', samplePdf(EV_FILE[cond][0]), EV_FILE[cond][1]);
      for (const [k, v] of Object.entries({ result: 'pass', ...extra })) fd.append(k, v);
      return call(admin, 'POST', `/api/applications/${id}/attachments?condition=${cond}`, fd);
    };
    const skip = { c1: [1, 2, 3], c2: [2, 3], c3: [3] }[kind] || [];
    for (const c of [1, 2, 3]) if (!skip.includes(c)) await ev(c);
    if (kind === 'c3' && rnd() < 0.5) await ev(3, { result: 'fail', note: 'ทดสอบครั้งแรกไม่ผ่าน รอทดสอบใหม่ (ข้อมูลสมมติ)' });
    if (kind !== 'c1' && rnd() < 0.85) await ev(4, { result: rnd() < 0.8 ? 'pass' : 'fail', note: 'IEC 60364-6 / IEC 61851 (ข้อมูลสมมติ)' });
    if (kind === 'completed') {
      const low = addDays(requestDate, Math.min(age - 3, int(60, 400)));
      await call(admin, 'POST', `/api/applications/${id}/low-rate`, { contract_amended: true, low_effective_date: low });
    }
  }

  // เอกสารหลักฐานที่เกี่ยวข้อง: ชื่อ/หมวด/คำอธิบายเหมือนระบบจริง แต่ไฟล์เป็น PDF ตัวอย่าง (ไม่ใช้ไฟล์จริงซึ่งมีลายน้ำชื่อพนักงาน/เป็นเอกสารภายใน)
  const SAMPLE_NOTE = ['SAMPLE FILE FOR THE EV-LPTS DEMO SITE.', 'This is not a real PEA document.', 'The real form is available in the production system only.'];
  const docs = [
    ['intake', 'แบบฟอร์มการขอใช้ไฟฟ้า (เพิ่มเติม) สำหรับผู้ขอใช้ไฟฟ้าสถานีอัดประจุไฟฟ้า แบบ Low Priority',
      'ผู้ขอใช้ไฟฟ้ากรอกข้อ 1–9 และลงนาม แล้วแนบเป็น PDF ตอนรับคำร้องในระบบ', 'แบบฟอร์มการขอใช้ไฟฟ้า (เพิ่มเติม) - ตัวอย่าง.pdf', 'Electricity Application Form Additional - Low Priority'],
    ['conditions', 'แบบฟอร์มตรวจสอบการติดตั้งระบบอัดประจุยานยนต์ไฟฟ้าก่อนติดตั้งมิเตอร์ — รับไฟฟ้าแรงต่ำจากหม้อแปลงจำหน่ายของ กฟภ. (กวฟ.ผวต.-01-64)',
      'ใช้ตรวจเงื่อนไขที่ 2 กรณีผู้ใช้ไฟฟ้ารับไฟแรงต่ำ 1 เฟส/3 เฟส จากหม้อแปลงของ กฟภ.', 'กวฟ.ผวต.-01-64 แบบฟอร์มตรวจสอบการติดตั้ง (แรงต่ำ) - ตัวอย่าง.pdf', 'Installation Inspection Form - Low Voltage'],
    ['conditions', 'แบบฟอร์มตรวจสอบการติดตั้งระบบอัดประจุยานยนต์ไฟฟ้าก่อนติดตั้งมิเตอร์ — รับไฟฟ้าแรงสูงโดยติดตั้งหม้อแปลงเฉพาะราย (กวฟ.ผวต.-02-64)',
      'ใช้ตรวจเงื่อนไขที่ 2 กรณีผู้ใช้ไฟฟ้ารับไฟแรงสูง 22/33 kV และติดตั้งหม้อแปลงของตนเอง', 'กวฟ.ผวต.-02-64 แบบฟอร์มตรวจสอบการติดตั้ง (แรงสูง) - ตัวอย่าง.pdf', 'Installation Inspection Form - High Voltage, dedicated transformer'],
    ['contract', 'ข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้า (Low Priority)',
      'จัดทำและลงนามกับผู้ใช้ไฟฟ้าก่อนบันทึกวันที่มีผลอัตรา Low Priority', 'ข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้า - ตัวอย่าง.pdf', 'Power Purchase Agreement Amendment - Low Priority'],
  ];
  for (const [i, [category, title, desc, fileName, enTitle]] of docs.entries()) {
    const fd = new FormData();
    fd.append('file', samplePdf(enTitle, SAMPLE_NOTE), fileName);
    fd.append('title', title);
    fd.append('category', category);
    fd.append('description', `${desc} · ไฟล์ตัวอย่างสำหรับเดโม (ไฟล์จริงอยู่ในระบบจริงเท่านั้น)`);
    fd.append('sort', String(i + 1));
    await call(admin, 'POST', '/api/documents', fd);
  }
  return created;
}

// ปรับเวลาในประวัติให้อยู่ระหว่างวันที่ยื่นคำร้องถึงวันที่มีผล (แทนเวลาที่รันสคริปต์)
function retimeHistory(dbFile) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbFile);
  const apps = db.prepare('SELECT id, request_date, low_effective_date, status FROM applications').all();
  for (const a of apps) {
    const end = a.low_effective_date || (a.status === 'cancelled' ? addDays(a.request_date, 20) : addDays(a.request_date, Math.max(1, Math.min(60, Math.round((Date.parse(TODAY) - Date.parse(a.request_date)) / 864e5)))));
    const evs = db.prepare('SELECT id FROM events WHERE application_id = ? ORDER BY id').all(a.id);
    const span = Math.max(1, (Date.parse(end) - Date.parse(a.request_date)) / 864e5);
    evs.forEach((e, k) => {
      const day = addDays(a.request_date, Math.round((span * k) / Math.max(1, evs.length - 1)));
      const ts = `${day} ${String(9 + (k % 7)).padStart(2, '0')}:${String((k * 13) % 60).padStart(2, '0')}:00`;
      db.prepare('UPDATE events SET created_at = ? WHERE id = ?').run(ts, e.id);
    });
    const first = `${a.request_date} 09:00:00`;
    db.prepare('UPDATE applications SET created_at = ?, updated_at = ? WHERE id = ?').run(first, `${end} 15:00:00`, a.id);
    db.prepare("UPDATE applications SET ready_at = ? WHERE id = ? AND ready_at IS NOT NULL").run(`${end} 10:00:00`, a.id);
    db.prepare("UPDATE applications SET completed_at = ? WHERE id = ? AND completed_at IS NOT NULL").run(`${end} 15:00:00`, a.id);
    db.prepare('UPDATE attachments SET uploaded_at = ? WHERE application_id = ?').run(first, a.id);
    db.prepare('UPDATE notifications SET created_at = ? WHERE application_id = ?').run(`${end} 10:00:00`, a.id);
  }
  db.exec("DELETE FROM sessions; DELETE FROM sync_queue; UPDATE notifications SET is_read = 1 WHERE created_at < date('now','-30 day')");
  db.close();
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-demo-'));
  console.log('ฐานข้อมูลชั่วคราว:', tmp);
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, DATA_DIR: tmp, PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  let created;
  try {
    await waitUp();
    created = await seedData();
  } finally {
    srv.kill();
    await new Promise((r) => (srv.exitCode != null ? r() : srv.on('exit', r)));
  }

  // รวมเป็นไฟล์ฐานข้อมูลไฟล์เดียว (ไม่ใช้ WAL เพราะ sql.js ในเบราว์เซอร์อ่านเป็นไฟล์เดียว)
  const src = path.join(tmp, 'ev-low.db');
  retimeHistory(src);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'server'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'google-apps-script'), { recursive: true });
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(src);
  d.exec(`VACUUM INTO '${path.join(OUT, 'seed.db').replace(/'/g, "''")}'`);
  d.close();
  const s = new DatabaseSync(path.join(OUT, 'seed.db'));
  s.exec('PRAGMA journal_mode = DELETE');
  s.close();

  // ไฟล์ตัวอย่าง (PDF แบบฟอร์มคำร้อง uploads/ + เอกสารหลักฐาน docs/) → seed.json โดยคีย์อ้างอิงจาก DATA_DIR
  const files = {};
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else files[path.relative(tmp, full).split(path.sep).join('/')] = fs.readFileSync(full).toString('base64');
  });
  for (const sub of ['uploads', 'docs']) if (fs.existsSync(path.join(tmp, sub))) walk(path.join(tmp, sub));
  fs.writeFileSync(path.join(OUT, 'seed.json'), JSON.stringify({ id: new Date().toISOString(), files }));

  // หน้าเว็บ: ใช้ไฟล์ชุดเดียวกับระบบจริง
  for (const f of ['app.js', 'styles.css']) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(OUT, f));
  for (const f of ['db.js', 'index.js', 'google-sync.js']) fs.copyFileSync(path.join(ROOT, 'server', f), path.join(OUT, 'server', f));
  fs.copyFileSync(path.join(ROOT, 'google-apps-script', 'Code.gs'), path.join(OUT, 'google-apps-script', 'Code.gs'));
  fs.copyFileSync(path.join(__dirname, 'boot.js'), path.join(OUT, 'boot.js'));
  let html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const swap = (from, to) => { if (!html.includes(from)) throw new Error(`index.html: ไม่พบ ${from}`); html = html.replace(from, to); };
  swap('<title>EV-LPTS · ระบบติดตามสถานะคำร้องขอใช้ไฟฟ้า EV Low Priority</title>', '<title>EV-LPTS (เดโม) · ระบบติดตามสถานะคำร้องขอใช้ไฟฟ้า EV Low Priority</title>\n  <meta name="robots" content="noindex">');
  swap('href="/styles.css"', 'href="styles.css"');
  swap('<script src="/app.js"></script>',
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js"></script>\n  <script src="boot.js"></script>');
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  fs.rmSync(tmp, { recursive: true, force: true });

  const count = created.reduce((m, c) => ({ ...m, [c.kind]: (m[c.kind] || 0) + 1 }), {});
  console.log(`สร้างคำร้องสมมติ ${created.length} รายการ`, count);
  console.log('ผลลัพธ์อยู่ที่', OUT);
}

main().catch((err) => { console.error(err); process.exit(1); });
