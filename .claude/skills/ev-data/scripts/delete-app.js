// ลบคำร้องแบบถาวร (ดูข้อมูลก่อนเสมอ; ลบจริงเมื่อใส่ --yes และพบเพียง 1 รายการ)
// usage (จากโฟลเดอร์โปรเจกต์): node .claude/skills/ev-data/scripts/delete-app.js "<เลขที่คำร้อง | id | ชื่อสถานี>" [--yes]
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const term = process.argv[2];
const yes = process.argv.includes('--yes');
if (!term) { console.error('ระบุเลขที่คำร้อง, id หรือชื่อสถานี'); process.exit(1); }

const { db, tx, DATA_DIR } = require(path.resolve('server/db'));
const googleSync = require(path.resolve('server/google-sync'));

const rows = /^\d+$/.test(term)
  ? db.prepare('SELECT * FROM applications WHERE id = ?').all(Number(term))
  : db.prepare('SELECT * FROM applications WHERE app_no = ? OR station_name LIKE ? OR applicant_name LIKE ?').all(term, `%${term}%`, `%${term}%`);

if (!rows.length) { console.log('ไม่พบคำร้อง'); process.exit(1); }
const count = (table, id) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE application_id = ?`).get(id).n;
for (const r of rows) {
  const files = db.prepare('SELECT original_name, drive_file_id FROM attachments WHERE application_id = ? AND stored_name IS NOT NULL').all(r.id);
  console.log(`- id ${r.id} · ${r.app_no} · ${r.station_name} · ${r.office} · สถานะ ${r.status} · ที่มา ${r.source}`);
  console.log(`  หลักฐาน ${count('attachments', r.id)} (ไฟล์ ${files.length}${files.some((f) => f.drive_file_id) ? ', มีใน Google Drive' : ''}) · ประวัติ ${count('events', r.id)} · ใบแจ้งหนี้ ${count('invoices', r.id)} · แจ้งเตือน ${count('notifications', r.id)}`);
}

if (!yes) { console.log('\n(ดูอย่างเดียว — ใส่ --yes เพื่อลบจริง)'); process.exit(0); }
if (rows.length !== 1) { console.error('\nพบมากกว่า 1 รายการ ระบุเลขที่คำร้องหรือ id ให้ชัดเจน'); process.exit(1); }

const app = rows[0];
execFileSync(process.execPath, [path.join(__dirname, 'backup.js'), `before-delete-${app.app_no}`], { stdio: 'inherit' });

const driveFiles = db.prepare('SELECT drive_file_id FROM attachments WHERE application_id = ? AND drive_file_id IS NOT NULL').all(app.id);
tx(() => {
  db.prepare('DELETE FROM applications WHERE id = ?').run(app.id); // attachments/events/notifications/invoices ลบตาม (ON DELETE CASCADE)
  db.prepare("DELETE FROM sync_queue WHERE kind = 'row' AND ref = ?").run(String(app.id));
});
for (const f of driveFiles) googleSync.queueTrash(f.drive_file_id);
fs.rmSync(path.join(DATA_DIR, 'uploads', String(app.id)), { recursive: true, force: true });

console.log(`\nลบ ${app.app_no} ${app.station_name} แล้ว · เหลือคำร้อง ${db.prepare('SELECT COUNT(*) AS n FROM applications').get().n} รายการ`);
if (driveFiles.length) console.log(`ไฟล์ใน Google Drive ${driveFiles.length} ไฟล์ เข้าคิวย้ายไปถังขยะแล้ว`);
if (googleSync.settings().enabled) console.log('หมายเหตุ: แถวของคำร้องนี้ใน Google Sheet ต้องลบเอง');
