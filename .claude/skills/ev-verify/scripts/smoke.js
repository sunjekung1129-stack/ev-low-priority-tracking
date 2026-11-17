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
const pdf = (text) => new Blob([`%PDF-1.4 ${text}`], { type: 'application/pdf' });
const stamp = Date.now().toString().slice(-6);
const form = {
  station_name: `สถานีทดสอบอัตโนมัติ ${stamp}`, applicant_name: 'บจ. ทดสอบ', company: 'TEST',
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
  check('กฟส. อื่นเปิดดูได้แต่เป็นแบบดูอย่างเดียว', r.status === 200 && r.body.permissions.in_area === false);
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
  r = await call(f1, 'POST', `/api/applications/${id}/invoices`, { type: 'cpo', request_no: reqNo, units: 1, unit_price: 2400 });
  check('เลขที่คำร้องซ้ำ → ถูกปฏิเสธ', r.status === 400);
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
  r = await call(f1, 'POST', `/api/applications/${id}/payment-exempt`, { type: 'cpo', exempt: true, reason: 'ทดสอบระบบ' });
  check('ระบุ "ไม่ต้องชำระค่าทดสอบ CPO" → ชำระครบ', r.status === 200 && r.body.payment.done, JSON.stringify(r.body));
  const tn = (await call(tfd, 'GET', '/api/notifications')).body;
  check('แจ้ง กทฟ. เมื่อชำระค่าทดสอบครบ', tn.items.some((x) => x.application_id === id && /ชำระเงินค่าทดสอบครบ/.test(x.message)));

  // ---- เงื่อนไข 3 ข้อ
  r = await call(f1, 'POST', `/api/applications/${id}/evidence?condition=1`, { url: 'https://drive.google.com/file/d/x/view', doc_no: 'ทดสอบ 1/2569', result: 'pass' });
  check('เงื่อนไข 1 (ลิงก์) บันทึกได้หลังชำระ', r.status === 201 && r.body.status === 'pending', JSON.stringify(r.body));
  const fd = new FormData(); fd.append('files', pdf('c2'), 'ผลตรวจการติดตั้ง.pdf'); fd.append('result', 'pass');
  r = await call(f1, 'POST', `/api/applications/${id}/attachments?condition=2`, fd);
  check('เงื่อนไข 2 (ไฟล์) อัปโหลดได้', r.status === 201, JSON.stringify(r.body));
  r = await call(f1, 'POST', `/api/applications/${id}/evidence?condition=3`, { doc_no: 'x' });
  check('กฟส. บันทึกเงื่อนไข 3 ไม่ได้ (เฉพาะ กทฟ.)', r.status === 403);
  r = await call(tfd, 'POST', `/api/applications/${id}/evidence?condition=3`, { doc_no: 'กทฟ. 1/2569', result: 'fail' });
  check('ผล "ไม่ผ่าน" ไม่นับว่าครบ', r.body.status === 'pending', JSON.stringify(r.body));
  r = await call(tfd, 'POST', `/api/applications/${id}/evidence?condition=3`, { doc_no: 'กทฟ. 2/2569', result: 'pass' });
  check('ครบ 3 เงื่อนไข → รอเปลี่ยนอัตรา Low', r.body.status === 'ready', JSON.stringify(r.body));
  const n = (await call(f1, 'GET', '/api/notifications')).body;
  check('แจ้งเตือน กฟส. เมื่อครบเงื่อนไข', n.items.some((x) => x.application_id === id && /ครบ 3/.test(x.message)));

  r = await call(reg, 'POST', `/api/applications/${id}/evidence?condition=4`, { doc_no: 'กบล. 1/2569', result: 'pass' });
  check('กบล. กฟข. บันทึกผลทดสอบความปลอดภัยในเขตตนได้', r.status === 201, JSON.stringify(r.body));
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

  const mine = (await call(f2, 'GET', '/api/applications')).body; const all = (await call(f2, 'GET', '/api/applications?scope=all')).body;
  check('ขอบเขต "พื้นที่ของฉัน / ทั้งหมด" ถูกต้อง', !mine.some((x) => x.id === id) && all.some((x) => x.id === id));
  check('รายการคำร้องบอกผลทดสอบความปลอดภัย (ผ่าน)', all.find((x) => x.id === id)?.safety === 'pass', all.find((x) => x.id === id)?.safety);
  const csv = await call(admin, 'GET', '/api/applications/export.csv?scope=all');
  check('ส่งออก CSV มีคำร้องใหม่', typeof csv.body === 'string' && csv.body.includes(d.app_no));
  check('CSV มีคอลัมน์ผลทดสอบความปลอดภัย', csv.body.includes('ผลทดสอบความปลอดภัย'));
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

  const stats = (await call(admin, 'GET', '/api/stats')).body;
  check('สรุปสถิติตอบกลับได้', typeof stats.total === 'number' && stats.total >= 1);

  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} ผ่าน · คำร้องทดสอบ id ${id} (${d.app_no})`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('✗ หยุดกลางคัน:', err.message); process.exit(1); });
