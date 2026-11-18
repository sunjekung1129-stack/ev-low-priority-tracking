'use strict';
/* EV Low Priority Tracking — client (vanilla JS SPA, hash routing) */

// ============================================================ constants (ตามแบบฟอร์มขอใช้ไฟฟ้า EV Low Priority)
const APP_TITLE = 'EV-LPTS · ระบบติดตามสถานะคำร้องขอใช้ไฟฟ้า EV Low Priority';
// ไอคอนตู้ชาร์จ (หน้าจอสายฟ้า แถบสถานะ ช่องเสียบ สายชาร์จ) ใช้บนพื้นทองของแบนเนอร์/หน้าเข้าสู่ระบบ
const CHARGER_MARK = `<svg viewBox="0 0 32 32" width="34" height="34"><path d="M18.6 11h2.2c1.6 0 2.8 1.2 2.8 2.8v6.4c0 1.3 1 2.3 2.3 2.3s2.3-1 2.3-2.3v-7.8" fill="none" stroke="#4a1663" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M27.2 7.2v-2M29.2 7.2v-2" stroke="#4a1663" stroke-width="1.2" stroke-linecap="round"/><rect x="25.9" y="6.9" width="4.6" height="5.6" rx="1.5" fill="#4a1663"/><rect x="27.1" y="8.3" width="2.2" height=".9" rx=".45" fill="#ffe58a"/><rect x="4.6" y="2.8" width="14.6" height="24.4" rx="3.6" fill="#4a1663"/><path d="M8.2 2.8h7.4a3.6 3.6 0 0 1 3.6 3.6v1.1H4.6V6.4a3.6 3.6 0 0 1 3.6-3.6z" fill="#6b2c91"/><rect x="6" y="8.4" width="1.5" height="16.6" rx=".75" fill="#fff" fill-opacity=".14"/><rect x="8" y="5.6" width="7.8" height="7.4" rx="1.6" fill="#ffe58a"/><path d="M12.7 6.7 10.2 10.1h1.8l-.6 2 2.6-3.5h-1.8z" fill="#4a1663"/><rect x="8" y="14.6" width="7.8" height="1.7" rx=".85" fill="#2d0a40"/><rect x="8" y="14.6" width="5.2" height="1.7" rx=".85" fill="#7ee2a8"/><circle cx="11.9" cy="20.9" r="2.6" fill="#2d0a40" stroke="#ffe58a" stroke-width=".9"/><circle cx="11.1" cy="20.4" r=".55" fill="#ffe58a"/><circle cx="12.7" cy="20.4" r=".55" fill="#ffe58a"/><circle cx="11.9" cy="21.8" r=".55" fill="#ffe58a"/><rect x="3" y="26.4" width="17.8" height="2.6" rx="1.3" fill="#2d0a40"/></svg>`;
const ROLE_LABEL = { field: 'กฟส.ในพื้นที่ใช้ไฟฟ้า', tfd: 'กองทดสอบอุปกรณ์ไฟฟ้า (กทฟ.)', region: 'กบล. กฟข.', admin: 'ผู้ดูแลระบบ' };
const canCreate = (u) => u.role === 'field' || u.role === 'admin';
const scopeLabel = (u) => (u.role === 'field' ? u.office : u.role === 'region' ? `กบล. ${regionLabel(u.office)}` : 'ทุกการไฟฟ้า');
const STATUS = {
  pending: { label: 'รอเงื่อนไข', icon: 'clock' },
  ready: { label: 'รอเปลี่ยนอัตรา Low', icon: 'zap' },
  completed: { label: 'เสร็จสมบูรณ์', long: 'เสร็จสมบูรณ์ (เปลี่ยนอัตรา Low ในระบบ SAP แล้ว)', icon: 'check' },
  cancelled: { label: 'ยกเลิก', icon: 'ban' },
};
const CONDITIONS = {
  0: { short: 'แบบฟอร์มคำร้อง', title: 'แบบฟอร์มคำร้องขอใช้ไฟฟ้า (PDF)', who: 'กฟส.ในพื้นที่ใช้ไฟฟ้า' },
  1: { short: 'ขึ้นทะเบียนเครื่องอัดประจุ', title: 'หลักฐานการขึ้นทะเบียนเครื่องอัดประจุไฟฟ้ากับ กฟภ.', who: 'กฟส.ในพื้นที่ใช้ไฟฟ้า' },
  2: { short: 'ตรวจมาตรฐานการติดตั้ง', title: 'ผลตรวจสอบมาตรฐานการติดตั้งระบบอัดประจุยานยนต์ไฟฟ้าก่อนติดตั้งมิเตอร์', who: 'กฟส.ในพื้นที่ใช้ไฟฟ้า' },
  3: { short: 'ทดสอบ CPO – PEA EVMS', title: 'ผลการทดสอบระบบปฏิบัติการโครงข่ายไฟฟ้า CPO กับ PEA EVMS', who: 'กองทดสอบอุปกรณ์ไฟฟ้า (กทฟ.)' },
  4: { short: 'ทดสอบความปลอดภัย', title: 'ผลการตรวจวัดทดสอบความปลอดภัย (IEC 60364-6 / IEC 61851)', who: 'กฟส.ในพื้นที่ใช้ไฟฟ้า / กบล. กฟข.' },
};
// สีหมุดบนแผนที่ (ใช้คู่กับคำอธิบายสถานะเสมอ)
const STATUS_COLOR = { pending: '#c77700', ready: '#1f5ad1', completed: '#0f8a57', cancelled: '#8a909b' };
const THAI_BOUNDS = [[5.6, 97.3], [20.5, 105.7]];
const APPLICANT_TYPES = [['juristic', 'นิติบุคคล'], ['person', 'บุคคลธรรมดา'], ['government', 'หน่วยงานราชการ/รัฐวิสาหกิจ']];
const LOCATIONS = ['สถานีบริการเชื้อเพลิงสำหรับรถยนต์', 'สถานีอัดประจุไฟฟ้าโดยเฉพาะ', 'ห้างสรรพสินค้า', 'โรงแรม', 'ร้านอาหาร',
  'ร้านค้า/ร้านสะดวกซื้อ', 'ธุรกิจให้เช่าที่จอดรถ', 'หมู่บ้านจัดสรร', 'อาคารชุด', 'ถนนสาธารณะ', 'อื่นๆ'];
const CRITERIA = [
  'สถานีอัดประจุไฟฟ้าให้บริการสำหรับบุคคลทั่วไป โดยไม่เจาะจงเฉพาะกลุ่มบุคคลใดกลุ่มบุคคลหนึ่ง',
  'จุดประสงค์ในการให้บริการ ไม่ได้มีเจตนาสำหรับกลุ่มธุรกิจใดธุรกิจหนึ่งโดยเฉพาะ รวมทั้งสามารถอัดประจุไฟฟ้าสำหรับยานยนต์ไฟฟ้า (EV) โดยไม่เจาะจงเฉพาะยี่ห้อใดยี่ห้อหนึ่ง',
  'สถานีอัดประจุไฟฟ้าอยู่ภายนอกอาคารซึ่งผู้ใช้บริการสามารถมองเห็นสถานีได้อย่างชัดเจน หรือมีป้ายบ่งชี้ว่ามีสถานีอัดประจุไฟฟ้าติดตั้งอยู่',
  'สถานีอัดประจุไฟฟ้ามีป้ายบ่งชี้ว่า “สถานีอัดประจุไฟฟ้าสาธารณะ”',
  'สถานีอัดประจุไฟฟ้าให้บริการโดยไม่ปิดกั้น (เช่น ผ่าน รปภ./ไม้กั้น/แลกบัตร เป็นต้น หากเป็นประเด็นเรื่องความปลอดภัย โดยถ้าอนุญาตให้เข้าใช้บริการ ถือว่าไม่ปิดกั้น)',
  'สถานีอัดประจุไฟฟ้าสามารถอัดประจุไฟฟ้าผ่านช่องทางใดช่องทางหนึ่ง',
  'สถานีอัดประจุไฟฟ้าต่อผ่านเครื่องวัดไฟฟ้าเครื่องเดียว (เป็นมิเตอร์ ไม่ต่อพ่วงกับโหลดอื่น)',
  'สถานีอัดประจุไฟฟ้ายอมรับเงื่อนไขตามโครงการ EV Low Priority (ปรับ - ลดโหลดได้)',
];
const CHANNEL_CRITERION = 5;
const CHANNELS = ['Application', 'QR Code', 'RFID', 'อื่นๆ'];
const REVENUE = [
  ['per_kwh', 'จำหน่ายพลังงานไฟฟ้าเป็นหน่วยไฟฟ้า (บาท/หน่วยไฟฟ้า)'],
  ['per_session', 'จำหน่ายพลังงานไฟฟ้าเป็นรายครั้ง (บาท/ครั้ง)'],
  ['parking', 'ค่าบริการที่จอดขณะให้บริการอัดประจุ (บาท/หน่วยเวลา)'],
  ['other', 'อื่นๆ'],
];
const DOC_GROUPS = [
  { title: 'กรณีการขอใช้ไฟฟ้าของนิติบุคคล', items: [
    ['j_cert', 'หนังสือรับรองการจดทะเบียนนิติบุคคลอายุไม่เกิน 6 เดือน'],
    ['j_id', 'บัตรประจำตัวประชาชนของผู้มีอำนาจกระทำการแทนนิติบุคคล'],
    ['j_pp20', 'ใบทะเบียนการค้าของกรมสรรพากร (ภ.พ. 20)'],
  ] },
  { title: 'กรณีหน่วยงานราชการ/รัฐวิสาหกิจ', items: [
    ['g_card', 'บัตรข้าราชการ/พนักงานองค์กรของรัฐ'],
    ['g_letter', 'หนังสือราชการ/เอกสารคำร้องการขอใช้ไฟฟ้าจากหน่วยงานราชการ/หน่วยงานรัฐวิสาหกิจ ที่ลงนามโดยผู้มีอำนาจของหน่วยงาน'],
  ] },
  { title: 'กรณีมอบอำนาจให้ดำเนินการขอใช้ไฟฟ้า', items: [
    ['p_letter', 'หนังสือมอบอำนาจและประทับตราสำคัญของนิติบุคคล (ถ้ามี)'],
    ['p_grantor', 'สำเนาบัตรประจำตัวประชาชนหรือสำเนาหนังสือเดินทาง (Passport) ของผู้มอบอำนาจ'],
    ['p_grantee', 'บัตรประจำตัวประชาชนหรือหนังสือเดินทาง (Passport) ของผู้รับมอบอำนาจ'],
  ] },
  { title: 'เอกสารด้านทั่วไป', items: [
    ['house_reg', 'ทะเบียนบ้านหรือทะเบียนอาคารของสถานที่ขอใช้ไฟฟ้า'],
    ['ownership', 'เอกสารหลักฐานแสดงกรรมสิทธิ์หรือสิทธิครอบครองสถานที่ใช้ไฟฟ้า เช่น สัญญาเช่า หรือหนังสือยินยอมให้ใช้ที่ดิน'],
  ] },
  { title: 'เอกสารด้านวิศวกรรม', items: [
    ['layout', 'แผนผังสถานีอัดประจุไฟฟ้า (Layout of EV Charging Station)'],
    ['sld', 'แผนภูมิระบบไฟฟ้า (Single Line Diagram) แสดงการเชื่อมต่อ Charger กับ CPO และ PEA EVMS ลงนามรับรองโดยวิศวกรไฟฟ้า'],
    ['load', 'ตารางโหลด (Load Schedule) และรายการคำนวณทางไฟฟ้า ลงนามรับรองโดยวิศวกรไฟฟ้า'],
    ['foundation', 'แบบแสดงการติดตั้งฐานรากและนั่งร้านหม้อแปลง ลงนามรับรองโดยวิศวกรโยธา'],
    ['equip_spec', 'ข้อมูลทางเทคนิคของอุปกรณ์อื่นๆ เช่น หม้อแปลงไฟฟ้า รีเลย์ป้องกัน เครื่องตัดไฟรั่ว เซอร์กิตเบรกเกอร์'],
    ['license', 'สำเนาใบอนุญาตประกอบวิชาชีพวิศวกรรมควบคุมที่เกี่ยวข้อง'],
    ['charger_spec', 'ข้อมูลทางเทคนิค (Specification) ของเครื่องอัดประจุไฟฟ้า'],
    ['charger_reg', 'เอกสารยืนยันเครื่องอัดประจุไฟฟ้าที่ขึ้นทะเบียนรายชื่อกับ กฟภ.'],
    ['erc_license', 'ใบอนุญาตประกอบกิจการจำหน่ายไฟฟ้า (หม้อแปลงรวมตั้งแต่ 1,000 kVA) หรือหลักฐานการยื่นขอต่อสำนักงาน กกพ.'],
    ['erc_exempt', 'หนังสือรับแจ้งยกเว้นการประกอบกิจการพลังงาน (หม้อแปลงรวมไม่เกิน 1,000 kVA) หรือหลักฐานการยื่นขอจดแจ้งยกเว้นต่อสำนักงาน กกพ.'],
    ['ess', 'ข้อมูลทางเทคนิคของระบบกักเก็บพลังงานไฟฟ้า (Energy Storage System) หรือเครื่องกำเนิดไฟฟ้าอื่นๆ (ถ้ามี)'],
    ['pdf_set', 'เอกสารประกอบการยื่นขอใช้ไฟฟ้าในรูปแบบ PDF บันทึกลง Flash Drive หรือพื้นที่เก็บข้อมูลออนไลน์ 1 ชุด'],
  ] },
];
const TEST_60364 = [
  ['pea', 'ประสงค์ให้ กฟภ. เป็นผู้ดำเนินการ'],
  ['third_party', 'ผู้ขอใช้ไฟฟ้าจัดหาหน่วยงาน/บุคคลภายนอก ที่ขึ้นทะเบียนกับ กฟภ. เป็นผู้ดำเนินการ'],
];
const TEST_61851 = [
  ['registered', 'ไม่ประสงค์ดำเนินการ เนื่องจากเครื่องอัดประจุไฟฟ้าได้ขึ้นทะเบียนรายชื่อกับ กฟภ. แล้ว'],
  ['pea', 'ประสงค์ให้ กฟภ. เป็นผู้ดำเนินการ'],
];

// ============================================================ icons (stroke, 24px grid)
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  doc: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h4"/>',
  badge: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="M12 8v4M12 16h.01"/>',
  flask: '<path d="M9 3h6M10 3v6L4 20a1 1 0 0 0 .9 1.5h14.2A1 1 0 0 0 20 20l-6-11V3"/><path d="M7 15h10"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
};
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ============================================================ utils
const state = { user: null, lookups: { offices: [], regions: [], provinces: [] }, filter: { status: '', q: '', office: '', region: '', missing: '', scope: 'mine' } };
// กฟส./กบล. มี "พื้นที่ของตนเอง" — ดูทั้งหมดได้ แต่เริ่มต้นที่พื้นที่ของตน
const hasArea = (u) => u.role === 'field' || u.role === 'region';
const showingAll = (u) => !hasArea(u) || state.filter.scope === 'all';
const areaLabel = (u) => (showingAll(u) ? 'ทุกการไฟฟ้า' : scopeLabel(u));
const scopeToggle = (u) => (hasArea(u) ? `<div class="seg scope-seg" role="group" aria-label="ขอบเขตข้อมูล">
  <button data-scope="mine" class="${state.filter.scope !== 'all' ? 'on' : ''}">${icon('pin', 'i-sm')}พื้นที่ของฉัน</button>
  <button data-scope="all" class="${state.filter.scope === 'all' ? 'on' : ''}">${icon('map', 'i-sm')}ทั้งหมด</button></div>` : '');
function bindScopeToggle(rerender) {
  $$('[data-scope]').forEach((b) => b.addEventListener('click', () => {
    if (state.filter.scope === b.dataset.scope) return;
    Object.assign(state.filter, { scope: b.dataset.scope, office: '', region: '' });
    rerender();
  }));
}
const officeOptions = (offices, selected, regionFilter) => {
  const list = regionFilter ? offices.filter((o) => o.region === regionFilter) : offices;
  const groups = [...new Set(list.map((o) => o.region))];
  return groups.map((g) => `<optgroup label="${esc(regionLabel(g))}">${list.filter((o) => o.region === g).map((o) =>
    `<option value="${esc(o.name)}" ${o.name === selected ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</optgroup>`).join('');
};
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lookup = (pairs, key) => (pairs.find(([k]) => k === key) || [])[1] || '';
const regionLabel = (r) => String(r || '').replace(/^\d+\./, '');
const initials = (company, station) => {
  const c = String(company || '').trim();
  if (c) return esc(c.length <= 4 ? c.toUpperCase() : c.slice(0, 2).toUpperCase());
  return esc(String(station || '?').trim().slice(0, 1).toUpperCase());
};

const toDate = (s) => (s ? new Date(s.length === 10 ? `${s}T00:00:00` : s.replace(' ', 'T')) : null);
function fmtDate(s) {
  const d = toDate(s);
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';
}
function fmtDateTime(s) {
  const d = toDate(s);
  if (!d || Number.isNaN(d.getTime())) return '–';
  if (/ 00:00:00$/.test(s)) return fmtDate(s);
  return `${fmtDate(s)} · ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
}
const fmtNum = (n) => (n == null || n === '' ? '–' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 }));
const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const daysBetween = (from, to) => {
  const a = toDate(from); const b = to ? toDate(to) : new Date();
  return a ? Math.max(0, Math.round((b - a) / 86400000)) : 0;
};
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// long = ข้อความเต็ม เช่น "เสร็จสมบูรณ์ (เปลี่ยนอัตรา Low ในระบบ SAP แล้ว)"
const statusPill = (s, long = false) => `<span class="pill st-${esc(s)}">${icon(STATUS[s]?.icon || 'info')}${esc((long && STATUS[s]?.long) || STATUS[s]?.label || s)}</span>`;
// ผลทดสอบความปลอดภัย (ข้อมูลประกอบ) ในรายการคำร้อง
const safetyCell = (v) => (v === 'pass' || v === 'fail' ? resultPill(v)
  : v === 'recorded' ? `<span class="tag">${icon('file', 'i-sm')}บันทึกแล้ว</span>` : '<span class="faint small">ยังไม่มีผล</span>');
const resultPill = (r) => (r === 'pass' ? `<span class="pill st-pass">${icon('check')}ผ่าน</span>`
  : r === 'fail' ? `<span class="pill st-fail">${icon('x')}ไม่ผ่าน</span>` : '');
const condProgress = (r) => {
  const n = [r.c1, r.c2, r.c3].filter(Boolean).length;
  return `<span class="cprog" title="${[1, 2, 3].map((k) => `เงื่อนไข ${k} ${CONDITIONS[k].short}: ${r[`c${k}`] ? 'ครบ' : 'ยังไม่ครบ'}`).join('\n')}">
    <span class="bars">${[1, 2, 3].map((k) => `<i class="${r[`c${k}`] ? 'on' : ''}"></i>`).join('')}</span><span class="lbl">${n}/3</span></span>`;
};
// เปิดลิงก์ดาวน์โหลดของ API (ในเว็บเดโม GitHub Pages ใช้ window.demoOpen แทน)
const openUrl = (url) => (window.demoOpen ? window.demoOpen(url) : (location.href = url));
const linkLabel = (url) => {
  try {
    const h = new URL(url).hostname;
    if (h.includes('drive.google')) return 'เอกสาร Google Drive';
    if (h.includes('docs.google')) return 'เอกสาร Google Docs';
    return h;
  } catch { return 'ลิงก์เอกสาร'; }
};

async function api(method, url, body) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(url, opt);
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (res.status === 401 && url !== '/api/login') {
    state.user = null;
    location.hash = '#/login';
    throw new Error(data?.error || 'กรุณาเข้าสู่ระบบ');
  }
  if (!res.ok) throw new Error(data?.error || `เกิดข้อผิดพลาด (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.innerHTML = `${icon(isError ? 'alert' : 'checkCircle')}<span>${esc(msg)}</span>`;
  t.className = `toast${isError ? ' error' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3200);
}

