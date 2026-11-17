'use strict';
// ส่งโฟลเดอร์ demo-dist/ ขึ้น branch gh-pages ของ GitHub (เว็บเดโม GitHub Pages)
// branch gh-pages เก็บเฉพาะไฟล์ที่ build แล้ว และถูกแทนที่ทั้งหมดทุกครั้ง (force push) — โค้ดหลักอยู่ที่ branch main
// ใช้: npm run demo:build แล้ว npm run demo:deploy
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'demo-dist');
const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

if (!fs.existsSync(path.join(OUT, 'seed.db'))) {
  console.error('ยังไม่มี demo-dist — รัน npm run demo:build ก่อน');
  process.exit(1);
}
const remote = git(['remote', 'get-url', 'origin']);
const rev = git(['rev-parse', '--short', 'HEAD']);
const name = git(['config', 'user.name']);
const email = git(['config', 'user.email']);

fs.rmSync(path.join(OUT, '.git'), { recursive: true, force: true });
git(['init', '-q', '-b', 'gh-pages'], OUT);
git(['config', 'user.name', name], OUT);
git(['config', 'user.email', email], OUT);
git(['add', '-A'], OUT);
git(['commit', '-q', '-m', `เว็บเดโม (ข้อมูลสมมติ) จาก main ${rev}`], OUT);
execFileSync('git', ['push', '--force', remote, 'gh-pages'], { cwd: OUT, stdio: 'inherit' });
fs.rmSync(path.join(OUT, '.git'), { recursive: true, force: true });

const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(remote);
console.log(m ? `เว็บเดโม: https://${m[1].toLowerCase()}.github.io/${m[2]}/` : 'ส่งขึ้น gh-pages แล้ว');
