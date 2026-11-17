// สำรองข้อมูล EV Low Priority: snapshot ฐานข้อมูล (VACUUM INTO — ปลอดภัยแม้เซิร์ฟเวอร์รันอยู่) + โฟลเดอร์ uploads
// usage (จากโฟลเดอร์โปรเจกต์): node .claude/skills/ev-data/scripts/backup.js [label]
process.removeAllListeners('warning');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const KEEP = 30;
const root = process.cwd();
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dbFile = path.join(dataDir, 'ev-low.db');
if (!fs.existsSync(dbFile)) { console.error(`ไม่พบฐานข้อมูล ${dbFile} (รันจากโฟลเดอร์โปรเจกต์หรือยัง?)`); process.exit(1); }

const p = (n) => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
const label = (process.argv[2] || '').replace(/[^\w.-]+/g, '-').slice(0, 40);
const backupsDir = path.join(root, 'backups');
const dest = path.join(backupsDir, label ? `${stamp}-${label}` : stamp);
fs.mkdirSync(dest, { recursive: true });

const target = path.join(dest, 'ev-low.db').replace(/'/g, "''");
new DatabaseSync(dbFile).exec(`VACUUM INTO '${target}'`);
const uploads = path.join(dataDir, 'uploads');
if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(dest, 'uploads'), { recursive: true });

const check = new DatabaseSync(path.join(dest, 'ev-low.db'), { readOnly: true });
const n = check.prepare('SELECT COUNT(*) AS n FROM applications').get().n;
check.close();

// เก็บไว้เฉพาะ KEEP ชุดล่าสุด
const all = fs.readdirSync(backupsDir).filter((x) => /^\d{8}-\d{6}/.test(x)).sort();
for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(backupsDir, old), { recursive: true, force: true });

console.log(`สำรองข้อมูลแล้ว: ${dest}`);
console.log(`คำร้อง ${n} รายการ · เก็บไว้ ${Math.min(all.length, KEEP)} ชุดล่าสุด`);
