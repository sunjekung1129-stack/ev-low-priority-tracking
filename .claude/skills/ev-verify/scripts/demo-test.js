// ทดสอบเว็บเดโม (demo-dist/) ในเบราว์เซอร์ โดยจำลองเส้นทางแบบ GitHub Pages (/ev-low-priority-tracking/)
// ใช้: npm run demo:build แล้ว node .claude/skills/ev-verify/scripts/demo-test.js <โฟลเดอร์ภาพหน้าจอ>
const puppeteer = require('puppeteer-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const OUT = process.argv[2] || path.join(require('node:os').tmpdir(), 'ev-demo-shots');
fs.mkdirSync(OUT, { recursive: true });
const DIST = path.join(__dirname, '..', '..', '..', '..', 'demo-dist');
const PREFIX = '/ev-low-priority-tracking/';
const URL0 = `http://localhost:3977${PREFIX}`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const full = path.join(DIST, decodeURIComponent(u.pathname.slice(PREFIX.length)) || 'index.html');
  if (!u.pathname.startsWith(PREFIX) || !full.startsWith(DIST) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}).listen(3977);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
  const out = [];
  const check = (name, ok, extra = '') => out.push(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` ${extra}`}`);

  await page.goto(URL0, { waitUntil: 'networkidle0' });
  await sleep(1500);
  check('หน้าเข้าสู่ระบบ + แผงบัญชีเดโมเปิดอยู่', await page.$eval('#demoBadge .db-panel', (el) => !el.hidden));
  await page.screenshot({ path: `${OUT}/d1-login.png` });

  // เข้าสู่ระบบผ่านปุ่มในแผงเดโม
  await page.click('[data-demo-login="field1"]');
  await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
  await sleep(2500);
  const who = await page.evaluate(async () => (await (await fetch('/api/me')).json()).user);
  check('เข้าสู่ระบบเป็น field1', who && who.username === 'field1', JSON.stringify(who));
  await page.screenshot({ path: `${OUT}/d2-overview.png` });

  const r = await page.evaluate(async () => {
    const j = async (m, u, b) => { const o = { method: m, headers: {} }; if (b instanceof FormData) o.body = b; else if (b) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(b); } const x = await fetch(u, o); return { s: x.status, b: (x.headers.get('content-type') || '').includes('json') ? await x.json() : await x.text() }; };
    const res = {};
    const all = (await j('GET', '/api/applications?scope=all')).b;
    res.total = all.length;
    const mine = (await j('GET', '/api/applications')).b;
    res.mine = mine.length;
    const unpaid = mine.find((a) => a.status === 'pending' && !a.paid);
    res.unpaidId = unpaid && unpaid.id;
    // นอกพื้นที่: บันทึกไม่ได้
    const other = all.find((a) => a.office !== 'กฟจ.เชียงใหม่' && a.status === 'pending');
    res.crossArea = (await j('POST', `/api/applications/${other.id}/invoices`, { type: 'cpo', request_no: '199999999999', units: 1, unit_price: 2400 })).s;
    // ชำระเงินในพื้นที่ตนเอง
    const i1 = await j('POST', `/api/applications/${unpaid.id}/invoices`, { type: 'safety', request_no: '188888888881', units: 1, unit_price: 10000 });
    const i2 = await j('POST', `/api/applications/${unpaid.id}/invoices`, { type: 'cpo', request_no: '188888888882', units: 1, unit_price: 6500 });
    res.invoices = [i1.s, i2.s];
    const app = (await j('GET', `/api/applications/${unpaid.id}`)).b;
    for (const inv of app.invoices) await j('POST', `/api/invoices/${inv.id}/payment`, { paid: true, paid_date: '2026-11-10' });
    res.paid = (await j('GET', `/api/applications/${unpaid.id}`)).b.payment.done;
    // อัปโหลดไฟล์เงื่อนไข 1 และดาวน์โหลดกลับ
    const fd = new FormData();
    fd.append('files', new File([new Uint8Array([37, 80, 68, 70, 45, 49])], 'ทดสอบ เงื่อนไข1.pdf', { type: 'application/pdf' }));
    fd.append('result', 'pass');
    res.upload = (await j('POST', `/api/applications/${unpaid.id}/attachments?condition=1`, fd)).s;
    const att = (await j('GET', `/api/applications/${unpaid.id}`)).b.attachments.find((t) => t.condition_no === 1);
    const dl = await fetch(`/api/attachments/${att.id}`);
    res.download = [dl.status, dl.headers.get('content-disposition'), (await dl.arrayBuffer()).byteLength];
    res.ev2 = (await j('POST', `/api/applications/${unpaid.id}/evidence?condition=2`, { doc_no: 'ทดสอบ 1/2569', result: 'pass' })).s;
    res.ev3byField = (await j('POST', `/api/applications/${unpaid.id}/evidence?condition=3`, { doc_no: 'x' })).s;
    // รับคำร้องใหม่พร้อม PDF
    const payload = { request_date: '2026-11-17', station_name: 'สถานีทดสอบเดโม', applicant_name: 'บริษัท ทดสอบ จำกัด', ca_no: '020011112222', meter_no: '6511112222',
      location_type: 'ห้างสรรพสินค้า', criteria: Array(8).fill(true), charge_channels: ['QR Code'], service_hours: '24',
      chargers: [{ brand: 'X', model: 'Y', kw: 60, qty: 1 }], test_60364: 'pea', test_61851: 'pea', lat: 18.8, lng: 99 };
    const nf = new FormData();
    nf.append('payload', JSON.stringify(payload));
    nf.append('form_pdf', new File([new Uint8Array([37, 80, 68, 70])], 'คำร้อง.pdf', { type: 'application/pdf' }));
    const created = await j('POST', '/api/applications', nf);
    res.create = [created.s, created.b.id];
    res.csv = (await fetch('/api/applications/export.csv?scope=all')).status;
    res.stats = (await j('GET', '/api/stats?scope=all')).b.total;
    return res;
  });
  check('เห็นคำร้องทั้งหมด 40 + ของตนเอง', r.total === 40 && r.mine >= 3, JSON.stringify(r));
  check('บันทึกข้ามพื้นที่ไม่ได้ (403)', r.crossArea === 403, r.crossArea);
  check('บันทึกเลขที่คำร้อง + ติ๊กชำระ', r.invoices.join() === '201,201' && r.paid, JSON.stringify(r.invoices));
  check('อัปโหลดไฟล์เงื่อนไข 1 + ดาวน์โหลดกลับ', r.upload === 201 && r.download[0] === 200 && r.download[2] === 6, JSON.stringify(r.download));
  check('เงื่อนไข 2 (เลขที่หนังสือ) ได้ · เงื่อนไข 3 โดย กฟส. ไม่ได้', r.ev2 === 201 && r.ev3byField === 403, `${r.ev2} ${r.ev3byField}`);
  check('รับคำร้องใหม่พร้อม PDF', r.create[0] === 201, JSON.stringify(r.create));
  check('ส่งออก CSV + สถิติ', r.csv === 200 && r.stats === 41, `${r.csv} ${r.stats}`);

  // ข้อมูลยังอยู่หลังรีโหลด (IndexedDB)
  await sleep(800);
  await page.goto(`${URL0}#/app/${r.create[1]}`, { waitUntil: 'networkidle0' });
  await sleep(2500);
  const after = await page.evaluate(async () => (await (await fetch('/api/stats?scope=all')).json()).total);
  check('ข้อมูลยังอยู่หลังรีโหลดหน้า', after === 41, after);
  await page.screenshot({ path: `${OUT}/d3-new-app.png` });
  await page.goto(`${URL0}#/app/${r.unpaidId}`, { waitUntil: 'networkidle0' });
  await sleep(2000);
  await page.screenshot({ path: `${OUT}/d4-paid-app.png` });
  await page.goto(`${URL0}#/list`, { waitUntil: 'networkidle0' });
  await sleep(2000);
  await page.screenshot({ path: `${OUT}/d5-list.png` });
  // หน้าผู้ดูแลระบบ
  await page.evaluate(async () => { await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'demo1234' }) }); });
  for (const route of ['users', 'offices', 'google']) {
    await page.goto(`${URL0}#/${route}`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    await page.screenshot({ path: `${OUT}/d6-${route}.png` });
  }
  // รีเซ็ต
  page.on('dialog', (d) => d.accept());
  await page.click('#demoBadge .db-chip');
  await sleep(300);
  await page.click('#demoBadge .db-reset');
  await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
  await sleep(2500);
  const reset = await page.evaluate(async () => (await fetch('/api/me')).status);
  check('รีเซ็ตข้อมูลแล้วต้องเข้าสู่ระบบใหม่', reset === 401, reset);
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.click('[data-demo-login="admin"]').catch(() => {});
  await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/d7-mobile.png` });

  console.log(out.join('\n'));
  console.log(errs.length ? `ข้อผิดพลาด:\n${errs.join('\n')}` : 'ไม่พบ JavaScript error');
  await browser.close();
  server.close();
  process.exit(out.some((l) => l.startsWith('✗')) || errs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
