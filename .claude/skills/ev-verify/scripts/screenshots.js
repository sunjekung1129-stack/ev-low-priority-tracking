// ถ่ายภาพหน้าจอระบบจริงด้วยเบราว์เซอร์ headless (Chrome ก่อน แล้วค่อย Edge) และรายงาน JavaScript error
// usage: node .claude/skills/ev-verify/scripts/screenshots.js <baseUrl> <outDir> [--user t_admin] [--mobile] [--routes "map,list,new,app"]
//   ชื่อหน้า: map (หน้าแรก), list, new, users, offices, google, app (คำร้องรายการแรก), app:<id>
//   (ไม่ใช้ "#/..." เพราะ Git Bash บน Windows แปลงอาร์กิวเมนต์ที่มี "/" เป็น path)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require(path.resolve('node_modules/puppeteer-core'));

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const base = (args[0] || 'http://localhost:3999').replace(/\/$/, '');
const out = path.resolve(args[1] || path.join(os.tmpdir(), 'ev-low-shots'));
const user = opt('--user', 't_admin');
const password = opt('--password', 'test1234');
const mobile = args.includes('--mobile');
const routes = opt('--routes', 'map,list,new,app').split(',').map((s) => s.trim().replace(/^#?\/?/, '')).filter(Boolean)
  .map((s) => (s === 'map' || s === 'home' ? '#/' : s.startsWith('app') ? s : `#/${s}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browsers = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter((p) => fs.existsSync(p));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  let browser; let lastErr;
  for (const exe of browsers) {
    try {
      browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-first-run'],
        userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ev-low-browser-')) });
      break;
    } catch (err) { lastErr = err; }
  }
  if (!browser) throw new Error(`เปิดเบราว์เซอร์ไม่ได้ (${browsers.join(', ') || 'ไม่พบ Chrome/Edge'}): ${lastErr?.message}`);

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.setViewport(mobile ? { width: 390, height: 844, isMobile: true } : { width: 1440, height: 900 });

  await page.goto(`${base}/#/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name=username]', user);
  await page.type('input[name=password]', password);
  await Promise.all([page.click('#loginForm button'), page.waitForSelector('#app > *', { timeout: 10000 })]);
  await wait(800);

  const saved = [];
  for (const [i, route] of routes.entries()) {
    let hash = route;
    if (route.startsWith('app')) {
      const id = route.includes(':') ? route.split(':')[1]
        : await page.evaluate(async () => (await (await fetch('/api/applications?scope=all')).json())[0]?.id);
      if (!id) { errors.push('ไม่มีคำร้องให้เปิด'); continue; }
      hash = `#/app/${id}`;
    }
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle0' });
    await wait(route === '#/' ? 1500 : 500); // แผนที่ต้องรอโหลด tile
    const file = path.join(out, `${String(i + 1).padStart(2, '0')}-${hash.replace(/^#\//, '').replace(/[^\w]+/g, '_') || 'map'}${mobile ? '-mobile' : ''}.png`);
    await page.screenshot({ path: file, fullPage: !mobile && route !== '#/' });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('.table-wrap')].some((t) => t.scrollWidth - t.clientWidth > 4));
    if (overflow && !mobile) errors.push(`${hash}: ตารางล้นแนวนอน`);
    saved.push(file);
  }
  await browser.close();
  console.log(saved.join('\n'));
  console.log(errors.length ? `\nพบปัญหา ${errors.length} รายการ:\n${errors.join('\n')}` : '\nไม่พบ JavaScript error');
  process.exit(errors.length ? 1 : 0);
})().catch((err) => { console.error('✗', err.message); process.exit(1); });
