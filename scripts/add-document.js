'use strict';
// เพิ่มไฟล์ในเครื่องเข้าเมนู "เอกสารหลักฐานที่เกี่ยวข้อง" (ทำแบบเดียวกับผู้ดูแลระบบอัปโหลดผ่านหน้าเว็บ)
// ใช้: node scripts/add-document.js "<ไฟล์>" --title "ชื่อเอกสาร" [--category intake|conditions|safety|contract|rules|other]
//        [--desc "คำอธิบาย"] [--name "ชื่อไฟล์ตอนดาวน์โหลด.pdf"] [--sort 1]
// ไฟล์ถูกคัดลอกไปที่ DATA_DIR/docs (ไม่อยู่ใน git) — ถ้าชื่อเอกสารซ้ำกับที่มีอยู่จะข้าม
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { db, DATA_DIR } = require('../server/db');

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const opt = (k, d = '') => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const CATS = ['intake', 'conditions', 'safety', 'contract', 'rules', 'other'];
const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.zip': 'application/zip' };

if (!file || !fs.existsSync(file)) { console.error('ไม่พบไฟล์:', file || '(ไม่ได้ระบุ)'); process.exit(1); }
const title = opt('title').trim();
const category = opt('category', 'other');
if (!title) { console.error('กรุณาระบุ --title'); process.exit(1); }
if (!CATS.includes(category)) { console.error(`--category ต้องเป็น ${CATS.join(', ')}`); process.exit(1); }
const ext = path.extname(file).toLowerCase();
if (!MIME[ext]) { console.error(`ไม่รองรับไฟล์ ${ext}`); process.exit(1); }
if (db.prepare('SELECT 1 FROM documents WHERE title = ?').get(title)) { console.log('มีเอกสารชื่อนี้แล้ว — ข้าม:', title); process.exit(0); }

const dir = path.join(DATA_DIR, 'docs');
fs.mkdirSync(dir, { recursive: true });
const stored = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
fs.copyFileSync(file, path.join(dir, stored));
const name = opt('name') || path.basename(file);
const r = db.prepare(`INSERT INTO documents (title, category, description, stored_name, original_name, mime, size, sort)
  VALUES (?,?,?,?,?,?,?,?)`).run(title, category, opt('desc') || null, stored, name, MIME[ext], fs.statSync(file).size, Number(opt('sort', '0')) || 0);
console.log(`เพิ่มเอกสาร #${r.lastInsertRowid}: ${title}`);