function openDialog(html, onSubmit) {
  const dlg = $('#dialog');
  dlg.innerHTML = `<form method="dialog">${html}<div class="alert alert-danger dlg-error" hidden></div></form>`;
  const form = $('form', dlg);
  form.addEventListener('submit', async (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      await onSubmit(new FormData(form), form);
      dlg.close();
    } catch (err) {
      const box = $('.dlg-error', form); box.textContent = err.message; box.hidden = false;
    } finally { if (btn) btn.disabled = false; }
  });
  dlg.showModal();
  return form;
}
const dlgActions = (okLabel, okClass = 'btn-primary') =>
  `<div class="dlg-actions"><button class="btn" value="cancel" formnovalidate>ยกเลิก</button><button class="btn ${okClass}" value="ok">${esc(okLabel)}</button></div>`;

// ============================================================ shell / router
const view = () => $('#app');

function renderShell() {
  const u = state.user;
  $('#shell').hidden = !u;
  $('#loginRoot').innerHTML = '';
  if (!u) return;
  const links = [['#/', 'map', 'ภาพรวมและแผนที่'], ['#/list', 'grid', 'รายการคำร้อง']];
  if (canCreate(u)) links.push(['#/new', 'plus', 'รับคำร้องใหม่']);
  links.push(['#/docs', 'folder', 'เอกสารหลักฐานที่เกี่ยวข้อง']);
  if (u.role === 'admin') {
    links.push(['#/users', 'users', 'ผู้ใช้งาน'], ['#/offices', 'building', 'การไฟฟ้า (กฟส.)'], ['#/google', 'cloud', 'เชื่อมต่อ Google']);
  }
  $('#mainnav').innerHTML = `<div class="nav-label">เมนู</div>${links.map(([h, ic, t]) =>
    `<a href="${h}" data-href="${h}">${icon(ic)}<span>${esc(t)}</span>${h === '#/list' ? '<span class="count" id="navCount" hidden></span>' : ''}</a>`).join('')}`;
  $('#userCard').innerHTML = `<span class="avatar round">${icon('user', 'i-sm')}</span>
    <div class="who"><strong>${esc(u.display_name)}</strong><span>${esc(u.role === 'field' || u.role === 'region' ? scopeLabel(u) : ROLE_LABEL[u.role])}</span></div>`;
  $('[data-action=change-password]').innerHTML = `${icon('key', 'i-sm')}เปลี่ยนรหัสผ่าน`;
  $('[data-action=logout]').innerHTML = `${icon('logout', 'i-sm')}ออกจากระบบ`;
  $('#menuBtn').innerHTML = icon('menu');
  requestAnimationFrame(() => fitSidebar(true));
  $('#notifBtn').innerHTML = icon('bell');
}

function setCrumbs(items) {
  $('#crumbs').innerHTML = items.map(([label, href], i) => (i === items.length - 1
    ? `<span class="cur">${esc(label)}</span>`
    : `<a href="${href}">${esc(label)}</a><span class="sep">/</span>`)).join('');
}

function setActiveNav(hash) {
  $$('#mainnav a').forEach((a) => a.classList.toggle('active', a.dataset.href === hash));
}

async function loadLookups() {
  state.lookups = await api('GET', '/api/lookups');
}

// ป้องกันหน้าที่โหลดช้ากว่าเขียนทับหน้าปัจจุบันเมื่อผู้ใช้เปลี่ยนหน้าเร็วๆ
let routeSeq = 0;
const isStale = (seq) => seq !== routeSeq;
const isOpenStatus = (s) => s === 'pending' || s === 'ready';

async function route() {
  routeSeq++;
  const hash = location.hash || '#/';
  if (!state.user && hash !== '#/login') {
    try {
      state.user = (await api('GET', '/api/me')).user;
      renderShell(); startNotifPolling();
    } catch { return; }
  }
  if (state.user && hash === '#/login') { location.hash = '#/'; return; }
  closePopovers();
  $('#shell').classList.remove('nav-open');
  if (state.map) { state.map.remove(); state.map = null; }
  window.scrollTo(0, 0);
  let m;
  try {
    if (hash === '#/login') renderLogin();
    else if (hash === '#/' || hash === '#') { setActiveNav('#/'); await renderMap(); }
    else if (hash === '#/list') { setActiveNav('#/list'); await renderDashboard(); }
    else if (hash === '#/new') { setActiveNav('#/new'); await renderForm(null); }
    else if ((m = hash.match(/^#\/app\/(\d+)\/edit$/))) { setActiveNav(''); await renderForm(Number(m[1])); }
    else if ((m = hash.match(/^#\/app\/(\d+)$/))) { setActiveNav(''); await renderDetail(Number(m[1])); }
    else if (hash === '#/docs') { setActiveNav('#/docs'); await renderDocuments(); }
    else if (hash === '#/users') { setActiveNav('#/users'); await renderUsers(); }
    else if (hash === '#/offices') { setActiveNav('#/offices'); await renderOffices(); }
    else if (hash === '#/google') { setActiveNav('#/google'); await renderGoogle(); }
    else view().innerHTML = `<div class="empty">${icon('inbox')}<div>ไม่พบหน้าที่ต้องการ</div></div>`;
    if (state.user) refreshSideStats(); // ตัวเลขในแถบซ้ายตามทันหลังเปลี่ยนหน้า/บันทึกข้อมูล
  } catch (err) {
    view().innerHTML = `<div class="card card-pad" style="margin-top:16px"><div class="alert alert-danger">${icon('alert')}${esc(err.message)}</div>
      <p style="margin-top:14px"><a class="btn" href="#/list">กลับรายการคำร้อง</a></p></div>`;
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('scroll', () => $('.appbar')?.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
// แถบซ้ายสูงพอดีพื้นที่ใต้แบนเนอร์เสมอ (ตอนอยู่บนสุดแบนเนอร์กินพื้นที่ด้านบน — ไม่ให้ส่วนท้ายตกขอบจอ)
// measure = true: วัดที่ความสูงน้อยสุด (อยู่บนสุดของหน้า) ว่าเนื้อหาล้นไหม แล้วย่อเท่าที่จำเป็น — ไม่เปลี่ยนระหว่างเลื่อนหน้าเพื่อไม่ให้กระตุก
function fitSidebar(measure = false) {
  const sb = $('#sidebar'); const tb = $('.topbanner');
  if (!sb || !tb) return;
  if (matchMedia('(max-width: 960px)').matches) { sb.style.height = ''; sb.classList.remove('sb-tight', 'sb-tighter'); return; } // มือถือ: เมนูเลื่อนออกเต็มจอ
  if (measure === true) {
    sb.style.height = `${window.innerHeight - tb.offsetHeight}px`;
    sb.classList.remove('sb-tight', 'sb-tighter');
    if (sb.scrollHeight > sb.clientHeight + 1) sb.classList.add('sb-tight');
    if (sb.scrollHeight > sb.clientHeight + 1) sb.classList.add('sb-tighter');
  }
  sb.style.height = `${Math.round(window.innerHeight - Math.max(0, tb.getBoundingClientRect().bottom))}px`;
}
window.addEventListener('scroll', () => fitSidebar(), { passive: true });
window.addEventListener('resize', () => fitSidebar(true));

// ============================================================ login
function renderLogin() {
  $('#shell').hidden = true;
  $('#loginRoot').innerHTML = `
  <div class="login">
    <section class="login-art">
      <svg class="la-circuit" viewBox="0 0 600 900" preserveAspectRatio="xMaxYMax slice" fill="none" stroke="#ffd666" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">
        <path d="M600 120H470l-30 30H330l-24 24h-90" stroke-opacity=".35"/><path d="M600 210H520l-26 26H400" stroke-opacity=".25"/>
        <path d="M600 640H500l-34-34H360l-28 28H240" stroke-opacity=".3"/><path d="M600 720H540l-22 22H430l-18-18H330" stroke-opacity=".22"/>
        <path d="M470 120V60M400 236v60M466 606v-60M412 724v70" stroke-opacity=".22"/>
        <g fill="#ffd666" stroke="none" fill-opacity=".55"><circle cx="440" cy="150" r="4"/><circle cx="306" cy="174" r="4"/><circle cx="494" cy="236" r="4"/>
          <circle cx="466" cy="606" r="4"/><circle cx="332" cy="634" r="4"/><circle cx="518" cy="742" r="4"/><circle cx="412" cy="724" r="4"/></g>
      </svg>
      <svg class="la-bolt" viewBox="0 0 32 32" aria-hidden="true"><path d="M18 2 6 18h8l-2 12 14-17h-8z" fill="#fff"/></svg>

      <header class="la-brand">
        <span class="tb-mark" aria-hidden="true">${CHARGER_MARK}</span>
        <span class="la-brand-text">
          <span class="tb-en" lang="en">EV Low Priority Tracking System <span class="tb-code">EV-LPTS</span></span>
          <span class="tb-th">ระบบติดตามสถานะคำร้องขอใช้ไฟฟ้า EV Low Priority</span>
        </span>
      </header>

      <div class="la-hero">
        <span class="la-kicker">การไฟฟ้าส่วนภูมิภาค · Provincial Electricity Authority</span>
        <h2>ติดตามทุกคำร้อง<br>ตั้งแต่รับคำร้องจนได้<br><span class="la-gold">อัตรา Low Priority</span></h2>
        <p>กฟส.ในพื้นที่ใช้ไฟฟ้า กบล. กฟข. และ กทฟ. ทำงานบนข้อมูลชุดเดียวกัน เห็นสถานะทุกขั้นตอน และได้รับแจ้งเตือนเมื่อถึงคิวของตน</p>
        <ol class="la-steps">
          <li><b>1</b><span><strong>รับคำร้องขอใช้ไฟฟ้า</strong><small>CA · Meter No. · PDF แบบฟอร์มคำร้อง</small></span></li>
          <li><b>2</b><span><strong>ชำระค่าทดสอบ</strong><small>ค่าทดสอบความปลอดภัย · ค่าทดสอบ CPO</small></span></li>
          <li><b>3</b><span><strong>ตรวจเงื่อนไข 3 ข้อ</strong><small>ขึ้นทะเบียนเครื่องอัดประจุ · ตรวจการติดตั้ง · ทดสอบ CPO–PEA EVMS</small></span></li>
          <li><b>4</b><span><strong>ข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้า</strong><small>จัดทำก่อนเปลี่ยนอัตรา</small></span></li>
          <li><b>${icon('zap', 'i-sm')}</b><span><strong>เปลี่ยนอัตรา Low ในระบบ SAP</strong><small>บันทึกวันที่มีผล · เสร็จสมบูรณ์</small></span></li>
        </ol>
      </div>

      <footer class="la-foot"><span>© การไฟฟ้าส่วนภูมิภาค</span>
        <span class="la-roles"><i>กฟส.</i><i>กบล. กฟข.</i><i>กทฟ.</i></span></footer>
    </section>

    <section class="login-form">
      <form id="loginForm" class="login-card">
        <span class="lc-mark" aria-hidden="true">${icon('key')}</span>
        <div><h1>เข้าสู่ระบบ</h1><p class="muted">ยินดีต้อนรับสู่ EV-LPTS · ใช้บัญชีที่ผู้ดูแลระบบกำหนดให้</p></div>
        <label class="field"><span>ชื่อผู้ใช้</span>
          <div class="input-icon">${icon('user')}<input type="text" name="username" autocomplete="username" required autofocus placeholder="ชื่อผู้ใช้"></div></label>
        <label class="field"><span>รหัสผ่าน</span>
          <div class="input-icon pw-wrap">${icon('key')}<input type="password" name="password" autocomplete="current-password" required placeholder="รหัสผ่าน">
            <button type="button" class="pw-toggle" id="pwToggle" aria-label="แสดงรหัสผ่าน" aria-pressed="false">แสดง</button></div></label>
        <div class="alert alert-danger" id="loginErr" hidden></div>
        <button class="btn btn-primary lc-submit">เข้าสู่ระบบ<span aria-hidden="true">→</span></button>
        <p class="lc-help">ลืมรหัสผ่านหรือยังไม่มีบัญชี ติดต่อผู้ดูแลระบบของหน่วยงาน</p>
        <div class="demo">บัญชีทดลอง · รหัสผ่าน <code>pea1234</code><br>
          <code>field1</code> กฟจ.เชียงใหม่ · <code>field2</code> กฟจ.ชลบุรี · <code>tfd1</code> กทฟ. · <code>region1</code> กบล. กฟน.1<br>
          ผู้ดูแลระบบ <code>admin</code> / <code>admin1234</code></div>
      </form>
    </section>
  </div>`;
  $('#pwToggle').addEventListener('click', (e) => {
    const input = $('#loginForm [name=password]'); const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'ซ่อน' : 'แสดง';
    e.currentTarget.setAttribute('aria-pressed', String(show));
    e.currentTarget.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
  });
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const { user } = await api('POST', '/api/login', { username: f.get('username'), password: f.get('password') });
      state.user = user;
      renderShell();
      startNotifPolling();
      if (location.hash === '#/') route(); else location.hash = '#/';
    } catch (err) {
      $('#loginErr').innerHTML = `${icon('alert')}${esc(err.message)}`; $('#loginErr').hidden = false;
    }
  });
}

// ============================================================ map (หน้าแรก)
// 4 ช่องสรุปตามสถานะ (กดเพื่อเปิดรายการคำร้องตามสถานะ)
function statusKpis(stats, u) {
  const kpis = [
    ['', 'คำร้องทั้งหมด', stats.total, 'list', 'brand', esc(areaLabel(u))],
    ['pending', 'รอเงื่อนไข', stats.pending, 'clock', 'pending',
      stats.pending ? `ค้างชำระ ${stats.missing.payment} · ① ${stats.missing[1]} · ② ${stats.missing[2]} · ③ ${stats.missing[3]}` : 'ไม่มีงานค้าง'],
    ['ready', 'รอเปลี่ยนอัตรา Low (SAP)', stats.ready, 'zap', 'ready', 'ครบ 3 เงื่อนไขแล้ว'],
    ['completed', STATUS.completed.long, stats.completed, 'checkCircle', 'done',
      stats.avg_days_to_complete != null ? `เฉลี่ย ${fmtNum(stats.avg_days_to_complete)} วัน ตั้งแต่ยื่นคำร้อง` : ''],
  ];
  return `<div class="kpis">${kpis.map(([k, label, n, ic, tone, sub]) => `
      <button class="kpi" data-status="${k}">
        <div class="kpi-top"><span class="kpi-label">${esc(label)}</span><span class="kpi-ico ${tone}">${icon(ic)}</span></div>
        <div class="kpi-value">${fmtNum(n)}</div>
        <div class="kpi-sub">${sub}</div>
      </button>`).join('')}
    </div>`;
}
// แถบความคืบหน้าทั้งหมด (ไม่นับคำร้องที่ยกเลิก) — กดคำอธิบายเพื่อกรองตามสถานะ
function progressCard(stats) {
  const live = stats.total - stats.cancelled;
  const pct = (n) => (live ? Math.round((n / live) * 100) : 0);
  const parts = [['completed', stats.completed], ['ready', stats.ready], ['pending', stats.pending]];
  return `<div class="ov-progress card card-pad">
      <div class="ov-progress-head"><strong>ความคืบหน้าทั้งหมด</strong>
        <span class="muted small">ได้อัตรา Low แล้ว <b>${pct(stats.completed)}%</b> จาก ${fmtNum(live)} คำร้อง${stats.cancelled ? ` (ไม่รวมที่ยกเลิก ${fmtNum(stats.cancelled)})` : ''}</span></div>
      <div class="ov-stack" role="img" aria-label="${parts.map(([k, n]) => `${STATUS[k].label} ${n}`).join(' ')}">
        ${parts.filter(([, n]) => n).map(([k, n]) => `<i class="seg-${k}" style="flex:${n}" title="${esc(STATUS[k].long || STATUS[k].label)} ${fmtNum(n)} รายการ (${pct(n)}%)"></i>`).join('')
          || '<i class="seg-empty" style="flex:1"></i>'}
      </div>
      <div class="ov-legend">${parts.map(([k, n]) => `
        <button type="button" data-status="${k}">${icon(STATUS[k].icon, 'i-sm')}<i class="lg-sq seg-${k}"></i>${esc(STATUS[k].long || STATUS[k].label)} <b>${fmtNum(n)}</b> <span class="faint">(${pct(n)}%)</span></button>`).join('')}
      </div>
    </div>`;
}

// ============================================================ ภาพรวม (หน้าแรก): 4 ช่องสรุป + แผนที่สถานี
async function renderMap() {
  const u = state.user;
  const seq = routeSeq;
  const [rows, stats] = await Promise.all([api('GET', `/api/applications?scope=${state.filter.scope}`),
    api('GET', `/api/stats?scope=${state.filter.scope}`)]);
  if (isStale(seq)) return;
  setCrumbs([['ภาพรวม', '#/']]);

  const located = rows.filter((r) => r.lat != null && r.lng != null);
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, located.filter((r) => r.status === k).length]));
  const hidden = new Set(state.mapHidden || []);

  view().innerHTML = `
    <div class="page-head">
      <div><h1>ภาพรวมสถานีอัดประจุไฟฟ้า EV Low Priority</h1>
        <p>${esc(areaLabel(u))} · ข้อมูล ณ ${fmtDate(todayISO())}</p></div>
      <div class="row">${scopeToggle(u)}
      ${canCreate(u) ? `<a class="btn btn-primary" href="#/new">${icon('plus')}รับคำร้องใหม่</a>` : ''}</div>
    </div>

    ${statusKpis(stats, u)}

    <section class="card ov-map">
      <div class="card-head"><h2>${icon('map')}แผนที่สถานี</h2>
        <span class="muted small">${fmtNum(located.length)} สถานีที่มีพิกัด${rows.length > located.length
          ? ` · <a href="#/list">ไม่มีพิกัด ${fmtNum(rows.length - located.length)} รายการ</a>` : ''}</span></div>
      <div class="map-legend card-pad" role="group" aria-label="แสดงตามสถานะ">
        ${Object.entries(STATUS).map(([k, s]) => `<button class="lg-item ${hidden.has(k) ? 'off' : ''}" data-st="${k}" aria-pressed="${!hidden.has(k)}">
          <span class="lg-dot" style="background:${STATUS_COLOR[k]}"></span>${esc(s.long || s.label)}<span class="n">${fmtNum(counts[k])}</span></button>`).join('')}
        <span class="hint">กดที่สถานะเพื่อซ่อน/แสดงหมุด</span>
      </div>
      <div class="map-wrap">
        <div id="map" class="map" role="application" aria-label="แผนที่ประเทศไทยแสดงตำแหน่งสถานีอัดประจุไฟฟ้า"></div>
        <aside class="map-side">
          <div class="map-side-head"><div class="input-icon">${icon('search')}<input type="search" id="mapQ" placeholder="ค้นหาสถานี / จังหวัด"></div></div>
          <ul class="map-list" id="mapList"></ul>
        </aside>
      </div>
    </section>`;

  bindScopeToggle(() => route());
  // กดช่องสรุป → ไปหน้ารายการคำร้องตามสถานะ (คงขอบเขตที่ดูอยู่)
  $$('.kpi[data-status]').forEach((b) => b.addEventListener('click', () => {
    Object.assign(state.filter, { status: b.dataset.status, missing: '', office: '', region: '', q: '' });
    location.hash = '#/list';
  }));

  $$('.lg-item').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.st;
    if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
    state.mapHidden = [...hidden];
    b.classList.toggle('off', hidden.has(k));
    b.setAttribute('aria-pressed', String(!hidden.has(k)));
    draw();
  }));

  if (typeof L === 'undefined') {
    $('#map').innerHTML = `<div class="empty">${icon('alert')}<div>โหลดแผนที่ไม่ได้ (ต้องเชื่อมต่ออินเทอร์เน็ต)</div></div>`;
  }
  const map = typeof L !== 'undefined' ? L.map('map', { zoomControl: true, minZoom: 5, maxBounds: [[0, 90], [26, 112]] }) : null;
  state.map = map;
  if (map) {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.fitBounds(THAI_BOUNDS);
  }
  const layer = map ? L.layerGroup().addTo(map) : null;
  const markers = new Map();

  const popupHtml = (r) => `<div class="pop">
    <div class="pop-t">${esc(r.station_name)}</div>
    <div class="pop-s">${esc(r.applicant_name || '')}</div>
    <div class="pop-row">${statusPill(r.status)}${condProgress(r)}</div>
    <div class="pop-s">${esc([r.office, regionLabel(r.region), r.province].filter(Boolean).join(' · '))}</div>
    ${r.low_effective_date ? `<div class="pop-s">อัตรา Low มีผล ${fmtDate(r.low_effective_date)}</div>` : ''}
    <a class="btn btn-sm btn-primary" href="#/app/${r.id}">เปิดคำร้อง</a></div>`;

  function draw() {
    const q = ($('#mapQ').value || '').trim().toLowerCase();
    const visible = located.filter((r) => !hidden.has(r.status)
      && (!q || [r.station_name, r.province, r.office, r.company, r.app_no].join(' ').toLowerCase().includes(q)));
    if (layer) {
      layer.clearLayers();
      markers.clear();
      for (const r of visible) {
        const m = L.circleMarker([r.lat, r.lng], {
          radius: 7, color: '#ffffff', weight: 2, fillColor: STATUS_COLOR[r.status], fillOpacity: 1,
        }).bindTooltip(`<strong>${esc(r.station_name)}</strong><br>${esc(STATUS[r.status].label)}`, { direction: 'top', offset: [0, -6] })
          .bindPopup(popupHtml(r), { minWidth: 240 });
        m.addTo(layer);
        markers.set(r.id, m);
      }
    }
    $('#mapList').innerHTML = visible.length ? visible.map((r) => `<li><button data-id="${r.id}">
        <span class="lg-dot" style="background:${STATUS_COLOR[r.status]}" title="${esc(STATUS[r.status].label)}"></span>
        <span class="ml-main"><span class="ml-t">${esc(r.station_name)}</span><span class="ml-s">${esc([r.office, r.province].filter(Boolean).join(' · '))} · ${esc(STATUS[r.status].label)}</span></span>
      </button></li>`).join('') : `<li class="empty small">ไม่พบสถานี</li>`;
    $$('#mapList button').forEach((b) => b.addEventListener('click', () => {
      const r = located.find((x) => x.id === Number(b.dataset.id));
      const m = markers.get(r.id);
      if (map && m) { map.flyTo([r.lat, r.lng], Math.max(map.getZoom(), 12), { duration: 0.6 }); setTimeout(() => m.openPopup(), 650); }
    }));
  }
  let deb;
  $('#mapQ').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(draw, 200); });
  draw();
  if (map && located.length) {
    map.fitBounds(L.latLngBounds(located.map((r) => [r.lat, r.lng])), { padding: [40, 40], maxZoom: 9 });
  }
}

