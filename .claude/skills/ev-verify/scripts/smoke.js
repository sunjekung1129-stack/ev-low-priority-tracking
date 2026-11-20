// ทดสอบ workflow หลักผ่าน API กับเซิร์ฟเวอร์ทดสอบ (ต้องใช้ข้อมูลจาก prepare-test-data.js)
// usage: node .claude/skills/ev-verify/scripts/smoke.js http://localhost:3999
const B = (process.argv[2] || 'http://localhost:3999').replace(/\/$/, '');
const PW = 'test1234';
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${!ok && info ? ` — ${info}` : ''}`); };

async function login(u) {
  const r = await fetch(`${B}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) });
  if (!r.ok) throw new Error(`login ${u} failed (${r.status}) — รัน prepare-test-data.js แล้วหรือยัง?`);
  return r.headers.get('set-cookie').split(';')[0];
}
async function call(c, method, url, body) {
  const fd = body instanceof FormData;
  const r = await fetch(B + url, { method, headers: { cookie: c, ...(body && !fd ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (fd ? body : JSON.stringify(body)) : undefined });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, body: type.includes('json') ? await r.json() : await r.text() };
}
// Export Excel → ข้อความทีละแถว (ค่าเซลล์คั่นด้วย ,) สำหรับตรวจเนื้อหา
async function xlsx(cookie, query = '') {
  const ExcelJS = require('exceljs');
  const r = await fetch(`${B}/api/applications/export.xlsx${query}`, { headers: { cookie } });
  const type = r.headers.get('content-type') || '';
  if (r.status !== 200 || !type.includes('spreadsheetml')) return { status: r.status, type, text: '' };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
  const ws = wb.worksheets[0];
  const lines = [];
  ws.eachRow((row) => lines.push(row.values.slice(1).map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ?? '')).join(',')));
  return { status: r.status, type, text: lines.join('\n'), ws, name: r.headers.get('content-disposition') || '' };
}
const pdf = (text) => new Blob([`%PDF-1.4 ${text}`], { type: 'application/pdf' });
const stamp = Date.now().toString().slice(-6);
const form = {
  station_name: `สถานีทดสอบอัตโนมัติ ${stamp}`, applicant_name: 'บจ. ทดสอบ',
  cpo: { platform: 'other', system_name: 'Test CPO App', short: 'tst', provider: 'บจ. ทดสอบ' },
  ca_no: `0200${stamp}00`, meter_no: `65${stamp}00`, location_type: 'โรงแรม', criteria: Array(8).fill(true),
  charge_channels: ['QR Code'], service_hours: '24', chargers: [{ brand: 'ABB', model: 'Terra', kw: 60, qty: 2 }],
  test_60364: 'pea', test_61851: 'registered', lat: 18.79, lng: 98.98,
};
const multipart = (payload, files = {}) => {
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  for (const [k, name] of Object.entries(files)) fd.append(k, pdf(k), name);
  return fd;
};

