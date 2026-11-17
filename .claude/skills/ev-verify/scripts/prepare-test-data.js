// สร้างสำเนาข้อมูลสำหรับทดสอบ (ไม่แตะ data/ จริง) + บัญชีทดสอบที่รู้รหัสผ่าน + ปิดการส่งไป Google
// usage (จากโฟลเดอร์โปรเจกต์): node .claude/skills/ev-verify/scripts/prepare-test-data.js [dest-dir]
// พิมพ์ path ของสำเนาออกมาบรรทัดสุดท้าย → ใช้เป็น DATA_DIR ของเซิร์ฟเวอร์ทดสอบ
process.removeAllListeners('warning');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const src = path.resolve('data');
const dest = path.resolve(process.argv[2] || path.join(os.tmpdir(), `ev-low-test-${Date.now()}`));
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

if (fs.existsSync(path.join(src, 'ev-low.db'))) {
  new DatabaseSync(path.join(src, 'ev-low.db')).exec(`VACUUM INTO '${path.join(dest, 'ev-low.db').replace(/'/g, "''")}'`);
  if (fs.existsSync(path.join(src, 'uploads'))) fs.cpSync(path.join(src, 'uploads'), path.join(dest, 'uploads'), { recursive: true });
}

process.env.DATA_DIR = dest;
const { db, hashPassword } = require(path.resolve('server/db')); // รัน migration บนสำเนา

// สำเนาต้องไม่ส่งอะไรไป Google จริง
db.prepare("INSERT INTO settings (key, value) VALUES ('google_enabled', '0') ON CONFLICT(key) DO UPDATE SET value = '0'").run();
db.exec('DELETE FROM sync_queue');

const office = (name, region) => db.prepare(`INSERT INTO offices (name, region) VALUES (?, ?)
  ON CONFLICT(name) DO UPDATE SET region = excluded.region, active = 1`).run(name, region);
office('กฟจ.เชียงใหม่', '1.กฟน.1');
office('กฟจ.ตราด', '3.กฟก.2');

const PASSWORD = 'test1234';
const user = (username, name, role, off) => db.prepare(`INSERT INTO users (username, password_hash, display_name, role, office, active)
  VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash,
  role = excluded.role, office = excluded.office, active = 1`).run(username, hashPassword(PASSWORD), name, role, off);
user('t_admin', 'ทดสอบ ผู้ดูแลระบบ', 'admin', null);
user('t_field', 'ทดสอบ กฟจ.เชียงใหม่', 'field', 'กฟจ.เชียงใหม่');
user('t_field2', 'ทดสอบ กฟจ.ตราด', 'field', 'กฟจ.ตราด');
user('t_tfd', 'ทดสอบ กทฟ.', 'tfd', 'กทฟ.');
user('t_region', 'ทดสอบ กบล. กฟน.1', 'region', '1.กฟน.1');

console.log(`บัญชีทดสอบ: t_admin, t_field (กฟจ.เชียงใหม่), t_field2 (กฟจ.ตราด), t_tfd, t_region (กฟน.1) · รหัสผ่าน ${PASSWORD}`);
console.log(`คำร้องในสำเนา: ${db.prepare('SELECT COUNT(*) AS n FROM applications').get().n} · Google sync: ปิด`);
console.log(dest);