// ============================================================ dashboard (รายการคำร้อง)
async function renderDashboard() {
  const u = state.user;
  const seq = routeSeq;
  const f = state.filter;
  // งานที่ต้องทำ (callout) นับเฉพาะพื้นที่ของตนเองเสมอ แม้จะเลือกดูทั้งหมด
  const [stats, mine] = await Promise.all([api('GET', `/api/stats?scope=${f.scope}`),
    hasArea(u) && f.scope === 'all' ? api('GET', '/api/stats') : null, loadLookups()]);
  if (isStale(seq)) return;
  setCrumbs([['รายการคำร้อง', '#/list']]);
  const my = mine || stats;
  const navCount = $('#navCount');
  if (navCount) { navCount.textContent = my.ready; navCount.hidden = !(canCreate(u) && my.ready); }

  let callout = '';
  if (canCreate(u) && my.ready > 0) {
    callout = `<div class="callout"><span class="ico">${icon('zap', 'i-lg')}</span>
      <div class="txt"><strong>${my.ready} คำร้องครบเงื่อนไขแล้ว รอเปลี่ยนอัตรา Low ในระบบ SAP</strong>
      <span>เปลี่ยนอัตราใน SAP แล้วบันทึกวันที่มีผลอัตรา Low เพื่อปิดงาน</span></div>
      <button class="btn btn-sm" data-goto="mine" data-status="ready">ดูรายการ</button></div>`;
  } else if (hasArea(u) && my.safety_pending > 0) {
    callout = `<div class="callout warn"><span class="ico">${icon('flask', 'i-lg')}</span>
      <div class="txt"><strong>${my.safety_pending} คำร้องในพื้นที่ของคุณยังไม่มีผลการตรวจวัดทดสอบความปลอดภัย</strong>
      <span>บันทึกผลในแท็บ “ผลทดสอบความปลอดภัย” ของแต่ละคำร้อง</span></div>
      <button class="btn btn-sm" data-goto="mine" data-missing="safety">ดูรายการ</button></div>`;
  } else if (u.role === 'tfd' && stats.missing[3] > 0) {
    callout = `<div class="callout warn"><span class="ico">${icon('clock', 'i-lg')}</span>
      <div class="txt"><strong>${stats.missing[3]} คำร้องรอผลทดสอบระบบ CPO กับ PEA EVMS</strong>
      <span>บันทึกผลทดสอบในเงื่อนไขที่ 3 ของแต่ละคำร้อง</span></div>
      <button class="btn btn-sm" data-missing="3">ดูรายการ</button></div>`;
  }

  const segs = [['', 'ทั้งหมด', stats.total], ['pending', 'รอเงื่อนไข', stats.pending], ['ready', 'รอเปลี่ยนอัตรา', stats.ready],
    ['completed', 'เสร็จสมบูรณ์', stats.completed], ['cancelled', 'ยกเลิก', stats.cancelled]];
  const L = state.lookups;

  view().innerHTML = `
    <div class="page-head">
      <div><h1>รายการคำร้อง EV Low Priority</h1>
        <p>${esc(areaLabel(u))} · ข้อมูล ณ ${fmtDate(todayISO())}</p></div>
      <div class="row">
        ${scopeToggle(u)}
        <a class="btn" id="exportBtn" href="#">${icon('download')}ส่งออก CSV</a>
        ${canCreate(u) ? `<a class="btn btn-primary" href="#/new">${icon('plus')}รับคำร้องใหม่</a>` : ''}
      </div>
    </div>
    ${callout}
    ${statusKpis(stats, u)}
    ${progressCard(stats)}
    <div class="card">
      <div class="toolbar">
        <div class="seg" role="tablist">${segs.map(([k, t, n]) =>
          `<button data-status="${k}" role="tab">${esc(t)} <span class="n">${fmtNum(n)}</span></button>`).join('')}</div>
        <div class="input-icon">${icon('search')}<input type="search" id="fq" placeholder="ค้นหาสถานี, บริษัท, CA, Meter, จังหวัด" value="${esc(f.q)}"></div>
      </div>
      <div class="filters">
        ${showingAll(u) ? `
          <select id="fregion" aria-label="กฟข."><option value="">ทุก กฟข.</option>${L.regions.map((r) => `<option value="${esc(r)}">${esc(regionLabel(r))}</option>`).join('')}</select>` : ''}
        ${showingAll(u) || u.role === 'region' ? `
          <select id="foffice" aria-label="กฟส."><option value="">ทุก กฟส.</option>${officeOptions(L.offices, f.office,
            u.role === 'region' && !showingAll(u) ? u.office : f.region)}</select>` : ''}
        <select id="fmissing" aria-label="ค้างเงื่อนไข"><option value="">ทุกเงื่อนไข</option>
          <option value="payment">ค้างชำระค่าทดสอบ</option>
          ${[1, 2, 3].map((n) => `<option value="${n}">ค้างเงื่อนไข ${n}: ${esc(CONDITIONS[n].short)}</option>`).join('')}
          <option value="safety">ยังไม่มีผลทดสอบความปลอดภัย</option></select>
        <button class="link-btn small" id="clearF">ล้างตัวกรอง</button>
      </div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>สถานีอัดประจุไฟฟ้า</th><th>กฟส. / กฟข.</th><th>เงื่อนไข</th><th>สถานะ</th><th class="r">วันที่ยื่น / มีผล Low</th><th class="th-safety">ผลทดสอบ<br>ความปลอดภัย<small>(ไม่เป็นเงื่อนไข)</small></th></tr></thead>
        <tbody id="listBody"><tr><td colspan="6" class="empty">กำลังโหลด…</td></tr></tbody>
      </table></div>
      <div class="tbl-foot" id="listFoot"></div>
    </div>`;

  if ($('#fregion')) $('#fregion').value = f.region;
  if ($('#foffice')) $('#foffice').value = f.office;
  $('#fmissing').value = f.missing;
  const sync = () => {
    $$('.seg button[data-status]').forEach((b) => b.classList.toggle('on', b.dataset.status === f.status));
    $$('.kpi').forEach((b) => b.classList.toggle('on', b.dataset.status === f.status && f.status !== ''));
    $('#fmissing').value = f.missing;
  };
  sync();

  let deb;
  $('#fq').addEventListener('input', (e) => { f.q = e.target.value; clearTimeout(deb); deb = setTimeout(loadList, 220); });
  $('#fregion')?.addEventListener('change', (e) => {
    f.region = e.target.value; f.office = '';
    $('#foffice').innerHTML = `<option value="">ทุก กฟส.</option>${officeOptions(L.offices, '', f.region)}`;
    loadList();
  });
  bindScopeToggle(() => renderDashboard());
  $$('[data-goto=mine]').forEach((b) => b.addEventListener('click', (e) => {
    if (state.filter.scope === 'all') {
      e.stopImmediatePropagation();
      Object.assign(f, { scope: 'mine', office: '', region: '', status: b.dataset.status || '', missing: b.dataset.missing || '' });
      renderDashboard();
    }
  }, true));
  $('#foffice')?.addEventListener('change', (e) => { f.office = e.target.value; loadList(); });
  $('#fmissing').addEventListener('change', (e) => { f.missing = e.target.value; if (f.missing) f.status = ''; sync(); loadList(); });
  $$('[data-status]').forEach((b) => b.addEventListener('click', () => { f.status = b.dataset.status; f.missing = ''; sync(); loadList(); }));
  $$('[data-missing]').forEach((b) => b.addEventListener('click', () => { f.status = ''; f.missing = b.dataset.missing; sync(); loadList(); }));
  $('#clearF').addEventListener('click', () => {
    Object.assign(f, { status: '', q: '', office: '', region: '', missing: '' }); // คงขอบเขต (scope) เดิมไว้
    renderDashboard();
  });
  $('#exportBtn').addEventListener('click', (e) => {
    e.preventDefault();
    openUrl(`/api/applications/export.csv?${new URLSearchParams(f)}`);
  });
  await loadList();
}

async function loadList() {
  const rows = await api('GET', `/api/applications?${new URLSearchParams(state.filter)}`);
  const body = $('#listBody');
  if (!body) return;
  $('#listFoot').textContent = `แสดง ${fmtNum(rows.length)} รายการ`;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6"><div class="empty">${icon('inbox')}<div>ไม่พบคำร้องตามเงื่อนไขที่เลือก</div></div></td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r) => {
    const age = daysBetween(r.request_date || r.created_at, r.low_effective_date || r.completed_at);
    return `<tr data-id="${r.id}">
      <td><div class="cell-station"><span class="avatar">${initials(r.company, r.station_name)}</span>
        <div><div class="t">${esc(r.station_name)}</div><div class="s">${r.ca_no ? `CA <span class="mono">${esc(r.ca_no)}</span>` : '<span class="faint">ไม่มี CA</span>'}${r.applicant_name ? ` · ${esc(r.applicant_name)}` : ''}</div></div></div></td>
      <td class="cell-2"><div class="t nowrap">${esc(r.office)}</div><div class="s nowrap">${esc([regionLabel(r.region), r.province].filter(Boolean).join(' · '))}</div></td>
      <td>${condProgress(r)}${r.status === 'pending' && !r.paid ? `<div class="unpaid">${icon('receipt', 'i-sm')}ค้างชำระค่าทดสอบ</div>` : ''}</td>
      <td>${statusPill(r.status)}${r.status === 'completed' ? '<div class="st-note">(เปลี่ยนอัตรา Low ในระบบ SAP แล้ว)</div>' : ''}</td>
      <td class="r cell-2"><div class="t nowrap">ยื่น ${fmtDate(r.request_date || r.created_at)}</div>
        <div class="s nowrap">${[r.low_effective_date ? `Low ${fmtDate(r.low_effective_date)}` : '', r.status === 'cancelled' ? '' : `${fmtNum(age)} วัน`].filter(Boolean).join(' · ')}</div></td>
      <td class="td-safety">${safetyCell(r.safety)}</td>
    </tr>`;
  }).join('');
  $$('tr[data-id]', body).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/app/${tr.dataset.id}`; }));
}

// ============================================================ application form (รับคำร้อง / แก้ไข)
function radio(name, value, label, current) {
  return `<label class="check"><input type="radio" name="${name}" value="${esc(value)}" ${current === value ? 'checked' : ''}><span>${esc(label)}</span></label>`;
}
function checkbox(name, value, label, checked) {
  return `<label class="check"><input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;
}
const delBtn = `<button type="button" class="btn btn-ghost btn-icon" data-remove title="ลบแถว" aria-label="ลบแถว">${icon('trash', 'i-sm')}</button>`;
function chargerRow(c = {}) {
  return `<tr><td class="w-no"></td>
    <td><input type="text" data-k="brand" value="${esc(c.brand)}" placeholder="ยี่ห้อ" aria-label="ยี่ห้อ"></td>
    <td><input type="text" data-k="model" value="${esc(c.model)}" placeholder="รุ่น" aria-label="รุ่น"></td>
    <td class="w-num"><input type="number" step="0.01" min="0" data-k="kw" value="${esc(c.kw)}" aria-label="พิกัดกำลังไฟฟ้า kW"></td>
    <td class="w-num"><input type="number" step="1" min="0" data-k="qty" value="${esc(c.qty ?? 1)}" aria-label="จำนวน"></td>
    <td class="w-act">${delBtn}</td></tr>`;
}
function equipRow(e = {}) {
  return `<tr><td class="w-no"></td>
    <td><input type="text" data-k="type" value="${esc(e.type)}" placeholder="เช่น โคมไฟส่องสว่าง, หน้าจอ, อุปกรณ์สื่อสาร" aria-label="ชนิดของอุปกรณ์"></td>
    <td class="w-num"><input type="number" step="0.01" min="0" data-k="kw" value="${esc(e.kw)}" aria-label="พิกัดกำลังไฟฟ้า kW"></td>
    <td class="w-num"><input type="number" step="1" min="0" data-k="qty" value="${esc(e.qty ?? 1)}" aria-label="จำนวน"></td>
    <td class="w-act">${delBtn}</td></tr>`;
}
const fsec = (id, no, title, body, req = false) => `
  <section class="card fsec" id="sec-${id}">
    <div class="card-head"><h2><span class="sec-no">${esc(no)}</span><span class="${req ? 'req' : ''}">${esc(title)}</span></h2></div>
    <div class="card-pad">${body}</div>
  </section>`;