(async () => {
  const admin = await login('t_admin'); const f1 = await login('t_field'); const f2 = await login('t_field2');
  const tfd = await login('t_tfd'); const reg = await login('t_region');
  check('เข้าสู่ระบบได้ทุกบทบาท', true);

  const lk = await call(f1, 'GET', '/api/lookups');
  check('กฟข. ครบ 12 เขต', lk.body.regions?.length === 12, JSON.stringify(lk.body.regions));

  let r = await call(f1, 'POST', '/api/applications', multipart(form));
  check('ไม่แนบ PDF แบบฟอร์มคำร้อง → ถูกปฏิเสธ', r.status === 400 && /PDF/.test(r.body.error || ''), JSON.stringify(r.body));
  r = await call(f1, 'POST', '/api/applications', multipart({ ...form, ca_no: '' }, { form_pdf: 'คำร้อง.pdf' }));
  check('ไม่กรอก CA → ถูกปฏิเสธ', r.status === 400, JSON.stringify(r.body));

  r = await call(f1, 'POST', '/api/applications', multipart({ ...form, region: '4.กฟต.3' }, { form_pdf: 'คำร้อง.pdf' }));
  check('รับคำร้องพร้อม PDF ได้', r.status === 201, JSON.stringify(r.body));
  const id = r.body.id;
  let d = (await call(f1, 'GET', `/api/applications/${id}`)).body;
  check('กฟส./กฟข. มาจากบัญชีผู้ใช้ (ไม่เชื่อค่าที่ส่งมา)', d.office === 'กฟจ.เชียงใหม่' && d.region === '1.กฟน.1', `${d.office} ${d.region}`);
  check('แบบฟอร์มคำร้องถูกแนบ', d.attachments.some((t) => t.condition_no === 0));

  r = await call(f2, 'GET', `/api/applications/${id}`);
  check('กฟส. อื่นเปิดดูคำร้องนอกพื้นที่ไม่ได้ (403)', r.status === 403, r.status);
  r = await call(f2, 'GET', `/api/attachments/${d.attachments.find((t) => t.condition_no === 0).id}`);
  check('กฟส. อื่นเปิดไฟล์ของคำร้องนอกพื้นที่ไม่ได้ (403)', r.status === 403, r.status);
  r = await call(reg, 'GET', `/api/applications/${id}`);
  check('กบล. เปิดดูคำร้องในเขตตนเองได้', r.status === 200 && r.body.permissions.in_area === true, r.status);
  r = await call(f2, 'POST', `/api/applications/${id}/evidence?condition=1`, { doc_no: 'x' });
  check('กฟส. อื่นบันทึกหลักฐานข้ามพื้นที่ไม่ได้', r.status === 403, JSON.stringify(r.body));

  // ---- ขั้นชำระเงินค่าทดสอบ (ต้องครบก่อนตรวจเงื่อนไข)
  r = await call(f1, 'POST', `/api/applications/${id}/evidence?condition=1`, { doc_no: 'ก่อนชำระ' });
  check('ยังไม่ชำระค่าทดสอบ → บันทึกเงื่อนไขไม่ได้', r.status === 403 && /ชำระ/.test(r.body.error || ''), JSON.stringify(r.body));
  r = await call(f1, 'POST', `/api/applications/${id}/invoices`, { type: 'safety', request_no: '123', units: 2 });
  check('เลขที่คำร้องไม่ครบ 12 หลัก → ถูกปฏิเสธ', r.status === 400);
  const reqNo = `9${stamp}00000`.slice(0, 12);
  r = await call(f1, 'POST', `/api/applications/${id}/invoices`, { type: 'safety', request_no: reqNo, units: 2 });
  check('บันทึกเลขที่คำร้องค่าทดสอบความปลอดภัยได้', r.status === 201, JSON.stringify(r.body));
  r = await call(f1, 'POST', `/api/applications/${id}/invoices`, { type: 'safety', request_no: reqNo, units: 1 });
  check('เลขที่คำร้องซ้ำในค่าทดสอบประเภทเดียวกัน → ถูกปฏิเสธ', r.status === 400, JSON.stringify(r.body));
  r = await call(f1, 'POST', `/api/applications/${id}/invoices`, { type: 'cpo', request_no: reqNo, units: 1, unit_price: 2400 });
  check('สถานีเดียวกัน ค่าทดสอบ CPO ใช้เลขที่คำร้องเดียวกับค่าทดสอบความปลอดภัยได้', r.status === 201, JSON.stringify(r.body));
  { const sameNo = (await call(f1, 'GET', `/api/applications/${id}`)).body.invoices.find((i) => i.type === 'cpo' && i.request_no === reqNo);
    if (sameNo) await call(f1, 'DELETE', `/api/invoices/${sameNo.id}`); }
  r = await call(f1, 'POST', `/api/applications/${id}/invoices`, { type: 'cpo', request_no: '1'.repeat(11) + '9', units: 1, unit_price: 5000 });
  check('อัตราค่าทดสอบ CPO ต้องเป็น 2,400/6,500', r.status === 400);
  d = (await call(f1, 'GET', `/api/applications/${id}`)).body;
  const safetyInv = d.invoices.find((i) => i.type === 'safety');
  r = await call(f2, 'POST', `/api/invoices/${safetyInv.id}/payment`, { paid: true });
  check('กฟส. อื่นติ๊กชำระเงินข้ามพื้นที่ไม่ได้', r.status === 403);
  r = await call(f1, 'POST', `/api/invoices/${safetyInv.id}/payment`, { paid: true, paid_date: '2026-11-15' });
  check('ติ๊กชำระค่าทดสอบความปลอดภัยแล้ว (ยังเหลือ CPO)', r.status === 200 && r.body.payment.safety.done && !r.body.payment.done, JSON.stringify(r.body.payment));
  r = await call(f1, 'POST', `/api/applications/${id}/payment-exempt`, { type: 'cpo', exempt: true });
  check('ไม่ต้องชำระ ต้องระบุเหตุผล', r.status === 400);
  // กบล. กฟข. บันทึกเลขที่คำร้อง/การชำระเงินในเขตตนได้ แต่ข้ามเขตไม่ได้
  r = await call(reg, 'POST', `/api/applications/${id}/invoices`, { type: 'cpo', request_no: `8${stamp}00001`.slice(0, 12), units: 1, unit_price: 6500 });
  check('กบล. กฟข. บันทึกเลขที่คำร้องค่าทดสอบในเขตตนได้', r.status === 201, JSON.stringify(r.body));
  const regInv = (await call(reg, 'GET', `/api/applications/${id}`)).body.invoices.find((i) => i.type === 'cpo');
  r = await call(reg, 'DELETE', `/api/invoices/${regInv.id}`);
  check('กบล. กฟข. ลบเลขที่คำร้องที่ตนบันทึกได้', r.status === 200, JSON.stringify(r.body));
  const other = await call(f2, 'POST', '/api/applications', multipart({ ...form, ca_no: `0300${stamp}00`, meter_no: `66${stamp}00`, station_name: `สถานีเขตอื่น ${stamp}` }, { form_pdf: 'คำร้อง.pdf' }));
  r = await call(f2, 'POST', `/api/applications/${other.body.id}/invoices`, { type: 'safety', request_no: reqNo, units: 1 });
  check('เลขที่คำร้องซ้ำกับสถานีอื่น → ถูกปฏิเสธ', r.status === 400 && /สถานีอื่น/.test(r.body.error || ''), JSON.stringify(r.body));
  r = await call(reg, 'POST', `/api/applications/${other.body.id}/invoices`, { type: 'cpo', request_no: `7${stamp}00001`.slice(0, 12), units: 1, unit_price: 2400 });
  check('กบล. กฟข. บันทึกเลขที่คำร้องข้ามเขตไม่ได้', r.status === 403, r.status);
  r = await call(reg, 'POST', `/api/applications/${id}/payment-exempt`, { type: 'cpo', exempt: true, reason: 'ทดสอบระบบ' });
  check('กบล. กฟข. ระบุ "ไม่ต้องชำระค่าทดสอบ CPO" → ชำระครบ', r.status === 200 && r.body.payment.done, JSON.stringify(r.body));
  const tn = (await call(tfd, 'GET', '/api/notifications')).body;
  check('แจ้ง กทฟ. เมื่อชำระค่าทดสอบครบ', tn.items.some((x) => x.application_id === id && /ชำระเงินค่าทดสอบครบ/.test(x.message)));

  // ---- เงื่อนไข 3 ข้อ
  r = await call(f1, 'POST', `/api/applications/${id}/evidence?condition=1`, { url: 'https://drive.google.com/file/d/x/view', doc_no: 'ทดสอบ 1/2569', result: 'pass' });
  check('เงื่อนไข 1 (ลิงก์) บันทึกได้หลังชำระ', r.status === 201 && r.body.status === 'pending', JSON.stringify(r.body));
  for (const c of [1, 2, 4]) {
    r = await call(c === 4 ? reg : f1, 'POST', `/api/applications/${id}/evidence?condition=${c}`, { doc_no: 'ไม่ควรรับ', doc_date: '2026-11-01', result: 'pass' });
    check(`หลักฐานหมวด ${c} ระบุเลขที่หนังสืออย่างเดียวไม่ได้ (ต้องแนบไฟล์/ลิงก์)`, r.status === 400, JSON.stringify(r.body));
  }
  const fd = new FormData(); fd.append('files', pdf('c2'), 'ผลตรวจการติดตั้ง.pdf'); fd.append('result', 'pass');
  fd.append('doc_no', 'ไม่ควรบันทึก'); fd.append('doc_date', '2026-11-01');
  r = await call(reg, 'POST', `/api/applications/${id}/attachments?condition=2`, fd);
  check('กบล. กฟข. อัปโหลดไฟล์เงื่อนไข 2 ในเขตตนได้', r.status === 201, JSON.stringify(r.body));
  const c2 = (await call(f1, 'GET', `/api/applications/${id}`)).body.attachments.find((t) => t.condition_no === 2);
  check('เงื่อนไข 2 ไม่บันทึกเลขที่/วันที่หนังสือ', c2 && c2.doc_no === null && c2.doc_date === null, JSON.stringify(c2));
  r = await call(reg, 'POST', `/api/applications/${other.body.id}/evidence?condition=1`, { url: 'https://drive.google.com/x' });
  check('กบล. กฟข. บันทึกเงื่อนไขข้ามเขตไม่ได้', r.status === 403, r.status);
  r = await call(f1, 'POST', `/api/applications/${id}/evidence?condition=3`, { doc_no: 'x' });
  check('กฟส. บันทึกเงื่อนไข 3 ไม่ได้ (เฉพาะ กทฟ.)', r.status === 403);
  r = await call(tfd, 'POST', `/api/applications/${id}/evidence?condition=3`, { url: 'https://drive.google.com/file/d/cpo1/view', result: 'fail' });
  check('ผล "ไม่ผ่าน" ไม่นับว่าครบ', r.body.status === 'pending', JSON.stringify(r.body));
  r = await call(tfd, 'POST', `/api/applications/${id}/evidence?condition=3`, { url: 'https://drive.google.com/file/d/cpo2/view', doc_no: 'ไม่ควรบันทึก', result: 'pass' });
  check('ครบ 3 เงื่อนไข → รอเปลี่ยนอัตรา Low', r.body.status === 'ready', JSON.stringify(r.body));
  check('เงื่อนไข 3 ไม่บันทึกเลขที่หนังสือ', (await call(tfd, 'GET', `/api/applications/${id}`)).body.attachments.filter((t) => t.condition_no === 3).every((t) => t.doc_no === null));
  const n = (await call(f1, 'GET', '/api/notifications')).body;
  check('แจ้งเตือน กฟส. เมื่อครบเงื่อนไข', n.items.some((x) => x.application_id === id && /ครบ 3/.test(x.message)));

  r = await call(reg, 'POST', `/api/applications/${id}/evidence?condition=4`, { url: 'https://drive.google.com/file/d/safety/view', doc_no: 'ไม่ควรบันทึก', doc_date: '2026-11-01', result: 'pass' });
  check('กบล. กฟข. บันทึกผลทดสอบความปลอดภัยในเขตตนได้', r.status === 201, JSON.stringify(r.body));
  check('เงื่อนไข 1 และผลทดสอบความปลอดภัยไม่บันทึกเลขที่/วันที่หนังสือ', (await call(f1, 'GET', `/api/applications/${id}`)).body.attachments
    .filter((t) => t.condition_no === 1 || t.condition_no === 4).every((t) => t.doc_no === null && t.doc_date === null));
  r = await call(tfd, 'POST', `/api/applications/${id}/evidence?condition=4`, { doc_no: 'x' });
  check('กทฟ. บันทึกผลทดสอบความปลอดภัยไม่ได้', r.status === 403);

  r = await call(f1, 'POST', `/api/invoices/${safetyInv.id}/payment`, { paid: false });
  check('ยกเลิกการชำระหลังครบเงื่อนไข → กลับเป็นรอเงื่อนไข', r.body.status === 'pending', JSON.stringify(r.body));
  r = await call(f1, 'POST', `/api/invoices/${safetyInv.id}/payment`, { paid: true });
  check('ติ๊กชำระอีกครั้ง → รอเปลี่ยนอัตรา Low', r.body.status === 'ready', JSON.stringify(r.body));

  r = await call(f1, 'POST', `/api/applications/${id}/low-rate`, { low_effective_date: '2026-12-01' });
  check('ยังไม่ติ๊กข้อตกลงแก้ไขสัญญาซื้อขายไฟฟ้า → ปิดงานไม่ได้', r.status === 400 && /ข้อตกลง/.test(r.body.error || ''), JSON.stringify(r.body));
  r = await call(f1, 'POST', `/api/applications/${id}/low-rate`, { contract_amended: true, low_effective_date: '2026-12-01' });
  d = (await call(f1, 'GET', `/api/applications/${id}`)).body;
  check('ติ๊กข้อตกลงแล้วบันทึกวันที่มีผลอัตรา Low → เสร็จสมบูรณ์', d.status === 'completed' && d.low_effective_date === '2026-12-01' && d.data.contract_amended?.done === true, d.status);
  check('ประวัติบันทึกการจัดทำข้อตกลงแก้ไขสัญญา', d.events.some((e) => /ข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้า/.test(e.detail || '')));
  const att = d.attachments.find((t) => t.condition_no === 2);
  r = await call(f1, 'DELETE', `/api/attachments/${att.id}`);
  check('ปิดงานแล้วลบหลักฐานไม่ได้', r.status === 403);

  // ขอบเขตการมองเห็น: รายการคำร้องเฉพาะพื้นที่ตนเอง (แม้ส่ง scope=all), ภาพรวมทั่วประเทศเป็นตัวเลข/หมุดไม่มีรายละเอียด
  const f2all = (await call(f2, 'GET', '/api/applications?scope=all')).body;
  check('รายการคำร้องของ กฟส. อื่นไม่มีคำร้องนอกพื้นที่ (แม้ส่ง scope=all)', !f2all.some((x) => x.id === id) && f2all.every((x) => x.office === 'กฟจ.ตราด'));
  const regList = (await call(reg, 'GET', '/api/applications?scope=all')).body;
  check('กบล. เห็นรายการคำร้องทั้งหมดในเขตตนเองเท่านั้น', regList.some((x) => x.id === id) && regList.every((x) => x.region === '1.กฟน.1'));
  const all = (await call(admin, 'GET', '/api/applications')).body;
  check('รายการคำร้องบอกผลทดสอบความปลอดภัย (ผ่าน)', all.find((x) => x.id === id)?.safety === 'pass', all.find((x) => x.id === id)?.safety);
  const [stAll, stMine, stAdmin] = [(await call(f2, 'GET', '/api/stats?scope=all')).body, (await call(f2, 'GET', '/api/stats')).body, (await call(admin, 'GET', '/api/stats')).body];
  check('ตัวเลขภาพรวมทั่วประเทศ (scope=all) เท่ากับของผู้ดูแลระบบ', stAll.total === stAdmin.total && stMine.total === f2all.length, `${stAll.total}/${stAdmin.total} ${stMine.total}/${f2all.length}`);
  const pinOther = (await call(f2, 'GET', '/api/map?scope=all')).body.find((x) => x.office === 'กฟจ.เชียงใหม่' && x.lat === form.lat);
  const pinMine = (await call(f1, 'GET', '/api/map?scope=all')).body.find((x) => x.id === id);
  check('หมุดแผนที่พื้นที่อื่นไม่มี id/ชื่อสถานี/ผู้ขอใช้ไฟฟ้า', pinOther && pinOther.mine === false && !('id' in pinOther) && !('station_name' in pinOther) && !('applicant_name' in pinOther), JSON.stringify(pinOther));
  check('หมุดแผนที่พื้นที่ตนเองมีรายละเอียดและ id', pinMine && pinMine.mine === true && pinMine.station_name === form.station_name);
  const f2csv = await xlsx(f2, '?scope=all');
  check('Excel ของ กฟส. อื่นไม่มีคำร้องนอกพื้นที่', f2csv.status === 200 && !f2csv.text.includes(d.app_no), f2csv.status);
  const xl = await xlsx(admin);
  check('Export Excel เป็นไฟล์ .xlsx มีคำร้องใหม่', xl.status === 200 && /\.xlsx/.test(decodeURIComponent(xl.name)) && xl.text.includes(d.app_no), `${xl.status} ${xl.type}`);
  check('Excel มีคอลัมน์ผลทดสอบความปลอดภัย และตรึงแถวหัวตาราง/ตัวกรอง', xl.text.split('\n')[0].includes('ผลทดสอบความปลอดภัย')
    && xl.ws.views[0]?.state === 'frozen' && !!xl.ws.autoFilter);
  const xrow = xl.ws.getRows(2, xl.ws.rowCount - 1).find((row) => row.getCell(1).value === d.app_no);
  check('Excel วันที่มีผลอัตรา Low เป็นเซลล์วันที่ และ กฟข. ไม่มีเลขนำหน้า', xrow && xrow.getCell(24).value instanceof Date && xrow.getCell(7).value === 'กฟน.1',
    xrow && `${xrow.getCell(24).value} ${xrow.getCell(7).value}`);
  // เอกสารหลักฐานที่เกี่ยวข้อง: ผู้ดูแลระบบจัดการ ทุกบทบาทดาวน์โหลดได้
  const docForm = (title) => { const fd = new FormData(); fd.append('file', pdf('doc'), 'แบบฟอร์มทดสอบ.pdf'); if (title) fd.append('title', title); fd.append('category', 'conditions'); return fd; };
  r = await call(f1, 'POST', '/api/documents', docForm('ไม่ควรเพิ่มได้'));
  check('กฟส. เพิ่มเอกสารหลักฐานไม่ได้ (เฉพาะผู้ดูแลระบบ)', r.status === 403, r.status);
  r = await call(admin, 'POST', '/api/documents', docForm(''));
  check('เพิ่มเอกสารโดยไม่ระบุชื่อ → ถูกปฏิเสธ', r.status === 400, JSON.stringify(r.body));
  r = await call(admin, 'POST', '/api/documents', docForm(`แบบฟอร์มทดสอบ ${stamp}`));
  const docId = r.body.id;
  check('ผู้ดูแลระบบเพิ่มเอกสารหลักฐานได้', r.status === 201 && docId, JSON.stringify(r.body));
  const docs = (await call(tfd, 'GET', '/api/documents')).body;
  const dl = await fetch(`${B}/api/documents/${docId}/file`, { headers: { cookie: f2 } });
  check('ทุกบทบาทเห็นรายการและดาวน์โหลดเอกสารได้', docs.some((x) => x.id === docId && x.category === 'conditions') && dl.status === 200
    && /attachment/.test(dl.headers.get('content-disposition') || ''), `${dl.status}`);
  r = await call(admin, 'PUT', `/api/documents/${docId}`, { title: 'แก้ชื่อแล้ว', category: 'contract' });
  const edited = (await call(admin, 'GET', '/api/documents')).body.find((x) => x.id === docId);
  check('แก้ไขชื่อ/หมวดเอกสารได้', r.status === 200 && edited.title === 'แก้ชื่อแล้ว' && edited.category === 'contract');
  r = await call(admin, 'DELETE', `/api/documents/${docId}`);
  const gone = await fetch(`${B}/api/documents/${docId}/file`, { headers: { cookie: admin } });
  check('ลบเอกสารแล้วดาวน์โหลดไม่ได้', r.status === 200 && gone.status === 404, gone.status);

  // ข้อ 8 ระบบ CPO: บังคับกรอก, dropdown PEA VOLTA / อื่นๆ, ชื่อย่อ CPO ในรายการ
  const mk = (extra) => multipart({ ...form, ca_no: `0400${stamp}${Math.random().toString().slice(2, 6)}`, meter_no: `67${stamp}${Math.random().toString().slice(2, 6)}`, ...extra }, { form_pdf: 'คำร้อง.pdf' });
  r = await call(f1, 'POST', '/api/applications', mk({ cpo: {} }));
  check('ไม่เลือกระบบ CPO (ข้อ 8) → ถูกปฏิเสธ', r.status === 400 && /ข้อ 8/.test(r.body.error || ''), JSON.stringify(r.body));
  r = await call(f1, 'POST', '/api/applications', mk({ cpo: { platform: 'other', system_name: 'X', provider: 'Y' } }));
  check('ระบบ CPO อื่นๆ ไม่ระบุชื่อย่อ CPO → ถูกปฏิเสธ', r.status === 400 && /ชื่อย่อ CPO/.test(r.body.error || ''), JSON.stringify(r.body));
  check('รายการคำร้องแสดงชื่อย่อ CPO (ตัวพิมพ์ใหญ่)', all.find((x) => x.id === id)?.cpo_short === 'TST', all.find((x) => x.id === id)?.cpo_short);
  r = await call(f1, 'POST', '/api/applications', mk({ station_name: `สถานี VOLTA ${stamp}`, cpo: { platform: 'volta', system_name: 'ไม่ควรใช้' } }));
  const vid = r.body.id;
  let vd = (await call(f1, 'GET', `/api/applications/${vid}`)).body;
  check('PEA VOLTA → ผ่านเงื่อนไข 3 ทันที, ชื่อย่อ VOLTA', r.status === 201 && vd.conditions.c3 && vd.conditions.c3_volta && vd.cpo_short === 'VOLTA' && vd.data.cpo.system_name === 'PEA VOLTA', JSON.stringify(vd.conditions));
  check('PEA VOLTA บันทึกประวัติการผ่านเงื่อนไข 3', vd.events.some((e) => /PEA VOLTA/.test(e.detail || '')));
  const tfdN = (await call(tfd, 'GET', '/api/notifications')).body;
  check('PEA VOLTA ไม่แจ้ง กทฟ. ให้ทดสอบ CPO', !tfdN.items.some((x) => x.application_id === vid));
  const miss3 = (await call(f1, 'GET', '/api/applications?missing=3')).body;
  check('ตัวกรอง "ขาดเงื่อนไข 3" ไม่รวมสถานี PEA VOLTA', !miss3.some((x) => x.id === vid));
  for (const t of ['safety', 'cpo']) await call(f1, 'POST', `/api/applications/${vid}/payment-exempt`, { type: t, exempt: true, reason: 'ทดสอบ' });
  for (const c of [1, 2]) r = await call(f1, 'POST', `/api/applications/${vid}/evidence?condition=${c}`, { url: 'https://drive.google.com/file/d/v/view', result: 'pass' });
  check('PEA VOLTA ครบเงื่อนไข 1–2 → รอเปลี่ยนอัตรา Low', r.body.status === 'ready', JSON.stringify(r.body));
  r = await call(tfd, 'POST', `/api/applications/${vid}/evidence?condition=3`, { url: 'https://drive.google.com/file/d/x/view' });
  check('PEA VOLTA ไม่ต้องบันทึกเงื่อนไข 3 (กทฟ. บันทึกไม่ได้)', r.status === 403, r.status);
  const vcsv = (await xlsx(admin)).text;
  check('Excel เงื่อนไข 3 ของ PEA VOLTA = ครบ (PEA VOLTA)', vcsv.split('\n').some((l) => l.includes(vd.app_no) && l.includes('ครบ (PEA VOLTA)')));
  r = await call(f1, 'PUT', `/api/applications/${vid}`, { ...form, station_name: vd.station_name, ca_no: vd.ca_no, meter_no: vd.meter_no,
    cpo: { platform: 'other', system_name: 'Other App', short: 'OTH', provider: 'บจ. อื่น' } });
  check('เปลี่ยนจาก PEA VOLTA เป็นระบบอื่น → กลับเป็นรอเงื่อนไข 3', r.status === 200 && r.body.status === 'pending', JSON.stringify(r.body));
  vd = (await call(f1, 'GET', `/api/applications/${vid}`)).body;
  check('เปลี่ยนระบบ CPO แล้วชื่อย่อ/เงื่อนไข 3 ตามระบบใหม่', vd.cpo_short === 'OTH' && !vd.conditions.c3, `${vd.cpo_short} ${vd.conditions.c3}`);

  const stats = (await call(admin, 'GET', '/api/stats')).body;
  check('สรุปสถิติตอบกลับได้', typeof stats.total === 'number' && stats.total >= 1);

  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} ผ่าน · คำร้องทดสอบ id ${id} (${d.app_no})`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('✗ หยุดกลางคัน:', err.message); process.exit(1); });
