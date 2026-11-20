'use strict';
/* เดโม EV Low Priority Tracking (GitHub Pages)
 * รันโค้ดเซิร์ฟเวอร์จริง server/*.js ในเบราว์เซอร์: SQLite = sql.js (WebAssembly), express/multer/fs/crypto = ตัวแทนขนาดเล็กด้านล่าง
 * ทุกการเรียก fetch('/api/...') จากหน้าเว็บถูกส่งเข้า "เซิร์ฟเวอร์ในเบราว์เซอร์" นี้แทนการส่งออกอินเทอร์เน็ต
 * ข้อมูลเป็นข้อมูลสมมติ และบันทึกเฉพาะในเบราว์เซอร์ของผู้ใช้แต่ละคน (IndexedDB) */
(async function boot() {
  const SQLJS = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
  const STORE = 'ev-low-demo';
  const SID_KEY = 'ev-low-demo-sid';
  const DEMO_PASSWORD = 'demo1234';
  const ACCOUNTS = [
    ['admin', 'ผู้ดูแลระบบ', 'ทำได้ทุกอย่าง'],
    ['field1', 'กฟส.ในพื้นที่ใช้ไฟฟ้า', 'กฟจ.เชียงใหม่'],
    ['field2', 'กฟส.ในพื้นที่ใช้ไฟฟ้า', 'กฟจ.ชลบุรี'],
    ['tfd1', 'กทฟ.', 'บันทึกเงื่อนไขที่ 3'],
    ['region1', 'กบล. กฟข.', 'กฟน.1'],
  ];
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // ------------------------------------------------------------ หน้าจอระหว่างโหลด
  const loading = document.createElement('div');
  loading.id = 'demoLoading';
  loading.innerHTML = '<div class="dl-box"><div class="dl-spin"></div><div>กำลังเปิดระบบเดโม…</div></div>';
  document.body.append(loading);
  injectStyles();

  // ------------------------------------------------------------ IndexedDB (บันทึกข้อมูลเดโมในเบราว์เซอร์)
  const idb = {
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open(STORE, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async get(key) {
      try {
        const db = await idb.open();
        return await new Promise((res, rej) => {
          const q = db.transaction('kv').objectStore('kv').get(key);
          q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
        });
      } catch { return undefined; }
    },
    async set(key, val) {
      try {
        const db = await idb.open();
        await new Promise((res, rej) => {
          const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(val, key);
          t.oncomplete = res; t.onerror = () => rej(t.error);
        });
      } catch { /* โหมดส่วนตัว: ใช้ได้แต่ไม่บันทึก */ }
    },
    async clear() {
      try {
        const db = await idb.open();
        await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = res; t.onerror = res; });
      } catch { /* ignore */ }
    },
  };

  // ------------------------------------------------------------ Buffer / crypto
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  class Bytes extends Uint8Array {
    toString(encoding) {
      if (encoding === 'hex') return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
      if (encoding === 'base64') { let s = ''; for (const b of this) s += String.fromCharCode(b); return btoa(s); }
      return dec.decode(this);
    }
  }
  const toBytes = (v) => (v instanceof Uint8Array ? new Bytes(v) : new Bytes(enc.encode(String(v))));
  const BufferShim = {
    from(v, encoding) {
      if (encoding === 'hex') { const s = String(v); const out = new Bytes(s.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16); return out; }
      if (encoding === 'base64') { const bin = atob(String(v)); return Bytes.from(bin, (c) => c.charCodeAt(0)); }
      return toBytes(v);
    },
    isBuffer: (x) => x instanceof Uint8Array,
    byteLength: (s) => enc.encode(String(s)).length,
  };
  // SHA-256 แบบ synchronous (ใช้แทน scrypt สำหรับรหัสผ่านในเดโมเท่านั้น)
  function sha256(bytes) {
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = bytes.length; const n = ((l + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(n); m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(n - 4, l * 8); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
    const w = new Uint32Array(64);
    const rot = (x, k) => (x >>> k) | (x << (32 - k));
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
    }
    const out = new Bytes(32); const odv = new DataView(out.buffer);
    H.forEach((v, i) => odv.setUint32(i * 4, v >>> 0));
    return out;
  }
  const cryptoShim = {
    randomBytes(n) { const b = new Bytes(n); crypto.getRandomValues(b); return b; },
    randomUUID: () => crypto.randomUUID(),
    scryptSync(password, salt, len) {
      const out = new Bytes(len);
      for (let i = 0, off = 0; off < len; i++) {
        const h = sha256(enc.encode(`${salt}:${password}:${i}`));
        out.set(h.subarray(0, Math.min(32, len - off)), off); off += 32;
      }
      return out;
    },
    timingSafeEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0; },
  };

  // ------------------------------------------------------------ path (POSIX)
  const norm = (p) => {
    const abs = p.startsWith('/'); const out = [];
    for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
    return (abs ? '/' : '') + out.join('/');
  };
  const pathShim = {
    sep: '/',
    normalize: norm,
    join: (...parts) => norm(parts.filter((x) => x !== '').join('/')),
    resolve(...parts) { let r = '/'; for (const p of parts) { if (!p) continue; r = String(p).startsWith('/') ? String(p) : `${r}/${p}`; } return norm(r); },
    basename: (p) => String(p).split('/').filter(Boolean).pop() || '',
    dirname: (p) => { const s = norm(String(p)).split('/'); s.pop(); return s.join('/') || '/'; },
    extname(p) { const b = pathShim.basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
    relative(from, to) {
      const a = pathShim.resolve(from).split('/').filter(Boolean); const b = pathShim.resolve(to).split('/').filter(Boolean);
      let i = 0; while (i < a.length && a[i] === b[i]) i++;
      return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
    },
  };

  // ------------------------------------------------------------ fs (ไฟล์ในหน่วยความจำ)
  const files = new Map();
  let dirty = false;
  const fsShim = {
    mkdirSync() {},
    existsSync: (p) => { const k = norm(p); if (files.has(k)) return true; for (const f of files.keys()) if (f.startsWith(`${k}/`)) return true; return false; },
    readFileSync(p, encoding) {
      const d = files.get(norm(p));
      if (!d) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; }
      return encoding ? dec.decode(d) : new Bytes(d);
    },
    writeFileSync(p, data) { files.set(norm(p), toBytes(data)); dirty = true; },
    renameSync(a, b) { const d = files.get(norm(a)); files.delete(norm(a)); if (d) files.set(norm(b), d); dirty = true; },
    rmSync(p) { const k = norm(p); for (const f of [...files.keys()]) if (f === k || f.startsWith(`${k}/`)) files.delete(f); dirty = true; },
    rm(p, _opts, cb) { fsShim.rmSync(p); if (typeof cb === 'function') cb(null); },
    unlinkSync(p) { fsShim.rmSync(p); },
    readdirSync(p) { const k = `${norm(p)}/`; return [...new Set([...files.keys()].filter((f) => f.startsWith(k)).map((f) => f.slice(k.length).split('/')[0]))]; },
    statSync(p) { const d = files.get(norm(p)); if (!d) throw new Error(`ENOENT: ${p}`); return { size: d.length, isFile: () => true, isDirectory: () => false }; },
    createReadStream(p) { return { pipe(res) { res.end(fsShim.readFileSync(p)); return res; } }; },
  };

  // ------------------------------------------------------------ node:sqlite → sql.js
  const SQL = await window.initSqlJs({ locateFile: (f) => SQLJS + f });
  const seedMeta = await (await fetch('seed.json', { cache: 'no-cache' })).json();
  let saved = await idb.get('state');
  const fresh = !saved || saved.seed !== seedMeta.id;
  if (fresh) {
    const buf = new Uint8Array(await (await fetch('seed.db', { cache: 'no-cache' })).arrayBuffer());
    saved = { seed: seedMeta.id, db: buf, files: Object.entries(seedMeta.files).map(([k, b64]) => [`/app/data/${k}`, BufferShim.from(b64, 'base64')]) };
    ls.set(SID_KEY, null);
  }
  const raw = new SQL.Database(saved.db);
  for (const [k, v] of saved.files || []) files.set(k, new Bytes(v));
  const stmtCache = new Map();
  const bindArgs = (args) => args.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'bigint' ? Number(v) : v));
  class DatabaseSync {
    constructor() { this.raw = raw; }
    exec(sql) { raw.exec(sql); }
    prepare(sql) {
      const stmt = () => { let s = stmtCache.get(sql); if (!s) { s = raw.prepare(sql); stmtCache.set(sql, s); } return s; };
      return {
        get(...args) { const s = stmt(); try { s.bind(bindArgs(args)); return s.step() ? s.getAsObject() : undefined; } finally { s.reset(); } },
        all(...args) { const s = stmt(); const out = []; try { s.bind(bindArgs(args)); while (s.step()) out.push(s.getAsObject()); } finally { s.reset(); } return out; },
        run(...args) {
          const s = stmt();
          try { s.bind(bindArgs(args)); s.step(); } finally { s.reset(); }
          const changes = raw.getRowsModified();
          const lastInsertRowid = raw.exec('SELECT last_insert_rowid()')[0].values[0][0];
          dirty = true;
          return { changes, lastInsertRowid };
        },
      };
    }
    close() {}
  }
  // export() ของ sql.js ปิด/เปิดฐานข้อมูลใหม่: ต้องล้าง statement ที่เก็บไว้และตั้ง PRAGMA ใหม่
  function exportDb() {
    for (const s of stmtCache.values()) { try { s.free(); } catch { /* freed already */ } }
    stmtCache.clear();
    const bytes = raw.export();
    raw.exec('PRAGMA foreign_keys = ON;');
    return bytes;
  }

  // ------------------------------------------------------------ express (เฉพาะส่วนที่ server/index.js ใช้)
  let APP = null;
  function createApp() {
    const stack = [];
    const compile = (p) => {
      const keys = [];
      const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
      return { re, keys };
    };
    const app = {
      disable() {}, enable() {}, set() {},
      use(a, ...fns) { if (typeof a === 'string') stack.push({ prefix: a, fns }); else stack.push({ prefix: '', fns: [a, ...fns] }); return app; },
      listen(_port, cb) { setTimeout(() => cb && cb(), 0); return { close() {} }; },
      async handle(req, res) {
        const layers = stack.flatMap((l) => l.fns.map((fn) => ({ l, fn })));
        let idx = 0;
        const next = (err) => {
          while (idx < layers.length) {
            const { l, fn } = layers[idx++];
            if (l.method) {
              if (l.method !== req.method) continue;
              const m = l.re.exec(req.path);
              if (!m) continue;
              req.params = Object.fromEntries(l.keys.map((k, j) => [k, decodeURIComponent(m[j + 1])]));
            } else if (l.prefix && !(req.path === l.prefix || req.path.startsWith(`${l.prefix}/`))) continue;
            const isErrMw = fn.length === 4;
            if (err ? !isErrMw : isErrMw) continue;
            try {
              const p = err ? fn(err, req, res, next) : fn(req, res, next);
              if (p && typeof p.then === 'function') p.catch(next);
            } catch (e) { next(e); }
            return;
          }
          if (!res.finished) res.status(err ? 500 : 404).json({ error: err ? String(err.message || err) : 'ไม่พบ API' });
        };
        next();
      },
    };
    for (const m of ['get', 'post', 'put', 'delete', 'patch']) {
      app[m] = (p, ...fns) => { stack.push({ method: m.toUpperCase(), ...compile(p), fns }); return app; };
    }
    APP = app;
    return app;
  }
  const expressShim = Object.assign(createApp, {
    json: () => (req, _res, next) => {
      if (typeof req.rawBody === 'string' && (req.headers['content-type'] || '').includes('json')) {
        try { req.body = req.rawBody ? JSON.parse(req.rawBody) : {}; } catch { req.body = {}; }
      }
      next();
    },
    static: () => (_req, _res, next) => next(),
  });

  // ------------------------------------------------------------ multer (อ่านไฟล์จาก FormData)
  class MulterError extends Error { constructor(code) { super(code); this.code = code; } }
  const cbP = (fn, req, file) => new Promise((res, rej) => fn(req, file, (e, v) => (e ? rej(e) : res(v))));
  function multerShim(opts = {}) {
    const storage = opts.storage || {};
    const maxSize = opts.limits?.fileSize || Infinity;
    const mw = (spec) => async (req, _res, next) => {
      try {
        const fd = req.formData;
        if (!fd) { next(); return; }
        req.body = {};
        const out = spec.array ? [] : {};
        for (const [field, val] of fd.entries()) {
          if (typeof val === 'string') { req.body[field] = val; continue; }
          if (spec.array ? field !== spec.name : !spec.names.includes(field)) throw new MulterError('LIMIT_UNEXPECTED_FILE');
          const file = { fieldname: field, originalname: val.name, mimetype: val.type || 'application/octet-stream', size: val.size };
          if (val.size > maxSize) throw new MulterError('LIMIT_FILE_SIZE');
          if (opts.fileFilter && !(await cbP(opts.fileFilter, req, file))) continue;
          const dest = typeof storage.destination === 'function' ? await cbP(storage.destination, req, file) : storage.destination;
          const name = storage.filename ? await cbP(storage.filename, req, file) : cryptoShim.randomBytes(8).toString('hex');
          const p = pathShim.join(dest, name);
          fsShim.writeFileSync(p, new Uint8Array(await val.arrayBuffer()));
          Object.assign(file, { destination: dest, filename: name, path: p });
          if (spec.array) out.push(file); else (out[field] ||= []).push(file);
        }
        if (spec.single) req.file = out[0]; else req.files = out;
        next();
      } catch (e) { next(e); }
    };
    return {
      array: (name) => mw({ array: true, name }),
      single: (name) => mw({ array: true, single: true, name }),
      fields: (list) => mw({ names: list.map((x) => x.name) }),
    };
  }
  multerShim.diskStorage = (o) => o;
  multerShim.memoryStorage = () => ({});
  multerShim.MulterError = MulterError;

  const contentDisposition = (name, o = {}) => `${o.type || 'attachment'}; filename*=UTF-8''${encodeURIComponent(name || 'file')}`;
  const processShim = { env: { DATA_DIR: '/app/data', PORT: '3000' }, removeAllListeners() {}, on() {}, platform: 'browser', cwd: () => '/app' };

  // ------------------------------------------------------------ โหลดโค้ดเซิร์ฟเวอร์จริง (CommonJS)
  const SHIMS = {
    'node:sqlite': { DatabaseSync }, 'node:path': pathShim, 'node:fs': fsShim, 'node:crypto': cryptoShim,
    path: pathShim, fs: fsShim, crypto: cryptoShim, express: expressShim, multer: multerShim, 'content-disposition': contentDisposition,
  };
  // Export Excel: ExcelJS ฉบับเบราว์เซอร์ (โหลดแบบ async จาก cdnjs ใน index.html — เซิร์ฟเวอร์ require ตอนกด Export)
  Object.defineProperty(SHIMS, 'exceljs', { enumerable: true, get() {
    if (!window.ExcelJS) throw new Error('กำลังโหลดตัวสร้างไฟล์ Excel กรุณาลองอีกครั้งในอีกสักครู่');
    return window.ExcelJS;
  } });
  const sources = {};
  await Promise.all([['server/db.js'], ['server/google-sync.js'], ['server/index.js'], ['google-apps-script/Code.gs', true]].map(async ([p, asFile]) => {
    const text = await (await fetch(p, { cache: 'no-cache' })).text();
    if (asFile) files.set(`/app/${p}`, toBytes(text)); else sources[`/app/${p}`] = text;
  }));
  const modules = {};
  // setInterval แบบ Node (มี .unref()) สำหรับคิว Google ใน server/google-sync.js
  const nodeSetInterval = (fn, ms) => { const id = window.setInterval(fn, ms); return { unref() { return this; }, ref() { return this; }, [Symbol.toPrimitive]: () => id }; };
  const makeRequire = (base) => (name) => {
    if (SHIMS[name]) return SHIMS[name];
    const p = pathShim.resolve(base, name.endsWith('.js') ? name : `${name}.js`);
    if (modules[p]) return modules[p].exports;
    if (sources[p] == null) throw new Error(`ไม่พบโมดูล ${name}`);
    const module = { exports: {} };
    modules[p] = module;
    // eslint-disable-next-line no-new-func
    const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', 'process', 'Buffer', 'setInterval', `${sources[p]}\n//# sourceURL=${p}`);
    fn(makeRequire(pathShim.dirname(p)), module, module.exports, pathShim.dirname(p), p, processShim, BufferShim, nodeSetInterval);
    return module.exports;
  };
  const origLog = console.log;
  console.log = () => {}; // ซ่อนข้อความตอนเริ่มเซิร์ฟเวอร์
  const req0 = makeRequire('/app');
  req0('./server/index.js');
  console.log = origLog;
  if (fresh) {
    // รหัสผ่านเดโมของทุกบัญชี (เข้ารหัสด้วยฟังก์ชันของระบบที่รันอยู่ในเบราว์เซอร์)
    const { db, hashPassword } = req0('./server/db.js');
    db.prepare('UPDATE users SET password_hash = ?').run(hashPassword(DEMO_PASSWORD));
  }

  // ------------------------------------------------------------ fetch('/api/...') → เซิร์ฟเวอร์ในเบราว์เซอร์
  const realFetch = window.fetch.bind(window);
  let queue = Promise.resolve();
  function dispatch(method, url, headers, body) {
    return new Promise((resolve) => {
      const u = new URL(url, location.origin);
      const query = {};
      for (const [k, v] of u.searchParams) query[k] = k in query ? [].concat(query[k], v) : v;
      const sid = ls.get(SID_KEY);
      const req = {
        method, url: u.pathname + u.search, originalUrl: u.pathname + u.search, path: u.pathname, query, params: {},
        headers: { ...headers, cookie: sid ? `sid=${sid}` : '' }, body: undefined,
        is(t) { return (this.headers['content-type'] || '').includes(t); },
        get(h) { return this.headers[String(h).toLowerCase()]; },
      };
      if (body instanceof FormData) { req.formData = body; req.headers['content-type'] = 'multipart/form-data'; } else if (typeof body === 'string') req.rawBody = body;
      const res = {
        statusCode: 200, headers: {}, finished: false,
        status(n) { this.statusCode = n; return this; },
        setHeader(k, v) {
          if (String(k).toLowerCase() === 'set-cookie') { // คุกกี้ session เก็บใน localStorage แทน
            const m = /sid=([^;]*)/.exec(String(v)); const maxAge = /Max-Age=(\d+)/.exec(String(v));
            ls.set(SID_KEY, m && m[1] && !(maxAge && maxAge[1] === '0') ? m[1] : null);
            return this;
          }
          this.headers[String(k).toLowerCase()] = String(v); return this;
        },
        getHeader(k) { return this.headers[String(k).toLowerCase()]; },
        type(t) { this.headers['content-type'] = t; return this; },
        json(o) { this.headers['content-type'] = 'application/json; charset=utf-8'; return this.end(JSON.stringify(o)); },
        send(b) {
          if (b != null && typeof b === 'object' && !(b instanceof Uint8Array)) return this.json(b);
          if (!this.headers['content-type']) this.headers['content-type'] = 'text/html; charset=utf-8';
          return this.end(b);
        },
        end(b) {
          if (this.finished) return this;
          this.finished = true;
          resolve(new Response(b == null ? null : b, { status: this.statusCode, headers: this.headers }));
          return this;
        },
        on() { return this; }, once() { return this; }, write() { return true; },
      };
      APP.handle(req, res);
    });
  }
  let saveTimer;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!dirty) return;
      dirty = false;
      idb.set('state', { seed: seedMeta.id, db: exportDb(), files: [...files.entries()] });
    }, 400);
  };
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = String(init.method || 'GET').toUpperCase();
    const headers = {};
    new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
    const run = () => dispatch(method, u.pathname + u.search, headers, init.body);
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p.then((r) => { if (method !== 'GET' || dirty) scheduleSave(); return r; });
  };

  // ดาวน์โหลดไฟล์/CSV: ลิงก์ /api/... เปิดผ่าน fetch แล้วสร้างไฟล์ในเบราว์เซอร์
  window.demoOpen = async (url) => {
    const r = await fetch(url);
    if (!r.ok) { let msg = 'เปิดไฟล์ไม่ได้'; try { msg = (await r.json()).error || msg; } catch { /* not json */ } alert(msg); return; }
    const blob = await r.blob();
    const cd = r.headers.get('content-disposition') || '';
    const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
    const name = m ? decodeURIComponent(m[1]) : url.includes('export.xlsx') ? 'ev-low-priority-demo.xlsx' : 'download';
    const href = URL.createObjectURL(blob);
    if (cd.startsWith('inline')) window.open(href, '_blank', 'noopener');
    else { const a = document.createElement('a'); a.href = href; a.download = name; document.body.append(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="/api/"]');
    if (!a) return;
    e.preventDefault();
    window.demoOpen(a.getAttribute('href'));
  }, true);

  // ------------------------------------------------------------ แถบเดโม (บัญชีทดลอง + รีเซ็ตข้อมูล)
  const badge = document.createElement('div');
  badge.id = 'demoBadge';
  badge.innerHTML = `
    <button type="button" class="db-chip" aria-expanded="false">โหมดเดโม · ข้อมูลสมมติ</button>
    <div class="db-panel" hidden>
      <div class="db-title">ระบบเดโม (ข้อมูลสมมติทั้งหมด)</div>
      <p>ข้อมูลที่กรอกจะบันทึกเฉพาะในเบราว์เซอร์นี้ คนอื่นไม่เห็น · รหัสผ่านทุกบัญชี <b>${DEMO_PASSWORD}</b></p>
      <div class="db-list">${ACCOUNTS.map(([u, role, note]) => `
        <button type="button" data-demo-login="${u}"><b>${u}</b><span>${role} · ${note}</span></button>`).join('')}</div>
      <button type="button" class="db-reset">รีเซ็ตข้อมูลเดโม</button>
    </div>`;
  document.body.append(badge);
  const chip = badge.querySelector('.db-chip');
  const panel = badge.querySelector('.db-panel');
  const toggle = (open) => { panel.hidden = !open; chip.setAttribute('aria-expanded', String(open)); };
  chip.addEventListener('click', () => toggle(panel.hidden));
  const demoLogin = async (username) => {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: DEMO_PASSWORD }) });
    if (!r.ok) { alert((await r.json()).error); return; }
    await new Promise((res) => setTimeout(res, 450)); // รอบันทึกข้อมูล
    location.hash = '#/';
    location.reload();
  };
  badge.querySelectorAll('[data-demo-login]').forEach((b) => b.addEventListener('click', () => demoLogin(b.dataset.demoLogin)));
  // หน้าเข้าสู่ระบบ: ใส่ปุ่มบัญชีเดโมไว้ในการ์ดเข้าสู่ระบบ (แทนกล่องบัญชีทดลองของระบบจริงที่ซ่อนไว้)
  const injectLoginAccounts = () => {
    const card = document.querySelector('#loginRoot .login-card');
    if (!card || card.querySelector('.demo-login')) return;
    const box = document.createElement('div');
    box.className = 'demo-login';
    box.innerHTML = `<div class="dl-head"><b>บัญชีทดลอง (เดโม)</b><span>รหัสผ่านทุกบัญชี <code>${DEMO_PASSWORD}</code> · กดเพื่อเข้าสู่ระบบ</span></div>
      <div class="dl-grid">${ACCOUNTS.map(([u, role, note]) => `<button type="button" data-u="${u}"><b>${u}</b><span>${role} · ${note}</span></button>`).join('')}</div>`;
    box.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', () => demoLogin(b.dataset.u)));
    card.append(box);
  };
  new MutationObserver(injectLoginAccounts).observe(document.getElementById('loginRoot'), { childList: true, subtree: true });
  badge.querySelector('.db-reset').addEventListener('click', async () => {
    if (!confirm('ล้างข้อมูลที่กรอกไว้ทั้งหมดในเบราว์เซอร์นี้ และกลับไปใช้ข้อมูลสมมติชุดเริ่มต้น?')) return;
    clearTimeout(saveTimer);
    await idb.clear();
    ls.set(SID_KEY, null);
    location.hash = '#/';
    location.reload();
  });

  if (fresh) { dirty = true; scheduleSave(); }
  loading.remove();
  const s = document.createElement('script');
  s.src = 'app.js';
  document.body.append(s);

  function injectStyles() {
    const st = document.createElement('style');
    st.textContent = `
      #demoLoading { position: fixed; inset: 0; display: grid; place-items: center; background: var(--bg, #f5f6f8); z-index: 9999; font-family: inherit; color: var(--text-2, #3f4756); }
      #demoLoading .dl-box { display: grid; justify-items: center; gap: 14px; }
      #demoLoading .dl-spin { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--brand-100, #eee3f6); border-top-color: var(--brand, #6b2c91); animation: dl 0.8s linear infinite; }
      @keyframes dl { to { transform: rotate(360deg); } }
      #demoBadge { position: fixed; right: 16px; bottom: 16px; z-index: 9000; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; font-family: inherit; max-width: calc(100vw - 32px); }
      #demoBadge .db-chip { order: 2; border: 0; border-radius: 999px; padding: 8px 16px; background: var(--brand, #6b2c91); color: #fff; font: inherit; font-size: .85rem; font-weight: 600; cursor: pointer; box-shadow: 0 6px 18px rgba(17,24,39,.22); }
      #demoBadge .db-panel { order: 1; width: 320px; max-width: 100%; background: var(--surface, #fff); color: var(--text, #121826); border: 1px solid var(--border, #e7e9ee); border-radius: 14px; padding: 14px; box-shadow: 0 12px 32px rgba(17,24,39,.18); }
      #demoBadge .db-title { font-weight: 700; margin-bottom: 4px; }
      #demoBadge p { margin: 0 0 10px; font-size: .82rem; color: var(--muted, #6b7280); line-height: 1.5; }
      #demoBadge .db-list { display: grid; gap: 6px; }
      #demoBadge .db-list button { display: flex; flex-direction: column; align-items: flex-start; text-align: left; border: 1px solid var(--border, #e7e9ee); background: var(--surface-2, #fafbfc); border-radius: 10px; padding: 7px 11px; font: inherit; font-size: .84rem; cursor: pointer; color: inherit; }
      #demoBadge .db-list button:hover { border-color: var(--brand, #6b2c91); background: var(--brand-50, #f7f2fb); }
      #demoBadge .db-list span { color: var(--muted, #6b7280); font-size: .78rem; }
      #demoBadge .db-reset { margin-top: 10px; width: 100%; border: 1px dashed var(--border-strong, #d4d8e0); background: none; border-radius: 10px; padding: 7px; font: inherit; font-size: .82rem; color: var(--muted, #6b7280); cursor: pointer; }
      #demoBadge .db-reset:hover { color: var(--fail, #c2362b); border-color: var(--fail, #c2362b); }
      #loginRoot .demo { display: none; } /* กล่องบัญชีทดลองของระบบจริง (รหัสไม่ตรงกับเดโม) */
      .demo-login { display: grid; gap: 8px; padding: 12px; border-radius: 12px; background: var(--brand-50, #f7f2fb); border: 1px dashed var(--brand-200, #dcc6ec); }
      .demo-login .dl-head { display: flex; flex-direction: column; line-height: 1.4; }
      .demo-login .dl-head b { font-size: .86rem; color: var(--brand, #6b2c91); }
      .demo-login .dl-head span { font-size: .76rem; color: var(--muted, #6b7280); }
      .demo-login code { font-size: .9em; background: #fff; border: 1px solid var(--border, #e7e9ee); border-radius: 4px; padding: 0 4px; color: var(--text, #121826); }
      .demo-login .dl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .demo-login .dl-grid button { display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 1px; padding: 7px 10px; border-radius: 9px;
        border: 1px solid var(--border, #e7e9ee); background: #fff; font: inherit; cursor: pointer; color: inherit; min-width: 0; }
      .demo-login .dl-grid button:first-child { grid-column: 1 / -1; }
      .demo-login .dl-grid button:hover { border-color: var(--brand, #6b2c91); }
      .demo-login .dl-grid b { font-size: .84rem; }
      .demo-login .dl-grid span { font-size: .7rem; color: var(--muted, #6b7280); line-height: 1.35; }
      @media print { #demoBadge { display: none; } }`;
    document.head.append(st);
  }
})().catch((err) => {
  console.error(err);
  const el = document.getElementById('demoLoading');
  if (el) el.innerHTML = `<div class="dl-box"><div>เปิดระบบเดโมไม่สำเร็จ: ${String(err.message || err).replace(/[<>&]/g, '')}</div><div>ลองโหลดหน้าใหม่ หรือใช้ Chrome/Edge รุ่นล่าสุด</div></div>`;
});