async function renderForm(id) {
  const u = state.user;
  if (!canCreate(u)) throw new Error('บทบาทนี้ไม่สามารถรับคำร้องได้');
  const seq = routeSeq;
  let a = null;
  if (id) {
    a = await api('GET', `/api/applications/${id}`);
    if (!a.permissions.edit) throw new Error('ไม่สามารถแก้ไขคำร้องนี้ได้');
  }
  await loadLookups();
  if (isStale(seq)) return;
  const L = state.lookups;
  setCrumbs(a ? [['รายการคำร้อง', '#/list'], [a.station_name, `#/app/${a.id}`], ['แก้ไข']] : [['รายการคำร้อง', '#/list'], ['รับคำร้องใหม่']]);
  const d = a?.data || {};
  const crit = d.criteria || [];
  const docs = new Set(d.documents || []);
  const channels = new Set(d.charge_channels || []);
  const revenue = new Set(d.revenue || []);
  const cpo = d.cpo || {};
  const dl = (listId, items) => `<datalist id="${listId}">${items.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`;

  const sections = [
    ['a', 'ก', 'ผู้ขอใช้ไฟฟ้าและสถานี'], ['b', 'ข', 'ข้อมูลผู้ใช้ไฟฟ้า (SAP)'], ['1', '1', 'พื้นที่ตั้งสถานี'], ['2', '2', 'คุณลักษณะสถานี'],
    ['3', '3', 'เวลาให้บริการ'], ['4', '4', 'พิกัดภูมิศาสตร์'], ['5', '5', 'เครื่องอัดประจุไฟฟ้า'], ['6', '6', 'อุปกรณ์ไฟฟ้าอื่นๆ'],
    ['7', '7', 'การจัดเก็บรายได้'], ['8', '8', 'ระบบ CPO'], ['8d', '8', 'หลักฐานประกอบ'], ['9', '9', 'การตรวจสอบและทดสอบ'],
    ...(a ? [] : [['files', 'ค', 'แบบฟอร์มคำร้อง (PDF)']]),
  ];
  const curOffice = a?.office || (u.role === 'field' ? u.office : '');
  const curRegion = a?.region || L.offices.find((o) => o.name === curOffice)?.region || '';
  const pdfSlot = (name, n, multiple) => `
    <label class="pdf-slot ${n === 0 ? 'required' : ''}">
      <span class="pdf-ico">${icon(n === 0 ? 'file' : 'badge')}</span>
      <span class="pdf-txt"><strong class="${n === 0 ? 'req' : ''}">${n === 0 ? esc(CONDITIONS[0].title) : `เงื่อนไขที่ ${n}: ${esc(CONDITIONS[n].title)}`}</strong>
        <span class="pdf-names" data-for="${name}">${n === 0
          ? 'บังคับ · ไฟล์ PDF แบบฟอร์มการขอใช้ไฟฟ้า (เพิ่มเติม) สำหรับผู้ขอใช้ไฟฟ้าสถานีอัดประจุไฟฟ้า แบบ Low Priority'
          : 'ถ้ามีเอกสารแล้ว แนบมาพร้อมคำร้องได้เลย'}</span></span>
      <span class="btn btn-sm">${icon('upload', 'i-sm')}เลือกไฟล์</span>
      <input type="file" name="${name}" accept="application/pdf,.pdf" ${multiple ? 'multiple' : ''} hidden>
    </label>`;

  view().innerHTML = `
  <div class="page-head">
    <div><h1>${a ? 'แก้ไขคำร้อง' : 'รับคำร้องขอใช้ไฟฟ้า EV Low Priority'}</h1>
      <p>${a ? `<span class="mono">${esc(a.app_no)}</span> · ${esc(a.station_name)}` : 'แบบฟอร์มการขอใช้ไฟฟ้า (เพิ่มเติม) สำหรับผู้ขอใช้ไฟฟ้าสถานีอัดประจุไฟฟ้า แบบ Low Priority'}</p></div>
  </div>
  <div class="form-layout">
    <nav class="form-nav">${sections.map(([sid, no, t]) => `<a href="#sec-${sid}" data-jump="${sid}"><span class="sec-no">${no}</span>${esc(t)}</a>`).join('')}</nav>
    <form id="appForm" novalidate>
      ${fsec('a', 'ก', 'ข้อมูลผู้ขอใช้ไฟฟ้าและสถานีอัดประจุไฟฟ้า', `
        <div class="grid g4">
          ${u.role === 'admin'
            ? `<label class="field"><span class="req">กฟข.</span><select id="regionSel" name="region">
                <option value="">เลือก กฟข.</option>${L.regions.map((r) => `<option value="${esc(r)}" ${r === curRegion ? 'selected' : ''}>${esc(regionLabel(r))}</option>`).join('')}</select></label>
               <label class="field"><span class="req">กฟส.ในพื้นที่ใช้ไฟฟ้า</span><select id="officeSel" name="office">
                <option value="">เลือก กฟส.</option>${officeOptions(L.offices, curOffice, curRegion)}</select></label>`
            : `<label class="field"><span>กฟข.</span><input type="text" value="${esc(regionLabel(curRegion) || '–')}" disabled>
                 <input type="hidden" name="region" value="${esc(curRegion)}"></label>
               <label class="field"><span>กฟส.ในพื้นที่ใช้ไฟฟ้า</span><input type="text" value="${esc(curOffice)}" disabled></label>`}
          <label class="field"><span>วันที่ยื่นคำร้อง</span><input type="date" name="request_date" value="${esc(a?.request_date || todayISO())}"></label>
          <label class="field span2"><span class="req">ชื่อสถานีอัดประจุไฟฟ้า</span><input type="text" name="station_name" value="${esc(a?.station_name)}"></label>
          <label class="field"><span>ชื่อย่อบริษัท / แบรนด์</span><input type="text" name="company" value="${esc(a?.company)}" placeholder="เช่น OR, EA, EGAT"></label>
          <div></div>
          <label class="field span2"><span class="req">ชื่อผู้ขอใช้ไฟฟ้า (นิติบุคคล/บุคคล)</span><input type="text" name="applicant_name" value="${esc(a?.applicant_name)}"></label>
          <div class="field span2"><span>ประเภทผู้ขอใช้ไฟฟ้า</span><div class="row" style="gap:4px 18px">${APPLICANT_TYPES.map(([k, t]) => radio('applicant_type', k, t, d.applicant_type)).join('')}</div></div>
          <label class="field span-all"><span>ที่อยู่สถานีอัดประจุไฟฟ้า</span><textarea name="station_address" rows="2">${esc(a?.station_address)}</textarea></label>
          <label class="field"><span>อำเภอ</span><input type="text" name="district" value="${esc(a?.district)}"></label>
          <label class="field"><span>จังหวัด</span><input type="text" name="province" list="dlProv" value="${esc(a?.province)}">${dl('dlProv', L.provinces)}</label>
          <div class="span2"></div>
          <label class="field span2"><span>ชื่อผู้ติดต่อ</span><input type="text" name="contact_name" value="${esc(a?.contact_name)}"></label>
          <label class="field"><span>Email</span><input type="email" name="email" value="${esc(a?.email)}"></label>
          <label class="field"><span>เบอร์โทรศัพท์</span><input type="tel" name="phone" value="${esc(a?.phone)}"></label>
        </div>`)}
      ${fsec('b', 'ข', 'ข้อมูลผู้ใช้ไฟฟ้าในระบบ SAP', `
        <div class="grid g2">
          <label class="field"><span class="req">Contract Account (CA)</span><input type="text" name="ca_no" value="${esc(a?.ca_no)}" inputmode="numeric" placeholder="เช่น 020012345678"></label>
          <label class="field"><span class="req">Meter No. / PEA No.</span><input type="text" name="meter_no" value="${esc(a?.meter_no)}" placeholder="เช่น 6500676282"></label>
        </div>`, true)}
      ${fsec('1', '1', 'สถานีอัดประจุไฟฟ้าอยู่ในพื้นที่', `
        <div class="checks">${LOCATIONS.map((l) => (l === 'อื่นๆ'
          ? `<label class="check"><input type="radio" name="location_type" value="อื่นๆ" ${d.location_type === 'อื่นๆ' ? 'checked' : ''}><span class="inline-other">อื่นๆ <input type="text" name="location_other" value="${esc(d.location_other)}" placeholder="ระบุ"></span></label>`
          : radio('location_type', l, l, d.location_type))).join('')}</div>`, true)}
      ${fsec('2', '2', 'คุณลักษณะของสถานีที่จะได้รับอัตรา Low Priority (ต้องมีครบทุกข้อ)', `
        <div class="crit">${CRITERIA.map((c, i) => `<div>
          <label class="check"><input type="checkbox" name="crit${i}" ${crit[i] ? 'checked' : ''}><span>${esc(c)}</span></label>
          ${i === CHANNEL_CRITERION ? `<div class="sub-channels">${CHANNELS.map((ch) => (ch === 'อื่นๆ'
            ? `<label class="check"><input type="checkbox" name="channel" value="อื่นๆ" ${channels.has('อื่นๆ') ? 'checked' : ''}><span class="inline-other">อื่นๆ <input type="text" name="channel_other" value="${esc(d.channel_other)}" placeholder="โปรดระบุ"></span></label>`
            : checkbox('channel', ch, ch, channels.has(ch)))).join('')}</div>` : ''}</div>`).join('')}
        </div>
        <div class="row"><button type="button" class="btn btn-sm" id="checkAllCrit">${icon('check', 'i-sm')}ทำเครื่องหมายครบทุกข้อ</button><span class="hint" id="critHint"></span></div>`, true)}
      ${fsec('3', '3', 'สถานีอัดประจุไฟฟ้าเปิดให้บริการ', `
        <div class="row" style="gap:4px 24px">${radio('service_hours', '24', 'บริการ 24 ชั่วโมง', d.service_hours)}${radio('service_hours', 'lt24', 'บริการไม่ถึง 24 ชั่วโมง', d.service_hours)}</div>`, true)}
      ${fsec('4', '4', 'พิกัดทางภูมิศาสตร์ของสถานี (Lat, Long)', `
        <div class="grid g4">
          <label class="field"><span>Latitude</span><input type="text" name="lat" value="${esc(a?.lat)}" inputmode="decimal" placeholder="เช่น 18.7883"></label>
          <label class="field"><span>Longitude</span><input type="text" name="lng" value="${esc(a?.lng)}" inputmode="decimal" placeholder="เช่น 98.9853"></label>
          <div class="field"><span>&nbsp;</span><a class="btn" id="mapLink" target="_blank" rel="noopener">${icon('pin')}เปิดแผนที่</a></div>
        </div>
        <p class="hint">วางพิกัดแบบ “lat, long” ในช่อง Latitude ได้ ระบบจะแยกให้เอง</p>`)}
      ${fsec('5', '5', 'รายละเอียดทางเทคนิคของเครื่องอัดประจุไฟฟ้า', `
        <div class="table-wrap"><table class="rows" id="chargerTable">
          <thead><tr><th class="w-no">ที่</th><th>ยี่ห้อ</th><th>รุ่น</th><th class="w-num">พิกัด (kW)</th><th class="w-num">จำนวน (เครื่อง)</th><th class="w-act"></th></tr></thead>
          <tbody>${(d.chargers?.length ? d.chargers : [{}]).map(chargerRow).join('')}</tbody>
        </table></div>
        <div class="totals">
          <button type="button" class="btn btn-sm" data-add="charger">${icon('plus', 'i-sm')}เพิ่มเครื่องอัดประจุ</button>
          <span class="spacer"></span>
          <span class="total-pill">กำลังไฟฟ้ารวม <span id="chargerTotal">0</span> kW</span>
          <label class="row" style="gap:8px"><span class="label">ขนาดรวม</span><input type="number" step="0.01" min="0" name="total_kva" value="${esc(a?.total_kva)}" style="width:120px"><span class="label">kVA</span></label>
        </div>
        <p class="hint" id="kvaHint"></p>
        <p class="hint">รายชื่อเครื่องอัดประจุที่ขึ้นทะเบียน: www.pea.co.th › บริการอื่นๆ › งานด้านพลังงาน › การขึ้นทะเบียนผลิตภัณฑ์ (EV Charger)</p>`, true)}
      ${fsec('6', '6', 'อุปกรณ์ไฟฟ้าอื่นๆ ที่ใช้งานในสถานี', `
        <div class="table-wrap"><table class="rows" id="equipTable">
          <thead><tr><th class="w-no">ที่</th><th>ชนิดของอุปกรณ์ไฟฟ้า</th><th class="w-num">พิกัด (kW)</th><th class="w-num">จำนวน (เครื่อง)</th><th class="w-act"></th></tr></thead>
          <tbody>${(d.equipment?.length ? d.equipment : [{}]).map(equipRow).join('')}</tbody>
        </table></div>
        <div class="totals"><button type="button" class="btn btn-sm" data-add="equip">${icon('plus', 'i-sm')}เพิ่มอุปกรณ์</button>
          <span class="spacer"></span><span class="total-pill">รวม <span id="equipTotal">0</span> kW</span></div>`)}
      ${fsec('7', '7', 'ลักษณะการจัดเก็บรายได้จากผู้รับบริการ', `
        <div class="checks">${REVENUE.map(([k, t]) => (k === 'other'
          ? `<label class="check"><input type="checkbox" name="revenue" value="other" ${revenue.has('other') ? 'checked' : ''}><span class="inline-other">อื่นๆ <input type="text" name="revenue_other" value="${esc(d.revenue_other)}" placeholder="ระบุ"></span></label>`
          : checkbox('revenue', k, t, revenue.has(k)))).join('')}</div>`)}
      ${fsec('8', '8', 'ระบบควบคุมและบริหารจัดการสถานี (Charging Point Operator: CPO)', `
        <div class="grid g2">
          <label class="field"><span>ชื่อระบบให้บริการ (CPO / Platform)</span><input type="text" name="cpo_system_name" value="${esc(cpo.system_name)}"></label>
          <label class="field"><span>ชื่อผู้ให้บริการ (CPO)</span><input type="text" name="cpo_provider" value="${esc(cpo.provider)}"></label>
          <label class="field"><span>Email</span><input type="email" name="cpo_email" value="${esc(cpo.email)}"></label>
          <label class="field"><span>เบอร์โทรศัพท์</span><input type="tel" name="cpo_phone" value="${esc(cpo.phone)}"></label>
        </div>`)}
      ${fsec('8d', '8', 'หลักฐานประกอบการขอใช้ไฟฟ้าที่ได้รับแล้ว', `
        ${DOC_GROUPS.map((g) => `<div class="doc-group"><h4>${esc(g.title)}</h4>${g.items.map(([k, t]) => checkbox('doc', k, t, docs.has(k))).join('')}</div>`).join('')}
        <label class="field"><span>อื่นๆ</span><input type="text" name="documents_other" value="${esc(d.documents_other)}"></label>`)}
      ${fsec('9', '9', 'การตรวจสอบและทดสอบระบบอัดประจุไฟฟ้า', `
        <div class="grid g2">
          <div class="field"><span class="req">9.1 ตรวจวัดและทดสอบความปลอดภัย ตามมาตรฐาน IEC 60364-6</span>
            ${TEST_60364.map(([k, t]) => radio('test_60364', k, t, d.test_60364)).join('')}
            <p class="hint">ถ้าผู้ขอใช้ไฟฟ้าจัดหาหน่วยงานภายนอก ต้องส่งผลทดสอบให้ กฟภ. ก่อนเปลี่ยนอัตรา</p></div>
          <div class="field"><span class="req">9.2 ทดสอบสถานะการอัดประจุไฟฟ้า ตามมาตรฐาน IEC 61851</span>
            ${TEST_61851.map(([k, t]) => radio('test_61851', k, t, d.test_61851)).join('')}</div>
        </div>
        <label class="field"><span>หมายเหตุเพิ่มเติม</span><textarea name="remark" rows="2">${esc(d.remark)}</textarea></label>`, true)}
      ${a ? '' : fsec('files', 'ค', 'แนบแบบฟอร์มคำร้องขอใช้ไฟฟ้า (PDF)', `
        <div class="pdf-slots">${pdfSlot('form_pdf', 0, false)}</div>
        <p class="hint">รับเฉพาะไฟล์ PDF ไม่เกิน 20 MB · หลังบันทึกคำร้อง ให้บันทึกเลขที่คำร้องค่าทดสอบและการชำระเงินในหน้าคำร้อง แล้วจึงแนบหลักฐานเงื่อนไข 1–3</p>`, true)}

      <div class="form-bar">
        <div class="alert alert-danger" id="formErr" hidden style="flex:1"></div>
        <span class="spacer"></span>
        <a class="btn" href="${a ? `#/app/${a.id}` : '#/'}">ยกเลิก</a>
        <button class="btn btn-primary" id="saveBtn">${icon('check')}${a ? 'บันทึกการแก้ไข' : 'บันทึกคำร้อง'}</button>
      </div>
    </form>
  </div>`;

  const form = $('#appForm');
  $$('[data-jump]').forEach((l) => l.addEventListener('click', (e) => {
    e.preventDefault();
    $(`#sec-${l.dataset.jump}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  const numberRows = (tb) => $$('tr', tb).forEach((tr, i) => { $('.w-no', tr).textContent = i + 1; });
  const sumRows = (sel) => $$(`${sel} tbody tr`).reduce((s, tr) =>
    s + (Number($('[data-k=kw]', tr).value) || 0) * (Number($('[data-k=qty]', tr).value) || 0), 0);
  const recalc = () => {
    $('#chargerTotal').textContent = fmtNum(sumRows('#chargerTable'));
    $('#equipTotal').textContent = fmtNum(sumRows('#equipTable'));
    numberRows($('#chargerTable tbody')); numberRows($('#equipTable tbody'));
    const kva = Number(form.elements.total_kva.value);
    $('#kvaHint').textContent = kva > 0
      ? (kva >= 1000 ? 'ขนาดรวมตั้งแต่ 1,000 kVA — ต้องมีใบอนุญาตประกอบกิจการจำหน่ายไฟฟ้า (กกพ.)' : 'ขนาดรวมไม่เกิน 1,000 kVA — ใช้หนังสือรับแจ้งยกเว้นการประกอบกิจการพลังงาน (กกพ.)')
      : '';
    const n = CRITERIA.filter((_, i) => form.elements[`crit${i}`].checked).length;
    $('#critHint').textContent = `ทำเครื่องหมายแล้ว ${n}/${CRITERIA.length} ข้อ`;
    const lat = form.elements.lat.value.trim(); const lng = form.elements.lng.value.trim();
    const ml = $('#mapLink');
    if (lat && lng) ml.href = `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
    else ml.removeAttribute('href');
  };
  form.addEventListener('input', recalc);
  form.addEventListener('change', recalc);
  form.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const tb = rm.closest('tbody');
      if ($$('tr', tb).length > 1) rm.closest('tr').remove();
      else $$('input', rm.closest('tr')).forEach((i) => { i.value = i.dataset.k === 'qty' ? 1 : ''; });
      recalc();
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const tb = $(add.dataset.add === 'charger' ? '#chargerTable tbody' : '#equipTable tbody');
      tb.insertAdjacentHTML('beforeend', add.dataset.add === 'charger' ? chargerRow() : equipRow());
      $('tr:last-child input', tb).focus();
      recalc();
    }
  });
  $('#checkAllCrit').addEventListener('click', () => { CRITERIA.forEach((_, i) => { form.elements[`crit${i}`].checked = true; }); recalc(); });
  form.elements.lat.addEventListener('paste', (e) => {
    const t = (e.clipboardData || window.clipboardData).getData('text');
    const m = t.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    if (m) { e.preventDefault(); form.elements.lat.value = m[1]; form.elements.lng.value = m[2]; recalc(); }
  });
  [['location_other', 'input[name=location_type][value="อื่นๆ"]'], ['channel_other', 'input[name=channel][value="อื่นๆ"]'],
    ['revenue_other', 'input[name=revenue][value=other]']].forEach(([n, sel]) => {
    form.elements[n].addEventListener('input', (e) => { if (e.target.value) $(sel, form).checked = true; });
  });
  recalc();
  $$('.pdf-slot input[type=file]', form).forEach((inp) => inp.addEventListener('change', () => {
    const names = [...inp.files].map((f) => f.name);
    const box = $(`.pdf-names[data-for="${inp.name}"]`, form);
    box.textContent = names.length ? names.join(', ') : box.dataset.empty;
    inp.closest('.pdf-slot').classList.toggle('has', names.length > 0);
    if (names.length) inp.closest('.pdf-slot').classList.remove('missing');
  }));
  $('#regionSel')?.addEventListener('change', (e) => {
    $('#officeSel').innerHTML = `<option value="">เลือก กฟส.</option>${officeOptions(L.offices, '', e.target.value)}`;
  });
  $('#officeSel')?.addEventListener('change', (e) => {
    const o = L.offices.find((x) => x.name === e.target.value);
    if (o && $('#regionSel').value !== o.region) $('#regionSel').value = o.region;
  });
  $$('.pdf-names', form).forEach((b) => { b.dataset.empty = b.textContent; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = collectForm(form);
    const err = $('#formErr'); err.hidden = true;
    const btn = $('#saveBtn'); btn.disabled = true;
    try {
      if (a) {
        await api('PUT', `/api/applications/${a.id}`, payload);
        toast('บันทึกการแก้ไขแล้ว');
        location.hash = `#/app/${a.id}`;
      } else {
        if (!form.elements.form_pdf.files.length) {
          $('.pdf-slot.required', form).classList.add('missing');
          $('#sec-files').scrollIntoView({ behavior: 'smooth', block: 'center' });
          throw new Error('กรุณาแนบแบบฟอร์มคำร้องขอใช้ไฟฟ้า (PDF)');
        }
        const fileInputs = $$('.pdf-slot input[type=file]', form).filter((i) => i.files.length);
        const body = new FormData();
        body.append('payload', JSON.stringify(payload));
        fileInputs.forEach((i) => [...i.files].forEach((f) => body.append(i.name, f)));
        const r = await api('POST', '/api/applications', body);
        toast('บันทึกคำร้องแล้ว · ขั้นต่อไป: บันทึกเลขที่คำร้องค่าทดสอบและการชำระเงิน');
        location.hash = `#/app/${r.id}`;
      }
    } catch (ex) {
      err.innerHTML = `${icon('alert')}<span>${esc(ex.message)}</span>`; err.hidden = false;
    } finally { btn.disabled = false; }
  });
}

function collectForm(form) {
  const el = form.elements;
  const v = (n) => (el[n] ? el[n].value : '');
  const checked = (n) => $$(`input[name="${n}"]:checked`, form).map((i) => i.value);
  const rows = (sel, keys) => $$(`${sel} tbody tr`).map((tr) => Object.fromEntries(keys.map((k) => [k, $(`[data-k=${k}]`, tr).value])));
  return {
    office: v('office'), region: v('region'), province: v('province'), district: v('district'),
    request_date: v('request_date'),
    station_name: v('station_name'), station_address: v('station_address'), company: v('company'),
    applicant_name: v('applicant_name'), applicant_type: v('applicant_type'),
    contact_name: v('contact_name'), email: v('email'), phone: v('phone'),
    ca_no: v('ca_no'), meter_no: v('meter_no'),
    location_type: v('location_type'), location_other: v('location_other'),
    criteria: CRITERIA.map((_, i) => el[`crit${i}`].checked),
    charge_channels: checked('channel'), channel_other: v('channel_other'),
    service_hours: v('service_hours'),
    lat: v('lat'), lng: v('lng'),
    chargers: rows('#chargerTable', ['brand', 'model', 'kw', 'qty']),
    total_kva: v('total_kva'),
    equipment: rows('#equipTable', ['type', 'kw', 'qty']),
    revenue: checked('revenue'), revenue_other: v('revenue_other'),
    cpo: { system_name: v('cpo_system_name'), provider: v('cpo_provider'), email: v('cpo_email'), phone: v('cpo_phone') },
    documents: checked('doc'), documents_other: v('documents_other'),
    test_60364: v('test_60364'), test_61851: v('test_61851'),
    remark: v('remark'),
  };
}

// ============================================================ detail / tracking
const EVENT_LABEL = {
  create: 'รับคำร้อง', update: 'แก้ไขข้อมูล', upload: 'เพิ่มหลักฐาน', delete_file: 'ลบหลักฐาน', ready: 'ครบเงื่อนไข 3 ข้อ',
  unready: 'เงื่อนไขไม่ครบ', low_rate: 'เปลี่ยนอัตรา Low แล้ว', low_rate_edit: 'แก้ไขวันที่มีผล', cancel: 'ยกเลิกคำร้อง',
  invoice: 'บันทึกเลขที่คำร้อง', invoice_delete: 'ลบเลขที่คำร้อง',
  payment: 'บันทึกการชำระเงิน', payment_undo: 'ยกเลิกการชำระเงิน', paid: 'ชำระค่าทดสอบครบ',
  payment_exempt: 'ไม่ต้องชำระค่าทดสอบ', payment_exempt_undo: 'ยกเลิก "ไม่ต้องชำระ"',
};

// กติกาเดียวกับเซิร์ฟเวอร์: ครบเมื่อมีหลักฐานอย่างน้อย 1 รายการที่ผลไม่ใช่ "ไม่ผ่าน"
function condState(a, n) {
  const list = a.attachments.filter((t) => t.condition_no === n);
  if (!list.length) return 'none';
  return list.some((t) => t.result !== 'fail') ? 'met' : 'failed';
}

async function renderDetail(id, tab) {
  const seq = routeSeq;
  const a = await api('GET', `/api/applications/${id}`);
  if (isStale(seq)) return;
  const p = a.permissions;
  const d = a.data;
  const doneCount = [1, 2, 3].filter((n) => a.conditions[`c${n}`]).length;
  setCrumbs([['รายการคำร้อง', '#/list'], [a.station_name]]);

  const pay = a.payment;
  // แท็บเริ่มต้น: ยังไม่ชำระ → แท็บชำระเงิน, นอกนั้น → แท็บเงื่อนไข
  tab = tab || (a.status === 'pending' && !pay.done ? 'payment' : 'conditions');
  const steps = [
    { t: 'รับคำร้อง', s: fmtDate(a.request_date || a.created_at), cls: 'done' },
    { t: 'ชำระค่าทดสอบ', s: pay.done ? (pay.safety.exempt && pay.cpo.exempt ? 'ไม่ต้องชำระ' : 'ชำระครบแล้ว') : 'รอลูกค้าชำระ',
      cls: pay.done ? 'done' : a.status === 'pending' ? 'current' : '' },
    ...[1, 2, 3].map((n) => {
      const st = condState(a, n);
      return { t: `เงื่อนไข ${n}`, s: CONDITIONS[n].short, cls: st === 'met' ? 'done' : st === 'failed' ? 'failed' : '' };
    }),
    { t: 'เปลี่ยนอัตรา Low', s: a.status === 'completed' ? `มีผล ${fmtDate(a.low_effective_date)}` : 'ในระบบ SAP',
      cls: a.status === 'completed' ? 'done' : a.status === 'ready' ? 'current' : '' },
  ];
  const age = daysBetween(a.request_date || a.created_at, a.low_effective_date || a.completed_at);

  view().innerHTML = `
  <div class="stack" style="margin-top:8px">
    <section class="card">
      <div class="hero">
        <div class="hero-top">
          <span class="avatar lg">${initials(a.company, a.station_name)}</span>
          <div class="info">
            <div class="row" style="gap:6px">${statusPill(a.status, true)}<span class="tag mono">${esc(a.app_no)}</span>
              ${a.source === 'import' ? `<span class="tag">${icon('upload', 'i-sm')}นำเข้าจาก Excel</span>` : ''}</div>
            <h1>${esc(a.station_name)}</h1>
            <div class="hero-meta">
              <span>${icon('building', 'i-sm')}${esc(a.applicant_name)}</span>
              <span>${icon('pin', 'i-sm')}${esc([a.office, regionLabel(a.region), a.province].filter(Boolean).join(' · '))}</span>
            </div>
          </div>
          <div class="row no-print">
            ${a.drive_folder_url ? `<a class="btn" href="${esc(a.drive_folder_url)}" target="_blank" rel="noopener">${icon('folder')}โฟลเดอร์ Drive</a>` : ''}
            ${p.edit ? `<a class="btn" href="#/app/${a.id}/edit">${icon('edit')}แก้ไข</a>` : ''}
            <button class="btn" onclick="window.print()">${icon('printer')}พิมพ์</button>
            ${p.cancel ? `<button class="btn btn-danger-ghost" id="cancelBtn">${icon('ban')}ยกเลิกคำร้อง</button>` : ''}
          </div>
        </div>
        <div class="facts">
          <div class="fact"><div class="k">วันที่ยื่นคำร้อง</div><div class="v">${fmtDate(a.request_date || a.created_at)}</div></div>
          <div class="fact"><div class="k">Contract Account (CA)</div><div class="v">${esc(a.ca_no || '–')}</div></div>
          <div class="fact"><div class="k">Meter No.</div><div class="v">${esc(a.meter_no || '–')}</div></div>
          <div class="fact"><div class="k">ขนาด</div><div class="v">${a.total_kva ? `${fmtNum(a.total_kva)} kVA` : a.total_kw ? `${fmtNum(a.total_kw)} kW` : '–'}</div></div>
          <div class="fact"><div class="k">${a.status === 'completed' ? 'ระยะเวลาจนได้อัตรา Low' : 'อายุงาน'}</div><div class="v">${a.status === 'cancelled' ? '–' : `${fmtNum(age)} วัน`}</div></div>
        </div>
      </div>
    </section>

    <section class="card"><div class="tracker">${steps.map((s, i) => `
      <div class="tstep ${s.cls}"><div class="dot">${s.cls === 'done' ? icon('check', 'i-sm') : s.cls === 'failed' ? icon('x', 'i-sm') : i + 1}</div>
        <div><div class="t">${esc(s.t)}</div><div class="s">${esc(s.s)}</div></div></div>`).join('')}
    </div></section>

    ${hasArea(state.user) && !p.in_area ? `<div class="readonly-note">${icon('info')}<div>
      <strong>ดูได้อย่างเดียว</strong> — คำร้องนี้อยู่ในพื้นที่ ${esc(a.office)} · ${esc(regionLabel(a.region) || 'ไม่ระบุ กฟข.')}
      <span class="muted">บันทึกได้เฉพาะคำร้องใน${state.user.role === 'region' ? ' กฟข. ' : ' กฟส. '}ของตนเอง (${esc(scopeLabel(state.user))})</span></div></div>` : ''}
    ${actionPanel(a, doneCount)}

    <div class="detail-grid">
      <section class="card">
        <div class="tabs no-print" role="tablist">
          <button data-tab="payment" class="${tab === 'payment' ? 'on' : ''}">${icon('receipt', 'i-sm')}ชำระเงินค่าทดสอบ
            ${pay.done ? `<span class="tab-ok">${icon('check', 'i-sm')}ครบ</span>` : '<span class="tab-wait">รอชำระ</span>'}</button>
          <button data-tab="conditions" class="${tab === 'conditions' ? 'on' : ''}">${icon('badge', 'i-sm')}เงื่อนไข 3 ข้อ <span class="faint">${doneCount}/3</span></button>
          <button data-tab="tests" class="${tab === 'tests' ? 'on' : ''}">${icon('flask', 'i-sm')}ผลทดสอบความปลอดภัย</button>
          <button data-tab="info" class="${tab === 'info' ? 'on' : ''}">${icon('file', 'i-sm')}ข้อมูลคำร้อง</button>
        </div>
        <div class="tab-panel card-pad" data-panel="payment" ${tab !== 'payment' ? 'hidden' : ''}>
          <p class="muted small" style="margin:0 0 14px">บันทึกเลขที่คำร้องของค่าทดสอบแล้วติ๊ก “ลูกค้าชำระเงินแล้ว” (หรือระบุว่าไม่ต้องชำระ) ให้ครบทั้ง 2 รายการ จึงจะตรวจเงื่อนไข 1–3 ได้</p>
          ${invoiceBlock(a, 'safety')}${invoiceBlock(a, 'cpo')}
          ${pay.done ? `<div class="tab-note ok">${icon('checkCircle')}<span>ชำระค่าทดสอบครบแล้ว — ตรวจเงื่อนไข 1–3 ได้ที่แท็บ “เงื่อนไข 3 ข้อ”</span>
            <button type="button" class="btn btn-sm" data-goto-tab="conditions">ไปที่เงื่อนไข 3 ข้อ</button></div>` : ''}
        </div>
        <div class="tab-panel card-pad" data-panel="conditions" ${tab !== 'conditions' ? 'hidden' : ''}>
          ${pay.done || !isOpenStatus(a.status) ? '' : `<div class="tab-note warn">${icon('clock')}<span><strong>ต้องชำระค่าทดสอบก่อน</strong> — บันทึกเงื่อนไขได้เมื่อชำระ (หรือระบุว่าไม่ต้องชำระ) ครบทั้ง 2 รายการ</span>
            <button type="button" class="btn btn-sm" data-goto-tab="payment">ไปที่ชำระเงินค่าทดสอบ</button></div>`}
          <div class="${pay.done || !isOpenStatus(a.status) ? '' : 'locked-zone'}">${[1, 2, 3].map((n) => conditionBlock(a, n)).join('')}</div>
          <p class="hint" style="margin-top:14px">เงื่อนไขครบเมื่อมีหลักฐานอย่างน้อย 1 รายการที่ผลไม่ใช่ “ไม่ผ่าน” · เมื่อชำระเงินและเงื่อนไขครบทั้ง 3 ข้อ ระบบจะแจ้งเตือน กฟส.ในพื้นที่ใช้ไฟฟ้า ให้เปลี่ยนอัตรา Low ในระบบ SAP</p>
        </div>
        <div class="tab-panel card-pad" data-panel="tests" ${tab !== 'tests' ? 'hidden' : ''}>
          ${conditionBlock(a, 4)}
          <p class="hint" style="margin-top:14px">ผลตรวจวัดทดสอบความปลอดภัยเป็นข้อมูลประกอบ ไม่ใช่ 1 ใน 3 เงื่อนไขที่ใช้ตัดสินการเปลี่ยนอัตรา Low</p>
        </div>
        <div class="tab-panel" data-panel="info" ${tab !== 'info' ? 'hidden' : ''}>
          <div class="card-pad" style="padding-bottom:0">${conditionBlock(a, 0)}</div>${renderReadonly(a)}</div>
      </section>
      <aside class="card">
        <div class="card-head"><h2>${icon('history')}ประวัติการดำเนินการ</h2></div>
        <ul class="timeline">${a.events.map((e) => `<li class="k-${esc(e.action)}">
          <div class="t">${esc(EVENT_LABEL[e.action] || e.action)}</div>
          ${e.detail ? `<div class="d">${esc(e.detail)}</div>` : ''}
          <div class="w">${fmtDateTime(e.created_at)} · ${esc(e.user_name || (a.source === 'import' ? 'นำเข้าข้อมูล' : 'ระบบ'))}</div></li>`).join('')}</ul>
      </aside>
    </div>
  </div>`;

  const showTab = (t) => {
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
    $$('.tab-panel').forEach((pn) => { pn.hidden = pn.dataset.panel !== t; });
  };
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('[data-goto-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.gotoTab)));
  const reload = (t = 'conditions') => renderDetail(id, t).catch((err) => toast(err.message, true));

  // ฟอร์มเพิ่มหลักฐาน
  $$('[data-open-ev]').forEach((b) => b.addEventListener('click', () => {
    const f = $(`#evf${b.dataset.openEv}`);
    f.hidden = false; b.hidden = true;
    $('input[type=file]', f)?.focus();
  }));
  $$('[data-close-ev]').forEach((b) => b.addEventListener('click', () => {
    const n = b.dataset.closeEv;
    $(`#evf${n}`).hidden = true; $(`[data-open-ev="${n}"]`).hidden = false;
  }));
  $$('.ev-form').forEach((f) => {
    const kindOf = () => $('input[name=kind]:checked', f)?.value || 'file';
    const kindChange = () => {
      $('.k-file', f).hidden = kindOf() !== 'file';
      if ($('.k-link', f)) $('.k-link', f).hidden = kindOf() !== 'link';
    };
    $$('input[name=kind]', f).forEach((r) => r.addEventListener('change', kindChange));
    kindChange();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const n = f.dataset.cond;
      const kind = kindOf();
      const meta = { result: $('input[name=result]:checked', f)?.value || '', doc_no: f.elements.doc_no?.value || '',
        doc_date: f.elements.doc_date?.value || '', note: f.elements.note?.value || '' };
      const btn = $('button[type=submit]', f); btn.disabled = true;
      try {
        let r;
        if (kind === 'file') {
          const files = f.elements.files.files;
          if (!files.length) throw new Error('กรุณาเลือกไฟล์');
          const fd = new FormData();
          [...files].forEach((file) => fd.append('files', file));
          Object.entries(meta).forEach(([k, v]) => fd.append(k, v));
          r = await api('POST', `/api/applications/${a.id}/attachments?condition=${n}`, fd);
        } else {
          r = await api('POST', `/api/applications/${a.id}/evidence?condition=${n}`, { ...meta, url: f.elements.url.value });
        }
        toast(r.status === 'ready' && a.status !== 'ready' ? 'ครบ 3 เงื่อนไขแล้ว และแจ้งเตือน กฟส.ในพื้นที่ใช้ไฟฟ้า เรียบร้อย' : 'บันทึกแล้ว');
        reload(n === '4' ? 'tests' : n === '0' ? 'info' : 'conditions');
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    });
  });

  const currentTab = () => $('.tabs button.on')?.dataset.tab || 'conditions';
  $$('[data-del-att]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`ลบ "${b.dataset.name}" ?`)) return;
    try { await api('DELETE', `/api/attachments/${b.dataset.delAtt}`); toast('ลบแล้ว'); reload(currentTab()); } catch (err) { toast(err.message, true); }
  }));

  $$('[data-invoice]').forEach((b) => b.addEventListener('click', () => invoiceDialog(a, b.dataset.invoice, () => reload('payment'))));
  $$('[data-del-inv]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`ลบเลขที่คำร้อง ${b.dataset.no} ?`)) return;
    try { await api('DELETE', `/api/invoices/${b.dataset.delInv}`); toast('ลบเลขที่คำร้องแล้ว'); reload('payment'); } catch (err) { toast(err.message, true); }
  }));

  // ติ๊กว่าลูกค้าชำระเงินแล้ว (ถามวันที่ชำระ) / ยกเลิก
  const paidToast = (r, prev) => toast(r.status === 'ready' && prev !== 'ready' ? 'ชำระครบและเงื่อนไขครบ — แจ้งเตือนให้เปลี่ยนอัตรา Low แล้ว'
    : r.payment.done && !a.payment.done ? 'ชำระค่าทดสอบครบแล้ว — ตรวจเงื่อนไข 1–3 ได้' : 'บันทึกแล้ว');
  $$('[data-pay-inv]').forEach((cb) => cb.addEventListener('change', async (e) => {
    const id = cb.dataset.payInv;
    if (!cb.checked) {
      cb.checked = true;
      if (!confirm(`ยกเลิกการชำระเงินของเลขที่คำร้อง ${cb.dataset.no} ?`)) return;
      try { const r = await api('POST', `/api/invoices/${id}/payment`, { paid: false }); paidToast(r, a.status); reload('payment'); } catch (err) { toast(err.message, true); }
      return;
    }
    e.target.checked = false;
    openDialog(`<h2>บันทึกการชำระเงิน</h2><p class="muted">เลขที่คำร้อง <span class="mono">${esc(cb.dataset.no)}</span></p>
      <label class="field"><span class="req">วันที่ลูกค้าชำระเงิน</span><input type="date" name="paid_date" value="${todayISO()}" required></label>
      ${dlgActions('ลูกค้าชำระเงินแล้ว', 'btn-success')}`, async (fd) => {
      const r = await api('POST', `/api/invoices/${id}/payment`, { paid: true, paid_date: fd.get('paid_date') });
      paidToast(r, a.status); reload('payment');
    });
  }));
  $$('[data-exempt]').forEach((b) => b.addEventListener('click', () => {
    const fee = a.fees[b.dataset.exempt];
    openDialog(`<h2>ไม่ต้องชำระ${esc(fee.label)}</h2>
      <label class="field"><span class="req">เหตุผล</span><input type="text" name="reason" list="exemptReasons" required
        placeholder="เช่น ผู้ขอใช้ไฟฟ้าจัดหาหน่วยงานภายนอกที่ขึ้นทะเบียนกับ กฟภ. เป็นผู้ทดสอบ">
        <datalist id="exemptReasons"><option value="ผู้ขอใช้ไฟฟ้าจัดหาหน่วยงานภายนอกที่ขึ้นทะเบียนกับ กฟภ. เป็นผู้ทดสอบ"></datalist></label>
      ${dlgActions('บันทึก')}`, async (fd) => {
      const r = await api('POST', `/api/applications/${a.id}/payment-exempt`, { type: b.dataset.exempt, exempt: true, reason: fd.get('reason') });
      paidToast(r, a.status); reload('payment');
    });
  }));
  $$('[data-unexempt]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('ยกเลิก "ไม่ต้องชำระ" ?')) return;
    try { await api('POST', `/api/applications/${a.id}/payment-exempt`, { type: b.dataset.unexempt, exempt: false }); toast('ยกเลิกแล้ว'); reload('payment'); }
    catch (err) { toast(err.message, true); }
  }));

  // ติ๊ก "จัดทำข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้าแล้ว" ก่อน จึงใส่วันที่และปิดงานได้
  const lowForm = $('#lowForm');
  if (lowForm) {
    const cb = lowForm.elements.contract_amended; const dt = lowForm.elements.low_effective_date; const btn = $('button.btn-success', lowForm);
    const sync = () => {
      dt.disabled = !cb.checked;
      if (!cb.checked) dt.value = '';
      btn.disabled = !(cb.checked && dt.value);
      cb.closest('.paid-check').classList.toggle('on', cb.checked);
    };
    cb.addEventListener('change', () => { sync(); if (cb.checked) dt.focus(); });
    dt.addEventListener('input', sync);
    sync();
  }
  lowForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.elements.contract_amended.checked) { toast('กรุณาติ๊ก “จัดทำข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้าแล้ว” ก่อน', true); return; }
    if (!f.elements.low_effective_date.value) { toast('กรุณาระบุวันที่มีผลอัตรา Low', true); return; }
    if (!confirm(`ยืนยันว่าจัดทำข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้าแล้ว และเปลี่ยนอัตรา Low ในระบบ SAP แล้ว โดยมีผลตั้งแต่ ${fmtDate(f.elements.low_effective_date.value)} ?`)) return;
    try {
      await api('POST', `/api/applications/${a.id}/low-rate`, {
        contract_amended: true, low_effective_date: f.elements.low_effective_date.value,
      });
      toast('บันทึกแล้ว คำร้องเสร็จสมบูรณ์');
      reload();
    } catch (err) { toast(err.message, true); }
  });

  $('#editLowBtn')?.addEventListener('click', () => openDialog(`
    <h2>แก้ไขข้อมูลการเปลี่ยนอัตรา Low</h2>
    <label class="paid-check contract-check ${a.data?.contract_amended?.done ? 'on' : ''}" style="margin-bottom:14px"><input type="checkbox" name="amended" required ${a.data?.contract_amended?.done ? 'checked' : ''}>
      <span class="req">จัดทำข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้าแล้ว</span></label>
    <label class="field"><span class="req">วันที่มีผลอัตรา Low Priority</span><input type="date" name="d" value="${esc(a.low_effective_date)}" required></label>
    ${dlgActions('บันทึก')}`, async (fd) => {
    await api('POST', `/api/applications/${a.id}/low-rate`, { contract_amended: fd.get('amended') === 'on', low_effective_date: fd.get('d') });
    toast('แก้ไขแล้ว'); reload();
  }));

  $('#cancelBtn')?.addEventListener('click', () => openDialog(`
    <h2>ยกเลิกคำร้อง</h2><p class="muted">${esc(a.app_no)} · ${esc(a.station_name)}</p>
    <label class="field"><span class="req">เหตุผลการยกเลิก</span><textarea name="reason" required></textarea></label>
    ${dlgActions('ยืนยันยกเลิกคำร้อง', 'btn-danger-ghost')}`, async (fd) => {
    await api('POST', `/api/applications/${a.id}/cancel`, { reason: fd.get('reason') });
    toast('ยกเลิกคำร้องแล้ว'); reload();
  }));
}

function actionPanel(a, doneCount) {
  const missing = [1, 2, 3].filter((n) => !a.conditions[`c${n}`]);
  if (a.status === 'cancelled') {
    return `<div class="action-panel off"><span class="ico">${icon('ban', 'i-lg')}</span>
      <div class="body"><h2>คำร้องถูกยกเลิก</h2><p class="muted">${esc(a.cancelled_reason)}</p></div></div>`;
  }
  if (a.status === 'pending' && !a.payment.done) {
    const items = ['safety', 'cpo'].filter((t) => !a.payment[t].done).map((t) => a.fees[t].label);
    return `<div class="action-panel pending"><span class="ico">${icon('receipt', 'i-lg')}</span>
      <div class="body"><h2>รอลูกค้าชำระเงินค่าทดสอบ</h2>
        <p class="muted">บันทึกเลขที่คำร้องและติ๊ก “ลูกค้าชำระเงินแล้ว” ให้ครบก่อน จึงจะตรวจเงื่อนไข 1–3 ได้</p>
        <div class="todo-list">${items.map((t) => `<span class="tag">${esc(t)} · กฟส.ในพื้นที่ใช้ไฟฟ้า</span>`).join('')}</div></div></div>`;
  }
  if (a.status === 'pending') {
    return `<div class="action-panel pending"><span class="ico">${icon('clock', 'i-lg')}</span>
      <div class="body"><h2>ชำระเงินครบแล้ว · รอเงื่อนไขอีก ${3 - doneCount} ข้อ</h2>
        <div class="todo-list">${missing.map((n) => `<span class="tag">${n}. ${esc(CONDITIONS[n].short)} · ${esc(CONDITIONS[n].who)}</span>`).join('')}</div></div></div>`;
  }
  if (a.status === 'ready' && !a.permissions.record_low) {
    return `<div class="action-panel ready"><span class="ico">${icon('zap', 'i-lg')}</span>
      <div class="body"><h2>ครบเงื่อนไขทั้ง 3 ข้อแล้ว</h2>
      <p class="muted">รอ ${esc(a.office)} เปลี่ยนอัตรา Low ในระบบ SAP · ครบเงื่อนไขเมื่อ ${fmtDateTime(a.ready_at)}</p></div></div>`;
  }
  if (a.status === 'ready') {
    return `<form class="action-panel ready" id="lowForm"><span class="ico">${icon('zap', 'i-lg')}</span>
      <div class="body"><h2>ครบเงื่อนไขทั้ง 3 ข้อแล้ว · เปลี่ยนอัตรา Low ในระบบ SAP</h2>
        <p class="muted">ครบเงื่อนไขเมื่อ ${fmtDateTime(a.ready_at)} · เปลี่ยนอัตราใน SAP แล้วบันทึกวันที่มีผลด้านล่างเพื่อปิดงาน</p>
        <div class="sap-form">
          <label class="paid-check contract-check"><input type="checkbox" name="contract_amended">
            <span><span class="req">จัดทำข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้าแล้ว</span><small>ติ๊กก่อน จึงจะใส่วันที่มีผลอัตรา Low ได้</small></span></label>
          <label class="field"><span class="req">วันที่มีผลอัตรา Low Priority</span><input type="date" name="low_effective_date" required disabled></label>
          <button class="btn btn-success" disabled>${icon('check')}บันทึก · ปิดงาน</button>
        </div></div></form>`;
  }
  return `<div class="action-panel done"><span class="ico">${icon('checkCircle', 'i-lg')}</span>
    <div class="body"><h2>ได้รับอัตรา Low Priority แล้ว · มีผลตั้งแต่ ${fmtDate(a.low_effective_date)}</h2>
      <p class="muted">${a.data?.contract_amended?.done ? 'จัดทำข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้าแล้ว · ' : ''}${a.low_letter_no ? `หนังสือเปลี่ยนอัตรา ${esc(a.low_letter_no)} · ` : ''}${a.sap_recorded_by_name ? `บันทึกโดย ${esc(a.sap_recorded_by_name)} · ${fmtDateTime(a.completed_at)}` : 'นำเข้าจาก Excel'}${a.sap_note ? ` · ${esc(a.sap_note)}` : ''}</p></div>
    ${a.permissions.record_low ? `<button class="btn btn-sm no-print" id="editLowBtn">${icon('edit', 'i-sm')}แก้ไข</button>` : ''}</div>`;
}

function evidenceItem(t) {
  const kind = t.has_file ? 'file' : t.url ? 'link' : 'doc';
  const title = t.has_file ? t.original_name : t.doc_no || (t.url ? linkLabel(t.url) : '') || t.note || 'หลักฐาน';
  const href = t.has_file ? `/api/attachments/${t.id}?inline=1` : t.url;
  const meta = [
    t.doc_no && t.doc_no !== title ? `เลขที่ ${esc(t.doc_no)}` : '',
    t.doc_date ? `ลงวันที่ ${fmtDate(t.doc_date)}` : '',
    t.has_file ? fmtSize(t.size) : '',
    t.uploaded_by_name ? `${esc(t.uploaded_by_name)} · ${fmtDateTime(t.uploaded_at)}` : '',
  ].filter(Boolean);
  return `<li class="ev">
    <span class="ev-ico">${icon(kind === 'file' ? 'file' : kind === 'link' ? 'link' : t.condition_no === 1 && !t.doc_no ? 'badge' : 'doc')}</span>
    <div class="ev-main">
      <div class="t">${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(title)}</a>` : esc(title)}</div>
      <div class="m">${resultPill(t.result)}${meta.map((m) => `<span>${m}</span>`).join('')}</div>
      ${t.note && t.note !== title ? `<div class="small" style="margin-top:4px">${esc(t.note)}</div>` : ''}
    </div>
    <div class="ev-actions no-print">
      ${t.drive_url ? `<a class="btn btn-ghost btn-icon" href="${esc(t.drive_url)}" target="_blank" rel="noopener" title="เปิดใน Google Drive">${icon('cloud', 'i-sm')}</a>` : ''}
      ${href ? `<a class="btn btn-ghost btn-icon" href="${esc(t.has_file ? `/api/attachments/${t.id}` : t.url)}" ${t.has_file ? '' : 'target="_blank" rel="noopener"'} title="${t.has_file ? 'ดาวน์โหลด' : 'เปิดลิงก์'}">${icon(t.has_file ? 'download' : 'external', 'i-sm')}</a>` : ''}
      ${t.can_delete ? `<button class="btn btn-ghost btn-icon" data-del-att="${t.id}" data-name="${esc(title)}" title="ลบ">${icon('trash', 'i-sm')}</button>` : ''}
    </div>
  </li>`;
}

// n = 0 แบบฟอร์มคำร้อง (PDF) · 1–3 เงื่อนไข · 4 ผลการตรวจวัดทดสอบความปลอดภัย
function conditionBlock(a, n) {
  const list = a.attachments.filter((t) => t.condition_no === n);
  const st = condState(a, n);
  const isForm = n === 0;
  const isCond = n >= 1 && n <= 3;
  const canUp = a.permissions.upload[n];
  const pill = isForm
    ? (st === 'none' ? `<span class="pill st-none">${icon('clock')}ยังไม่มีไฟล์</span>` : `<span class="pill st-pass">${icon('check')}มีไฟล์แล้ว</span>`)
    : st === 'met' ? `<span class="pill st-pass">${icon('check')}${isCond ? 'ครบ' : 'มีผลแล้ว'}</span>`
      : st === 'failed' ? `<span class="pill st-fail">${icon('x')}ยังไม่ผ่าน</span>`
        : `<span class="pill st-none">${icon('clock')}${isCond ? 'ยังไม่มีหลักฐาน' : 'ยังไม่มีผล'}</span>`;
  const addLabel = isForm ? 'แนบไฟล์คำร้อง' : n === 4 ? 'เพิ่มผลการทดสอบ' : 'เพิ่มหลักฐาน';
  let foot = '';
  if (canUp) {
    foot = `<div class="cond-foot no-print">
      <button class="btn btn-sm" data-open-ev="${n}">${icon(isForm ? 'upload' : 'plus', 'i-sm')}${addLabel}</button>
      <form class="ev-form" id="evf${n}" data-cond="${n}" hidden>
        ${isForm ? '' : `<div class="row" style="justify-content:space-between">
          <div class="choice"><label><input type="radio" name="kind" value="file" checked>${icon('upload', 'i-sm')}แนบไฟล์</label>
            <label><input type="radio" name="kind" value="link">${icon('link', 'i-sm')}ลิงก์ / เลขที่หนังสือ</label></div>
          <div class="choice"><label class="pass"><input type="radio" name="result" value="pass" checked>${icon('check', 'i-sm')}ผ่าน</label>
            <label class="fail"><input type="radio" name="result" value="fail">${icon('x', 'i-sm')}ไม่ผ่าน</label></div>
        </div>`}
        <div class="k-file"><input type="file" name="files" ${isForm ? 'accept="application/pdf,.pdf"' : 'multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.zip"'} aria-label="เลือกไฟล์"></div>
        ${isForm ? '' : `<div class="k-link"><input type="url" name="url" placeholder="https://drive.google.com/…" aria-label="ลิงก์เอกสาร"></div>
        <div class="grid g3">
          <label class="field"><span>เลขที่หนังสือ</span><input type="text" name="doc_no"></label>
          <label class="field"><span>วันที่หนังสือ</span><input type="date" name="doc_date"></label>
          <label class="field"><span>หมายเหตุ</span><input type="text" name="note" ${n === 4 ? 'placeholder="เช่น IEC 60364-6 ผ่าน · IEC 61851 ผ่าน"' : ''}></label>
        </div>`}
        <div class="row" style="justify-content:flex-end">
          <button type="button" class="btn btn-sm btn-ghost" data-close-ev="${n}">ยกเลิก</button>
          <button type="submit" class="btn btn-sm btn-primary">${icon('check', 'i-sm')}บันทึก</button>
        </div>
      </form></div>`;
  } else if (isCond && a.status === 'pending' && !a.payment.done) {
    foot = `<div class="cond-foot"><span class="locked">${icon('receipt', 'i-sm')}บันทึกได้หลังชำระค่าทดสอบครบ · ผู้บันทึก: ${esc(CONDITIONS[n].who)}</span></div>`;
  } else if (a.status === 'pending' || a.status === 'ready') {
    foot = `<div class="cond-foot"><span class="locked">${icon('info', 'i-sm')}ผู้บันทึก: ${esc(CONDITIONS[n].who)}</span></div>`;
  }
  return `<article class="cond ${isForm ? (st === 'none' ? '' : 'met') : st}">
    <div class="cond-head">
      <span class="cond-no">${isCond ? (st === 'met' ? icon('check', 'i-sm') : n) : icon(isForm ? 'file' : 'flask', 'i-sm')}</span>
      <div class="cond-title"><h3>${esc(CONDITIONS[n].title)}</h3><span class="by">${icon('user', 'i-sm')}${esc(CONDITIONS[n].who)}</span></div>
      ${pill}
    </div>
    <ul class="ev-list">${list.length ? list.map(evidenceItem).join('') : `<li class="ev-none">${isForm ? 'ยังไม่ได้แนบไฟล์คำร้อง' : 'ยังไม่มีข้อมูล'}</li>`}</ul>
    ${foot || '<div style="height:6px"></div>'}
  </article>`;
}

// ค่าทดสอบ 1 รายการ: เลขที่คำร้อง + ติ๊ก "ลูกค้าชำระเงินแล้ว" (หรือระบุว่าไม่ต้องชำระ)
function invoiceBlock(a, type) {
  const fee = a.fees[type];
  const st = a.payment[type];
  const list = a.invoices.filter((i) => i.type === type);
  const total = list.reduce((s, i) => s + i.amount, 0);
  const unpaid = list.filter((i) => !i.paid).reduce((s, i) => s + i.amount, 0);
  const canPay = a.permissions.payment;
  const pill = st.exempt ? `<span class="pill st-none">${icon('ban')}ไม่ต้องชำระ</span>`
    : st.done ? `<span class="pill st-pass">${icon('check')}ชำระครบแล้ว</span>`
      : list.length ? `<span class="pill st-pending">${icon('clock')}ค้างชำระ ${fmtNum(unpaid)} บาท</span>`
        : `<span class="pill st-none">${icon('clock')}ยังไม่บันทึก</span>`;
  return `<article class="cond pay ${st.done ? 'met' : ''}">
    <div class="cond-head">
      <span class="cond-no">${st.done ? icon('check', 'i-sm') : icon('receipt', 'i-sm')}</span>
      <div class="cond-title"><h3>${esc(fee.label)}</h3>
        <span class="by">${fee.prices.map((p) => fmtNum(p)).join(' หรือ ')} บาท / ${esc(fee.unit)}</span></div>
      ${pill}
    </div>
    <ul class="ev-list">
      ${st.exempt ? `<li class="ev"><span class="ev-ico">${icon('ban')}</span><div class="ev-main"><div class="t">ไม่ต้องชำระ${esc(fee.label)}</div>
        <div class="m"><span>${esc(st.reason)}</span></div></div>
        ${canPay ? `<div class="ev-actions no-print"><button class="btn btn-sm btn-ghost" data-unexempt="${type}">ยกเลิก</button></div>` : ''}</li>` : ''}
      ${list.map((i) => `<li class="ev">
      <span class="ev-ico">${icon('receipt')}</span>
      <div class="ev-main">
        <div class="t">เลขที่คำร้อง <span class="mono">${esc(i.request_no)}</span></div>
        <div class="m"><span>${fmtNum(i.units)} ${esc(fee.unit)} × ${fmtNum(i.unit_price)} บาท</span>
          <strong class="amount">${fmtNum(i.amount)} บาท</strong>
          ${i.issued_date ? `<span>วันที่ ${fmtDate(i.issued_date)}</span>` : ''}
          <span>${esc(i.created_by_name || '')}</span></div>
        ${i.note ? `<div class="small" style="margin-top:4px">${esc(i.note)}</div>` : ''}
        <label class="paid-check ${i.paid ? 'on' : ''}">
          <input type="checkbox" data-pay-inv="${i.id}" data-no="${esc(i.request_no)}" ${i.paid ? 'checked' : ''} ${canPay ? '' : 'disabled'}>
          <span>${i.paid ? `ลูกค้าชำระเงินแล้ว · ${fmtDate(i.paid_date)}` : 'ลูกค้าชำระเงินแล้ว'}</span>
        </label>
      </div>
      ${i.can_delete ? `<div class="ev-actions no-print"><button class="btn btn-ghost btn-icon" data-del-inv="${i.id}" data-no="${esc(i.request_no)}" title="ลบ">${icon('trash', 'i-sm')}</button></div>` : ''}
    </li>`).join('')}
      ${!list.length && !st.exempt ? `<li class="ev-none">ยังไม่บันทึกเลขที่คำร้อง${a.data.y3 ? ` · ข้อมูลจาก Excel: ${esc(a.data.y3)}` : ''}</li>` : ''}
    </ul>
    ${list.length > 1 ? `<div class="cond-foot small">รวม <strong>${fmtNum(total)} บาท</strong></div>` : ''}
    ${a.permissions.invoice ? `<div class="cond-foot no-print row">
      <button class="btn btn-sm" data-invoice="${type}">${icon('plus', 'i-sm')}บันทึกเลขที่คำร้อง</button>
      ${canPay && !st.exempt ? `<button class="btn btn-sm btn-ghost" data-exempt="${type}">ไม่ต้องชำระ</button>` : ''}</div>` : '<div style="height:6px"></div>'}
  </article>`;
}

function invoiceDialog(a, type, done) {
  const fee = a.fees[type];
  const chargerQty = (a.data.chargers || []).reduce((s, c) => s + (Number(c.qty) || 0), 0);
  const defUnits = type === 'safety' ? Math.max(1, chargerQty) : 1;
  const form = openDialog(`
    <h2>บันทึกเลขที่คำร้อง${esc(fee.label)}</h2>
    <p class="muted">${esc(a.app_no)} · ${esc(a.station_name)}</p>
    <label class="field"><span class="req">เลขที่คำร้อง (12 หลัก)</span>
      <input type="text" name="request_no" inputmode="numeric" maxlength="12" pattern="\\d{12}" required placeholder="เช่น 130001588018" autocomplete="off"></label>
    <div class="grid g2">
      <label class="field"><span class="req">จำนวน${esc(fee.unit)}</span><input type="number" name="units" min="1" max="999" step="1" value="${defUnits}" required></label>
      <div class="field"><span>อัตรา (บาท/${esc(fee.unit)})</span>
        ${fee.prices.length > 1
          ? `<div class="choice">${fee.prices.map((p, i) => `<label><input type="radio" name="unit_price" value="${p}" ${i === 0 ? 'checked' : ''}>${fmtNum(p)}</label>`).join('')}</div>`
          : `<input type="text" value="${fmtNum(fee.prices[0])}" disabled><input type="hidden" name="unit_price" value="${fee.prices[0]}">`}</div>
    </div>
    ${type === 'safety' && chargerQty ? `<p class="hint">ตามคำร้องมีเครื่องอัดประจุ ${fmtNum(chargerQty)} เครื่อง</p>` : ''}
    <label class="field"><span>วันที่</span><input type="date" name="issued_date" value="${todayISO()}"></label>
    <label class="field"><span>หมายเหตุ</span><input type="text" name="note"></label>
    <div class="inv-total">จำนวนเงินรวม <strong id="invTotal">–</strong></div>
    ${dlgActions('บันทึกเลขที่คำร้อง')}`, async (fd) => {
    await api('POST', `/api/applications/${a.id}/invoices`, {
      type, request_no: fd.get('request_no'), units: Number(fd.get('units')), unit_price: Number(fd.get('unit_price')),
      issued_date: fd.get('issued_date'), note: fd.get('note'),
    });
    toast('บันทึกเลขที่คำร้องแล้ว');
    done();
  });
  const upd = () => {
    const fd = new FormData(form);
    const total = (Number(fd.get('units')) || 0) * (Number(fd.get('unit_price')) || 0);
    $('#invTotal', form).textContent = `${fmtNum(total)} บาท`;
  };
  form.addEventListener('input', upd);
  form.addEventListener('change', upd);
  form.elements.request_no.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 12); });
  upd();
}

function renderReadonly(a) {
  const d = a.data;
  const dash = '<span class="faint">–</span>';
  const kv = (pairs) => `<dl class="kv">${pairs.filter(([, , show = true]) => show).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v || dash}</dd></div>`).join('')}</dl>`;
  const docLabels = DOC_GROUPS.flatMap((g) => g.items).filter(([k]) => (d.documents || []).includes(k)).map(([, t]) => t);
  const revLabels = REVENUE.filter(([k]) => (d.revenue || []).includes(k)).map(([k, t]) => (k === 'other' ? `อื่นๆ: ${d.revenue_other}` : t));
  const channels = (d.charge_channels || []).map((c) => (c === 'อื่นๆ' ? `อื่นๆ: ${d.channel_other}` : c));
  const map = a.lat != null && a.lng != null
    ? `${esc(a.lat)}, ${esc(a.lng)} · <a href="https://www.google.com/maps?q=${encodeURIComponent(`${a.lat},${a.lng}`)}" target="_blank" rel="noopener">เปิดแผนที่</a>` : '';
  const table = (head, rows) => `<table class="mini"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}" class="faint">ไม่มีข้อมูล</td></tr>`}</tbody></table>`;
  const noData = '<p class="faint">ไม่มีข้อมูลในไฟล์ที่นำเข้า</p>';
  const sec = (no, title, body) => `<div class="ro-sec"><h3><span class="sec-no">${no}</span>${esc(title)}</h3>${body}</div>`;
  return `<div class="ro">
    ${d.imported ? `<div class="note-box">${icon('info')}<span>นำเข้าจากไฟล์ ${esc(d.import_file)} แถวที่ ${esc(d.import_row)} · ข้อมูลบางส่วนของแบบฟอร์ม (เช่น ข้อ 2, 3, 7) ไม่มีในไฟล์ต้นทาง</span></div>` : ''}
    ${sec('ก', 'ผู้ขอใช้ไฟฟ้าและสถานี', kv([
      ['ชื่อสถานี', esc(a.station_name)], ['ผู้ขอใช้ไฟฟ้า', `${esc(a.applicant_name)}${d.applicant_type ? ` <span class="faint">(${esc(lookup(APPLICANT_TYPES, d.applicant_type))})</span>` : ''}`],
      ['ชื่อย่อบริษัท / แบรนด์', esc(a.company)],
      ['กฟส.ในพื้นที่ใช้ไฟฟ้า', esc(a.office)], ['กฟข.', esc(regionLabel(a.region))],
      ['อำเภอ / จังหวัด', esc([a.district, a.province].filter(Boolean).join(' / '))], ['ที่อยู่สถานี', esc(a.station_address)],
      ['ผู้ติดต่อ', esc(a.contact_name)], ['โทรศัพท์ / Email', esc([a.phone, a.email].filter(Boolean).join(' · '))],
      ['รับคำร้องโดย', esc(d.received_by), !!d.received_by],
      ['บันทึกโดย', a.created_by_name ? `${esc(a.created_by_name)} · ${fmtDateTime(a.created_at)}` : '', !!a.created_by_name]]))}
    ${sec('ข', 'ข้อมูลผู้ใช้ไฟฟ้า (SAP)', kv([['Contract Account (CA)', esc(a.ca_no)], ['Meter No. / PEA No.', esc(a.meter_no)]]))}
    ${sec('1', 'พื้นที่ตั้งสถานี', d.location_type ? esc(d.location_type === 'อื่นๆ' ? `อื่นๆ: ${d.location_other}` : d.location_type) : (d.imported ? noData : dash))}
    ${sec('2', 'คุณลักษณะของสถานี (ต้องมีครบทุกข้อ)', d.criteria ? `<ul class="ticks">${CRITERIA.map((c, i) => `<li class="${d.criteria[i] ? '' : 'no'}">${icon(d.criteria[i] ? 'check' : 'x', 'i-sm')}<span>${esc(c)}${i === CHANNEL_CRITERION && channels.length ? ` — <strong>${esc(channels.join(', '))}</strong>` : ''}</span></li>`).join('')}</ul>` : noData)}
    ${sec('3–4', 'เวลาให้บริการและพิกัด', kv([
      ['เปิดให้บริการ', d.service_hours === '24' ? 'บริการ 24 ชั่วโมง' : d.service_hours === 'lt24' ? 'บริการไม่ถึง 24 ชั่วโมง' : ''],
      ['พิกัด (Lat, Long)', map]]))}
    ${sec('5', 'เครื่องอัดประจุไฟฟ้า', `${table(['ที่', 'ยี่ห้อ', 'รุ่น', 'พิกัด (kW)', 'จำนวน'], (d.chargers || []).map((r, i) => [i + 1, r.brand, r.model, fmtNum(r.kw), fmtNum(r.qty)]))}
      <div class="totals" style="margin-top:10px"><span class="total-pill">รวม ${fmtNum(a.total_kw)} kW · ${fmtNum(a.total_kva)} kVA</span></div>`)}
    ${(d.equipment || []).length ? sec('6', 'อุปกรณ์ไฟฟ้าอื่นๆ', `${table(['ที่', 'ชนิดของอุปกรณ์', 'พิกัด (kW)', 'จำนวน'], d.equipment.map((r, i) => [i + 1, r.type, fmtNum(r.kw), fmtNum(r.qty)]))}
      <div class="totals" style="margin-top:10px"><span class="total-pill">รวม ${fmtNum(d.equipment_total_kw)} kW</span></div>`) : ''}
    ${sec('7', 'การจัดเก็บรายได้', revLabels.length ? `<ul class="ticks">${revLabels.map((t) => `<li>${icon('check', 'i-sm')}<span>${esc(t)}</span></li>`).join('')}</ul>` : (d.imported ? noData : dash))}
    ${sec('8', 'ระบบ CPO', kv([
      ['ชื่อระบบให้บริการ / Platform', esc(d.cpo?.system_name)], ['ผู้ให้บริการ', esc(d.cpo?.provider)],
      ['โทรศัพท์ / Email', esc([d.cpo?.phone, d.cpo?.email].filter(Boolean).join(' · ')), !d.imported]]))}
    ${docLabels.length || d.documents_other ? sec('8', 'หลักฐานประกอบการขอใช้ไฟฟ้า', `<ul class="ticks">${docLabels.map((t) => `<li>${icon('check', 'i-sm')}<span>${esc(t)}</span></li>`).join('')}</ul>
      ${d.documents_other ? `<p style="margin-top:8px">อื่นๆ: ${esc(d.documents_other)}</p>` : ''}`) : ''}
    ${sec('9', 'การตรวจสอบและทดสอบ', d.test_60364 || d.test_61851 || d.remark ? kv([
      ['9.1 ผู้ดำเนินการ IEC 60364-6', esc(lookup(TEST_60364, d.test_60364))],
      ['9.2 IEC 61851', esc(lookup(TEST_61851, d.test_61851))],
      ['หมายเหตุ', esc(d.remark), !!d.remark]])
      : `<p class="faint">${d.imported ? 'ไม่มีข้อมูลในไฟล์ที่นำเข้า · ' : ''}ผลการตรวจวัดทดสอบความปลอดภัยอยู่ที่แท็บ “ค่าทดสอบและผลความปลอดภัย”</p>`)}
  </div>`;
}

// ============================================================ users (admin)
// ============================================================ เอกสารหลักฐานที่เกี่ยวข้อง
const DOC_CATS = [
  ['intake', 'รับคำร้องขอใช้ไฟฟ้า', 'แบบฟอร์มที่ผู้ขอใช้ไฟฟ้ากรอกและแนบตอนยื่นคำร้อง'],
  ['conditions', 'ตรวจสอบเงื่อนไข 1–3', 'แบบฟอร์มตรวจสอบการติดตั้งระบบอัดประจุยานยนต์ไฟฟ้าก่อนติดตั้งมิเตอร์ และเอกสารประกอบเงื่อนไข'],
  ['safety', 'ทดสอบความปลอดภัย', 'มาตรฐานและแบบฟอร์มผลการตรวจวัดทดสอบความปลอดภัย'],
  ['contract', 'เปลี่ยนอัตรา Low Priority / สัญญา', 'ข้อตกลงแก้ไขเพิ่มเติมสัญญาซื้อขายไฟฟ้า (ทำก่อนบันทึกวันที่มีผลอัตรา Low)'],
  ['rules', 'ระเบียบ / ประกาศ / หนังสือสั่งการ', 'หลักเกณฑ์และอัตราค่าไฟฟ้า Low Priority'],
  ['other', 'อื่นๆ', ''],
];
const docExt = (name) => (String(name).split('.').pop() || '').toUpperCase().slice(0, 4);

async function renderDocuments() {
  const u = state.user;
  const seq = routeSeq;
  const docs = await api('GET', '/api/documents');
  if (isStale(seq)) return;
  setCrumbs([['เอกสารหลักฐานที่เกี่ยวข้อง', '#/docs']]);
  const admin = u.role === 'admin';
  const groups = DOC_CATS.map(([k, t, d]) => ({ k, t, d, list: docs.filter((x) => x.category === k) })).filter((g) => g.list.length);
  const item = (x) => {
    const viewable = /^(application\/pdf|image\/(png|jpeg))$/.test(x.mime || '');
    return `<li class="doc-item">
      <span class="doc-ext ${docExt(x.original_name) === 'PDF' ? 'pdf' : ''}">${esc(docExt(x.original_name) || 'FILE')}</span>
      <div class="doc-main">
        <div class="t">${viewable ? `<a href="/api/documents/${x.id}/file?inline=1" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}</div>
        ${x.description ? `<div class="d">${esc(x.description)}</div>` : ''}
        <div class="m"><span>${esc(x.original_name)}</span><span>${fmtSize(x.size || 0)}</span>${admin ? `<span>เพิ่มเมื่อ ${fmtDateTime(x.uploaded_at)}</span>` : ''}</div>
      </div>
      <div class="doc-actions">
        ${viewable ? `<a class="btn btn-sm" href="/api/documents/${x.id}/file?inline=1" target="_blank" rel="noopener">${icon('external', 'i-sm')}เปิดดู</a>` : ''}
        <a class="btn btn-sm btn-primary" href="/api/documents/${x.id}/file">${icon('download', 'i-sm')}ดาวน์โหลด</a>
        ${admin ? `<button class="btn btn-ghost btn-icon" data-edit-doc="${x.id}" title="แก้ไข" aria-label="แก้ไข">${icon('edit', 'i-sm')}</button>
          <button class="btn btn-ghost btn-icon" data-del-doc="${x.id}" title="ลบ" aria-label="ลบ">${icon('trash', 'i-sm')}</button>` : ''}
      </div>
    </li>`;
  };

  view().innerHTML = `
    <div class="page-head">
      <div><h1>เอกสารหลักฐานที่เกี่ยวข้อง</h1>
        <p>แบบฟอร์ม ข้อตกลง และระเบียบที่ใช้ในงาน EV Low Priority · ทุกคนเปิดดูและดาวน์โหลดได้</p></div>
      ${admin ? `<div class="row"><button class="btn btn-primary" id="addDocBtn">${icon('plus')}เพิ่มเอกสาร</button></div>` : ''}
    </div>
    ${groups.length ? groups.map((g) => `
      <section class="card doc-sec">
        <div class="card-head"><h2>${icon('folder')}${esc(g.t)}</h2>${g.d ? `<span class="muted small">${esc(g.d)}</span>` : ''}</div>
        <ul class="doc-list">${g.list.map(item).join('')}</ul>
      </section>`).join('')
    : `<div class="card"><div class="empty">${icon('folder')}<div>ยังไม่มีเอกสาร</div>
        ${admin ? '<p class="muted small">กด “เพิ่มเอกสาร” เพื่ออัปโหลดแบบฟอร์มหรือระเบียบที่ทีมต้องใช้</p>' : ''}</div></div>`}`;

  const reload = () => renderDocuments().catch((err) => toast(err.message, true));
  const docDialog = (d) => {
    const form = openDialog(`
      <h2>${d ? 'แก้ไขเอกสาร' : 'เพิ่มเอกสาร'}</h2>
      ${d ? `<p class="muted small">${esc(d.original_name)}</p>` : `<label class="field"><span class="req">ไฟล์</span>
        <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.zip"></label>`}
      <label class="field"><span class="req">ชื่อเอกสาร</span><input type="text" name="title" required maxlength="300" value="${esc(d?.title)}"
        placeholder="เช่น แบบฟอร์มตรวจสอบการติดตั้งระบบอัดประจุยานยนต์ไฟฟ้า (แรงต่ำ)"></label>
      <label class="field"><span>หมวด</span><select name="category">${DOC_CATS.map(([k, t]) => `<option value="${k}" ${(d?.category || 'other') === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="field"><span>คำอธิบาย</span><textarea name="description" rows="2" maxlength="1000" placeholder="เช่น ใช้เมื่อผู้ใช้ไฟฟ้ารับไฟแรงต่ำจากหม้อแปลงของ กฟภ.">${esc(d?.description)}</textarea></label>
      <label class="field"><span>ลำดับการแสดง</span><input type="number" name="sort" step="1" value="${esc(d?.sort ?? 0)}"></label>
      ${dlgActions(d ? 'บันทึก' : 'อัปโหลด')}`, async (fd) => {
      if (d) {
        await api('PUT', `/api/documents/${d.id}`, Object.fromEntries(['title', 'category', 'description', 'sort'].map((k) => [k, fd.get(k)])));
        toast('บันทึกแล้ว');
      } else {
        if (!fd.get('file')?.size) throw new Error('กรุณาเลือกไฟล์');
        await api('POST', '/api/documents', fd);
        toast('เพิ่มเอกสารแล้ว');
      }
      reload();
    });
    // เลือกไฟล์แล้วเติมชื่อเอกสารจากชื่อไฟล์ให้ (ถ้ายังว่าง)
    const fileInput = $('input[name=file]', form);
    fileInput?.addEventListener('change', () => {
      const t = form.elements.title;
      if (!t.value && fileInput.files[0]) t.value = fileInput.files[0].name.replace(/\.[^.]+$/, '');
    });
  };
  $('#addDocBtn')?.addEventListener('click', () => docDialog(null));
  $$('[data-edit-doc]').forEach((b) => b.addEventListener('click', () => docDialog(docs.find((x) => x.id === Number(b.dataset.editDoc)))));
  $$('[data-del-doc]').forEach((b) => b.addEventListener('click', async () => {
    const d = docs.find((x) => x.id === Number(b.dataset.delDoc));
    if (!confirm(`ลบเอกสาร "${d.title}" ?`)) return;
    try { await api('DELETE', `/api/documents/${d.id}`); toast('ลบแล้ว'); reload(); } catch (err) { toast(err.message, true); }
  }));
}

async function renderUsers() {
  if (state.user.role !== 'admin') throw new Error('ไม่มีสิทธิ์เข้าถึง');
  const seq = routeSeq;
  const [users] = await Promise.all([api('GET', '/api/users'), loadLookups()]);
  if (isStale(seq)) return;
  setCrumbs([['ผู้ใช้งาน']]);
  view().innerHTML = `
    <div class="page-head"><div><h1>ผู้ใช้งาน</h1><p>ทุกบทบาทดูคำร้องได้ทั้งหมด แต่บันทึกได้เฉพาะพื้นที่ตนเอง · กฟส.ในพื้นที่ใช้ไฟฟ้า: คำร้องของ กฟส. ตน · กบล. กฟข.: คำร้องใน กฟข. ตน · กทฟ.: เงื่อนไขที่ 3</p></div>
      <button class="btn btn-primary" id="addUser">${icon('plus')}เพิ่มผู้ใช้</button></div>
    <div class="card"><div class="table-wrap"><table class="tbl">
      <thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>การไฟฟ้า / หน่วยงาน</th><th>Email</th><th>สถานะ</th></tr></thead>
      <tbody>${users.map((x) => `<tr data-uid="${x.id}">
        <td><div class="cell-station" style="min-width:200px"><span class="avatar round">${icon('user', 'i-sm')}</span>
          <div><div class="t">${esc(x.display_name)}</div><div class="s mono">${esc(x.username)}</div></div></div></td>
        <td><span class="tag ${x.role === 'admin' ? 'brand' : ''}">${esc(ROLE_LABEL[x.role])}</span></td>
        <td>${esc(x.role === 'region' ? regionLabel(x.office) : x.office || '–')}</td><td>${esc(x.email || '–')}</td>
        <td>${x.active ? `<span class="pill st-pass">${icon('check')}ใช้งาน</span>` : `<span class="pill st-none">${icon('ban')}ปิดใช้งาน</span>`}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
  $('#addUser').addEventListener('click', () => userDialog(null));
  $$('tr[data-uid]').forEach((tr) => tr.addEventListener('click', () => userDialog(users.find((x) => x.id === Number(tr.dataset.uid)))));
}

function userDialog(x) {
  const L = state.lookups;
  const form = openDialog(`
    <h2>${x ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'}</h2>${x ? `<p class="muted mono">${esc(x.username)}</p>` : ''}
    ${x ? '' : '<label class="field"><span class="req">ชื่อผู้ใช้ (ภาษาอังกฤษ)</span><input type="text" name="username" required></label>'}
    <label class="field"><span class="req">ชื่อที่แสดง</span><input type="text" name="display_name" value="${esc(x?.display_name)}" required></label>
    <div class="grid g2">
      <label class="field"><span class="req">บทบาท</span><select name="role" id="uRole">${Object.entries(ROLE_LABEL).map(([k, v]) =>
        `<option value="${k}" ${x?.role === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label class="field" data-for-role="field"><span class="req">กฟส. ที่สังกัด</span><select name="office">
        <option value="">เลือก กฟส.</option>${officeOptions(L.offices, x?.role === 'field' ? x.office : '')}</select></label>
      <label class="field" data-for-role="region"><span class="req">กฟข. ที่สังกัด</span><select name="office">
        <option value="">เลือก กฟข.</option>${L.regions.map((r) => `<option value="${esc(r)}" ${x?.role === 'region' && x.office === r ? 'selected' : ''}>${esc(regionLabel(r))}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Email</span><input type="email" name="email" value="${esc(x?.email)}"></label>
    <label class="field"><span class="${x ? '' : 'req'}">${x ? 'ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน'}</span><input type="password" name="password" autocomplete="new-password" ${x ? '' : 'required'}></label>
    ${x ? `<label class="check"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}><span>เปิดใช้งาน</span></label>` : ''}
    <p class="hint">ไม่พบ กฟส. ในรายการ? เพิ่มได้ที่เมนู “การไฟฟ้า (กฟส.)”</p>
    ${dlgActions('บันทึก')}`, async (fd) => {
    const body = Object.fromEntries(fd.entries());
    if (x) {
      body.active = fd.get('active') === 'on';
      await api('PUT', `/api/users/${x.id}`, body);
    } else {
      await api('POST', '/api/users', body);
    }
    toast('บันทึกผู้ใช้แล้ว');
    renderUsers();
  });
  // แสดงช่อง กฟส./กฟข. ตามบทบาท (ช่องที่ซ่อนจะ disabled เพื่อไม่ส่งค่า)
  const syncRole = () => {
    const role = $('#uRole', form).value;
    $$('[data-for-role]', form).forEach((el) => {
      const on = el.dataset.forRole === role;
      el.hidden = !on;
      $('select', el).disabled = !on;
    });
  };
  $('#uRole', form).addEventListener('change', syncRole);
  syncRole();
}

// ============================================================ offices (รายชื่อ กฟส. — admin)
async function renderOffices() {
  if (state.user.role !== 'admin') throw new Error('ไม่มีสิทธิ์เข้าถึง');
  const seq = routeSeq;
  const [offices] = await Promise.all([api('GET', '/api/offices'), loadLookups()]);
  if (isStale(seq)) return;
  setCrumbs([['การไฟฟ้า (กฟส.)']]);
  const L = state.lookups;
  const byRegion = Object.fromEntries(L.regions.map((r) => [r, offices.filter((o) => o.region === r)]));
  view().innerHTML = `
    <div class="page-head"><div><h1>การไฟฟ้า (กฟส.ในพื้นที่ใช้ไฟฟ้า)</h1>
      <p>รายชื่อ กฟส. และ กฟข. ที่สังกัด ใช้ในแบบฟอร์มรับคำร้องและการกำหนดสิทธิ์ผู้ใช้ · ทั้งหมด ${fmtNum(offices.length)} แห่ง</p></div>
      <div class="row"><button class="btn" id="bulkBtn">${icon('upload')}วางรายชื่อจาก Excel</button>
        <button class="btn btn-primary" id="addOffice">${icon('plus')}เพิ่ม กฟส.</button></div></div>
    <div class="region-grid">${L.regions.map((r) => `<button class="region-chip ${byRegion[r].length ? '' : 'empty'}" data-jump-region="${esc(r)}">
      <strong>${esc(regionLabel(r))}</strong><span>${fmtNum(byRegion[r].length)} กฟส.</span></button>`).join('')}</div>
    <div class="card">
      <div class="toolbar"><div class="input-icon" style="margin-left:0;max-width:none">${icon('search')}<input type="search" id="oq" placeholder="ค้นหา กฟส."></div></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>กฟส.ในพื้นที่ใช้ไฟฟ้า</th><th>กฟข.</th><th class="r">คำร้อง</th><th class="r">ผู้ใช้</th><th>สถานะ</th></tr></thead>
        <tbody id="officeBody"></tbody>
      </table></div>
    </div>`;
  const draw = () => {
    const q = ($('#oq').value || '').trim();
    const list = offices.filter((o) => !q || o.name.includes(q) || regionLabel(o.region).includes(q));
    $('#officeBody').innerHTML = list.length ? list.map((o) => `<tr data-oid="${o.id}" class="no-link" id="o-${o.id}">
      <td><strong>${esc(o.name)}</strong></td>
      <td><select class="o-region" aria-label="กฟข. ของ ${esc(o.name)}" style="min-width:120px">${L.regions.map((r) =>
        `<option value="${esc(r)}" ${r === o.region ? 'selected' : ''}>${esc(regionLabel(r))}</option>`).join('')}</select></td>
      <td class="r">${fmtNum(o.app_count)}</td><td class="r">${fmtNum(o.user_count)}</td>
      <td><button class="btn btn-sm o-toggle">${o.active ? `${icon('check', 'i-sm')}ใช้งาน` : `${icon('ban', 'i-sm')}ปิดใช้งาน`}</button></td>
    </tr>`).join('') : `<tr><td colspan="5"><div class="empty">${icon('inbox')}<div>ไม่พบ กฟส.</div></div></td></tr>`;
    $$('#officeBody tr[data-oid]').forEach((tr) => {
      const o = offices.find((x) => x.id === Number(tr.dataset.oid));
      $('.o-region', tr).addEventListener('change', async (e) => {
        try { await api('PUT', `/api/offices/${o.id}`, { region: e.target.value, active: !!o.active }); o.region = e.target.value; toast(`ย้าย ${o.name} ไป ${regionLabel(o.region)} แล้ว`); }
        catch (err) { toast(err.message, true); e.target.value = o.region; }
      });
      $('.o-toggle', tr).addEventListener('click', async () => {
        try { await api('PUT', `/api/offices/${o.id}`, { region: o.region, active: !o.active }); o.active = o.active ? 0 : 1; draw(); }
        catch (err) { toast(err.message, true); }
      });
    });
  };
  draw();
  $('#oq').addEventListener('input', draw);
  $$('[data-jump-region]').forEach((b) => b.addEventListener('click', () => {
    $('#oq').value = regionLabel(b.dataset.jumpRegion); draw();
  }));
  $('#addOffice').addEventListener('click', () => openDialog(`
    <h2>เพิ่ม กฟส.ในพื้นที่ใช้ไฟฟ้า</h2>
    <label class="field"><span class="req">ชื่อ กฟส.</span><input type="text" name="name" required placeholder="เช่น กฟส.สันทราย"></label>
    <label class="field"><span class="req">กฟข. ที่สังกัด</span><select name="region" required><option value="">เลือก กฟข.</option>
      ${L.regions.map((r) => `<option value="${esc(r)}">${esc(regionLabel(r))}</option>`).join('')}</select></label>
    ${dlgActions('เพิ่ม')}`, async (fd) => {
    await api('POST', '/api/offices', { name: fd.get('name'), region: fd.get('region') });
    toast('เพิ่ม กฟส. แล้ว'); renderOffices();
  }));
  $('#bulkBtn').addEventListener('click', () => openDialog(`
    <h2>วางรายชื่อ กฟส. จาก Excel</h2>
    <p class="muted small">คัดลอก 2 คอลัมน์จาก Excel (ชื่อ กฟส. และ กฟข.) แล้ววางด้านล่าง บรรทัดละ 1 แห่ง เช่น<br>
      <span class="mono">กฟส.สันทราย&nbsp;&nbsp;&nbsp;กฟน.1</span> · รายชื่อที่มีอยู่แล้วจะถูกปรับ กฟข. ให้ตรง</p>
    <label class="field"><span class="req">รายชื่อ</span><textarea name="text" rows="10" required placeholder="กฟส.สันทราย&#9;กฟน.1&#10;กฟส.หางดง&#9;กฟน.1"></textarea></label>
    ${dlgActions('นำเข้า')}`, async (fd) => {
    const r = await api('POST', '/api/offices/bulk', { text: fd.get('text') });
    toast(`เพิ่ม ${r.added} แห่ง · ปรับปรุง ${r.updated} แห่ง${r.errors.length ? ` · ข้าม ${r.errors.length} บรรทัด` : ''}`, r.errors.length > 0);
    if (r.errors.length) console.warn(r.errors);
    renderOffices();
  }));
}

// ============================================================ Google Sheets / Drive (admin)
async function renderGoogle() {
  if (state.user.role !== 'admin') throw new Error('ไม่มีสิทธิ์เข้าถึง');
  const seq = routeSeq;
  const [g, script] = await Promise.all([api('GET', '/api/google'), fetch('/api/google/script').then((r) => r.text())]);
  if (isStale(seq)) return;
  setCrumbs([['เชื่อมต่อ Google']]);
  const sheetLink = g.sheet_id ? `https://docs.google.com/spreadsheets/d/${g.sheet_id}/edit#gid=${g.sheet_gid || 0}` : '';
  const folderLink = g.folder_id ? `https://drive.google.com/drive/folders/${g.folder_id}` : '';

  view().innerHTML = `
    <div class="page-head"><div><h1>เชื่อมต่อ Google Sheets / Drive</h1>
      <p>ส่งข้อมูลคำร้องทุกรายการไปที่ Google Sheet และเก็บไฟล์แนบไว้ใน Google Drive แยกโฟลเดอร์ตามสถานี (อัปเดตอัตโนมัติทุกครั้งที่มีการเปลี่ยนแปลง)</p></div>
      <div class="row">
        ${sheetLink ? `<a class="btn" href="${esc(sheetLink)}" target="_blank" rel="noopener">${icon('sheet')}เปิดชีท</a>` : ''}
        ${folderLink ? `<a class="btn" href="${esc(folderLink)}" target="_blank" rel="noopener">${icon('folder')}เปิดโฟลเดอร์</a>` : ''}
      </div></div>

    <div class="kpis" id="gStatus">${googleStatusTiles(g)}</div>
    <div id="gErrors">${googleErrors(g)}</div>

    <form class="card" id="gForm" style="margin-bottom:16px">
      <div class="card-head"><h2>${icon('cloud')}ตั้งค่าการเชื่อมต่อ</h2></div>
      <div class="card-pad grid g2">
        <label class="field"><span class="req">ลิงก์ Google Sheet</span><input type="url" name="sheet" value="${esc(sheetLink)}" placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"></label>
        <label class="field"><span class="req">ลิงก์โฟลเดอร์ Google Drive</span><input type="url" name="folder" value="${esc(folderLink)}" placeholder="https://drive.google.com/drive/folders/…"></label>
        <label class="field span-all"><span class="req">Web App URL (ได้จากขั้นตอนที่ 6 ด้านล่าง)</span>
          <input type="url" name="url" value="${esc(g.url)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
        <label class="check span-all"><input type="checkbox" name="enabled" ${g.enabled ? 'checked' : ''}>
          <span><strong>เปิดใช้การส่งข้อมูลอัตโนมัติ</strong> — เปิดครั้งแรกระบบจะส่งคำร้องที่มีอยู่ทั้งหมดขึ้นชีท และสร้างโฟลเดอร์ของทุกสถานี</span></label>
      </div>
      <div class="form-bar" style="position:static;box-shadow:none;border-width:1px 0 0;border-radius:0 0 var(--r-lg) var(--r-lg)">
        <div class="alert alert-info" id="gTestResult" hidden style="flex:1"></div><span class="spacer"></span>
        <button type="button" class="btn" id="gTest">${icon('zap')}ทดสอบการเชื่อมต่อ</button>
        <button class="btn btn-primary">${icon('check')}บันทึก</button>
      </div>
    </form>

    <section class="card">
      <div class="card-head"><h2>${icon('list')}ติดตั้ง Apps Script ในชีท (ทำครั้งเดียว ประมาณ 5 นาที)</h2>
        <span class="spacer"></span><button class="btn btn-sm" id="gSync">${icon('upload', 'i-sm')}ส่งข้อมูลทั้งหมดอีกครั้ง</button></div>
      <div class="card-pad">
        ${g.sheet_id && g.folder_id ? '' : `<div class="alert alert-danger" style="margin-bottom:14px">${icon('alert')}<span>ใส่ลิงก์ Google Sheet และโฟลเดอร์ Drive ด้านบนแล้วกดบันทึกก่อน โค้ดด้านล่างจะเติม ID ให้อัตโนมัติ</span></div>`}
        <ol class="steps">
          <li>เปิด Google Sheet ${sheetLink ? `(<a href="${esc(sheetLink)}" target="_blank" rel="noopener">เปิดชีท</a>)` : ''} ด้วยบัญชีที่เป็นเจ้าของชีทและโฟลเดอร์ → เมนู <b>ส่วนขยาย (Extensions)</b> → <b>Apps Script</b></li>
          <li>ลบโค้ดเดิมในไฟล์ <span class="mono">Code.gs</span> ทั้งหมด แล้ว<b>วางโค้ดด้านล่าง</b> (กดปุ่ม “คัดลอกโค้ด”) → กดไอคอนบันทึก 💾</li>
          <li>กด <b>ทำให้ใช้งานได้ (Deploy)</b> → <b>การทำให้ใช้งานได้รายการใหม่ (New deployment)</b> → รูปเฟือง เลือก <b>เว็บแอป (Web app)</b></li>
          <li>ตั้งค่า <b>เรียกใช้ในฐานะ (Execute as): ฉัน (Me)</b> และ <b>ผู้ที่มีสิทธิ์เข้าถึง (Who has access): ทุกคน (Anyone)</b> → กด Deploy</li>
          <li>กด <b>ให้สิทธิ์เข้าถึง (Authorize access)</b> → เลือกบัญชี → ถ้าขึ้น “Google hasn’t verified this app” กด <b>Advanced</b> → <b>Go to … (unsafe)</b> → <b>Allow</b> (เป็นสคริปต์ของคุณเอง)</li>
          <li>คัดลอก <b>Web app URL</b> (ลงท้ายด้วย <span class="mono">/exec</span>) มาวางในช่อง “Web App URL” ด้านบน → กด <b>ทดสอบการเชื่อมต่อ</b></li>
          <li>ติ๊ก <b>เปิดใช้การส่งข้อมูลอัตโนมัติ</b> → กด <b>บันทึก</b> เสร็จแล้ว</li>
        </ol>
        <div class="code-box">
          <div class="code-head"><span class="mono small">Code.gs</span><span class="spacer"></span>
            <button class="btn btn-sm" id="gRegen" title="ใช้เมื่อสงสัยว่ารหัสลับรั่วไหล">${icon('key', 'i-sm')}สร้างรหัสลับใหม่</button>
            <button class="btn btn-sm btn-primary" id="gCopy">${icon('copy', 'i-sm')}คัดลอกโค้ด</button></div>
          <pre id="gCode">${esc(script)}</pre>
        </div>
        <p class="hint" style="margin-top:10px">ถ้าแก้โค้ดหรือสร้างรหัสลับใหม่ ต้องวางโค้ดใหม่แล้ว Deploy → จัดการการทำให้ใช้งานได้ (Manage deployments) → แก้ไข ✏️ → เวอร์ชันใหม่ (New version) · URL เดิมใช้ต่อได้</p>
      </div>
    </section>`;

  const form = $('#gForm');
  const body = () => ({ sheet: form.elements.sheet.value, folder: form.elements.folder.value, url: form.elements.url.value.trim(), enabled: form.elements.enabled.checked });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('PUT', '/api/google', body());
      toast(r.queued ? `บันทึกแล้ว · กำลังส่ง ${r.queued.rows} คำร้อง และ ${r.queued.files} ไฟล์` : 'บันทึกแล้ว');
      renderGoogle();
    } catch (err) { toast(err.message, true); }
  });
  $('#gTest').addEventListener('click', async (e) => {
    const box = $('#gTestResult'); const btn = e.currentTarget; btn.disabled = true;
    box.hidden = false; box.className = 'alert alert-info'; box.textContent = 'กำลังทดสอบ…';
    try {
      const r = await api('POST', '/api/google/test', { url: form.elements.url.value.trim() });
      box.innerHTML = `${icon('checkCircle')}<span>เชื่อมต่อสำเร็จ · ชีท: <b>${esc(r.sheet)}</b> · โฟลเดอร์: <b>${esc(r.folder)}</b></span>`;
    } catch (err) {
      box.className = 'alert alert-danger'; box.innerHTML = `${icon('alert')}<span>${esc(err.message)}</span>`;
    } finally { btn.disabled = false; }
  });
  $('#gCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#gCode').textContent); toast('คัดลอกโค้ดแล้ว'); }
    catch {
      const r = document.createRange(); r.selectNodeContents($('#gCode'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('เลือกโค้ดไว้แล้ว กด Ctrl+C เพื่อคัดลอก');
    }
  });
  $('#gRegen').addEventListener('click', async () => {
    if (!confirm('สร้างรหัสลับใหม่? การส่งข้อมูลจะหยุดจนกว่าจะวางโค้ดใหม่ใน Apps Script และ Deploy เวอร์ชันใหม่')) return;
    await api('POST', '/api/google/regenerate-secret'); toast('สร้างรหัสลับใหม่แล้ว คัดลอกโค้ดไปวางใหม่'); renderGoogle();
  });
  $('#gSync').addEventListener('click', async () => {
    try { const r = await api('POST', '/api/google/sync-all'); toast(`เข้าคิวแล้ว ${r.rows} คำร้อง · ${r.files} ไฟล์`); } catch (err) { toast(err.message, true); }
  });

  // อัปเดตสถานะการส่งทุก 5 วินาทีขณะอยู่หน้านี้
  const timer = setInterval(async () => {
    if (isStale(seq) || location.hash !== '#/google') { clearInterval(timer); return; }
    try {
      const s = await api('GET', '/api/google');
      $('#gStatus').innerHTML = googleStatusTiles(s);
      $('#gErrors').innerHTML = googleErrors(s);
    } catch { /* ignore */ }
  }, 5000);
}

function googleStatusTiles(g) {
  const pending = g.queue.rows + g.queue.files + g.queue.trash;
  const on = g.enabled && g.url;
  return `
    <div class="kpi" style="cursor:default"><div class="kpi-top"><span class="kpi-label">สถานะการเชื่อมต่อ</span>
      <span class="kpi-ico ${on ? 'done' : 'pending'}">${icon(on ? 'checkCircle' : 'clock')}</span></div>
      <div class="kpi-value" style="font-size:1.3rem">${on ? 'เปิดใช้งาน' : 'ยังไม่เปิดใช้'}</div>
      <div class="kpi-sub">${g.last_ok_at ? `ส่งสำเร็จล่าสุด ${fmtDateTime(g.last_ok_at)}` : 'ยังไม่เคยส่งสำเร็จ'}</div></div>
    <div class="kpi" style="cursor:default"><div class="kpi-top"><span class="kpi-label">รอส่ง</span><span class="kpi-ico ready">${icon('upload')}</span></div>
      <div class="kpi-value">${fmtNum(pending)}</div><div class="kpi-sub">คำร้อง ${fmtNum(g.queue.rows)} · ไฟล์ ${fmtNum(g.queue.files)}</div></div>
    <div class="kpi" style="cursor:default"><div class="kpi-top"><span class="kpi-label">โฟลเดอร์สถานีใน Drive</span><span class="kpi-ico brand">${icon('folder')}</span></div>
      <div class="kpi-value">${fmtNum(g.folders)}</div><div class="kpi-sub">โฟลเดอร์ละ 1 สถานี</div></div>
    <div class="kpi" style="cursor:default"><div class="kpi-top"><span class="kpi-label">ไฟล์ที่อัปโหลดแล้ว</span><span class="kpi-ico done">${icon('file')}</span></div>
      <div class="kpi-value">${fmtNum(g.synced_files)}</div><div class="kpi-sub">ไฟล์ที่แนบในระบบ</div></div>`;
}

function googleErrors(g) {
  if (!g.errors.length) return '';
  return `<div class="alert alert-danger" style="margin-bottom:16px">${icon('alert')}<div>
    <strong>ส่งไม่สำเร็จ ${g.errors.length} รายการ — ระบบจะลองใหม่อัตโนมัติ</strong>
    <div class="small">${esc(g.errors[0].last_error)}</div></div></div>`;
}

// ============================================================ notifications & menus
let notifTimer;
function startNotifPolling() {
  clearInterval(notifTimer);
  refreshNotifCount();
  notifTimer = setInterval(refreshNotifCount, 60000);
}
async function refreshNotifCount() {
  if (!state.user) return;
  try {
    const { unread } = await api('GET', '/api/notifications');
    const b = $('#notifCount');
    b.textContent = unread > 99 ? '99+' : unread;
    b.hidden = !unread;
    document.title = unread ? `(${unread}) ${APP_TITLE}` : APP_TITLE;
  } catch { /* ignore */ }
  refreshSideStats();
}

// การ์ดสรุปงานในแถบซ้าย (พื้นที่ของตนสำหรับ กฟส./กบล., ทุกพื้นที่สำหรับบทบาทอื่น)
async function refreshSideStats() {
  const box = $('#sideStats');
  if (!state.user || !box) return;
  try {
    const s = await api('GET', '/api/stats');
    const pct = s.total ? Math.round((s.completed / s.total) * 100) : 0;
    const row = (st, cls, label, n) => `<button class="ss-row" data-side-status="${st}"><i class="ss-dot ${cls}"></i>${esc(label)}<b>${fmtNum(n)}</b></button>`;
    box.innerHTML = `
      <div class="ss-head"><span>${hasArea(state.user) ? 'งานในพื้นที่ของฉัน' : 'ภาพรวมทุกพื้นที่'}</span><b>${fmtNum(s.total)}</b></div>
      ${row('pending', 'pending', 'รอเงื่อนไข', s.pending)}
      ${row('ready', 'ready', 'รอเปลี่ยนอัตรา Low', s.ready)}
      ${row('completed', 'done', 'เสร็จสมบูรณ์', s.completed)}
      <div class="ss-bar" role="img" aria-label="ได้อัตรา Low แล้ว ${pct}%"><i style="width:${pct}%"></i></div>
      <div class="ss-foot"><span>ได้อัตรา Low แล้ว</span><b>${pct}%</b></div>`;
    box.hidden = false;
    fitSidebar(true); // การ์ดสรุปเพิ่มความสูง: วัดใหม่ว่าแถบซ้ายพอดีจอไหม
    $$('[data-side-status]', box).forEach((b) => b.addEventListener('click', () => {
      Object.assign(state.filter, { status: b.dataset.sideStatus, missing: '', scope: 'mine', office: '', region: '' });
      $('#shell').classList.remove('nav-open');
      if (location.hash === '#/list') route(); else location.hash = '#/list';
    }));
  } catch { /* ignore */ }
}
async function openNotifPanel() {
  const panel = $('#notifPanel');
  const { items } = await api('GET', '/api/notifications');
  panel.innerHTML = `<div class="notif-head"><strong>การแจ้งเตือน</strong><button class="link-btn small" id="readAll">ทำเครื่องหมายว่าอ่านแล้ว</button></div>
    ${items.length ? items.map((n) => `<button class="notif-item ${n.is_read ? '' : 'unread'}" data-nid="${n.id}" data-app="${n.application_id || ''}">
      <span class="dot"></span><span>${esc(n.message)}<small>${fmtDateTime(n.created_at)}</small></span></button>`).join('')
    : `<div class="notif-empty">${icon('bell', 'i-lg')}<div>ยังไม่มีการแจ้งเตือน</div></div>`}`;
  panel.hidden = false;
  $('#readAll').addEventListener('click', async () => {
    await api('POST', '/api/notifications/read-all');
    $$('.notif-item.unread', panel).forEach((x) => x.classList.remove('unread'));
    refreshNotifCount();
  });
  $$('.notif-item', panel).forEach((it) => it.addEventListener('click', async () => {
    await api('POST', `/api/notifications/${it.dataset.nid}/read`).catch(() => {});
    panel.hidden = true;
    refreshNotifCount();
    if (it.dataset.app) {
      const target = `#/app/${it.dataset.app}`;
      if (location.hash === target) route(); else location.hash = target;
    }
  }));
}
function closePopovers() { $('#notifPanel').hidden = true; }

$('#notifBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = !$('#notifPanel').hidden;
  closePopovers();
  if (!open) openNotifPanel().catch((err) => toast(err.message, true));
});
document.addEventListener('click', (e) => { if (!e.target.closest('.notif')) closePopovers(); });
$('#menuBtn').addEventListener('click', () => $('#shell').classList.add('nav-open'));
$('#scrim').addEventListener('click', () => $('#shell').classList.remove('nav-open'));
$$('.user-actions .nav-btn').forEach((b) => b.addEventListener('click', async () => {
  const action = b.dataset.action;
  if (action === 'logout') {
    await api('POST', '/api/logout').catch(() => {});
    state.user = null;
    clearInterval(notifTimer);
    location.hash = '#/login';
  } else if (action === 'change-password') {
    openDialog(`<h2>เปลี่ยนรหัสผ่าน</h2>
      <label class="field"><span class="req">รหัสผ่านปัจจุบัน</span><input type="password" name="current" autocomplete="current-password" required></label>
      <label class="field"><span class="req">รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)</span><input type="password" name="next" autocomplete="new-password" minlength="6" required></label>
      ${dlgActions('บันทึก')}`, async (fd) => {
      await api('POST', '/api/me/password', { current: fd.get('current'), next: fd.get('next') });
      toast('เปลี่ยนรหัสผ่านแล้ว');
    });
  }
}));

route();
