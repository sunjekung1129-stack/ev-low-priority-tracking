// จำลอง Google Apps Script Web App (SpreadsheetApp / DriveApp / ContentService) เพื่อรัน google-apps-script/Code.gs ตัวจริงบน Node
// usage: node .claude/skills/ev-verify/scripts/gas-mock.js google-apps-script/Code.gs <port> <secret>
//   POST /exec  → 302 → GET /echo (เหมือน Google) · GET /dump = ดูสถานะชีท/โฟลเดอร์/ไฟล์จำลอง · GET /user-edit = จำลองผู้ใช้เพิ่มคอลัมน์และสูตรเอง
//   ชีทจำลองมี ID SHEET123456789012345678901 (gid 0) และโฟลเดอร์หลัก ID ROOTFOLDER1234
const http = require('node:http');
const vm = require('node:vm');
const fs = require('node:fs');

const [codePath, port, secret] = process.argv.slice(2);
const SHEET_ID = 'SHEET123456789012345678901';
const FOLDER_ID = 'ROOTFOLDER1234';

// ---------- sheet
const grid = []; // grid[r][c] = { v, f }
const cell = (r, c) => ((grid[r] ||= [])[c] ||= { v: '', f: '' });
const lastRow = () => { for (let r = grid.length - 1; r >= 0; r--) if ((grid[r] || []).some((x) => x && (x.v !== '' || x.f))) return r + 1; return 0; };
const lastCol = () => grid.reduce((m, row) => Math.max(m, (row || []).reduce((mm, x, i) => (x && (x.v !== '' || x.f) ? i + 1 : mm), 0)), 0);
const display = (raw) => {
  const m = /^=HYPERLINK\("([^"]*)","([^"]*)"\)$/.exec(raw);
  return m ? m[2] : raw;
};
function Range(r, c, nr, nc) {
  return {
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r - 1 + i, c - 1 + j).v)),
    getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r - 1 + i, c - 1 + j).f)),
    setValues(vals) {
      vals.forEach((row, i) => row.forEach((val, j) => {
        const x = cell(r - 1 + i, c - 1 + j);
        const s = typeof val === 'string' ? val : val;
        if (typeof s === 'string' && s.startsWith('=')) { x.f = s; x.v = display(s); }
        else if (typeof s === 'string' && s.startsWith("'")) { x.f = ''; x.v = s.slice(1); }
        else { x.f = ''; x.v = s; }
      }));
      return this;
    },
    setFontWeight() { return this; }, setBackground() { return this; },
  };
}
const sheet = {
  getSheetId: () => 0, getName: () => 'Sheet1', getParent: () => ({ getName: () => 'EV Low Tracking' }),
  getLastRow: lastRow, getLastColumn: lastCol, getRange: (r, c, nr = 1, nc = 1) => Range(r, c, nr, nc), setFrozenRows() {},
};

// ---------- drive
const folders = new Map(); const files = new Map(); let nextId = 1;
function Folder(id, name, parent) {
  const f = {
    id, name, parent, trashed: false,
    getId: () => id, getName: () => f.name, setName: (n) => { f.name = n; return f; }, getUrl: () => `https://drive.google.com/drive/folders/${id}`,
    createFolder: (n) => { const nf = Folder(`F${nextId++}`, n, id); folders.set(nf.id, nf); return nf; },
    searchFolders(q) {
      const m = /title contains '((?:[^'\\]|\\.)*)'/.exec(q); const term = m ? m[1].replace(/\\(.)/g, '$1') : '';
      const list = [...folders.values()].filter((x) => x.parent === id && !x.trashed && x.name.includes(term));
      let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] };
    },
    createFile(blob) {
      const file = { id: `D${nextId++}`, name: blob.name, type: blob.type, size: blob.bytes.length, folder: id, trashed: false, desc: '' };
      files.set(file.id, file);
      return { getId: () => file.id, getUrl: () => `https://drive.google.com/file/d/${file.id}/view`, setDescription: (d) => { file.desc = d; } };
    },
  };
  return f;
}
folders.set(FOLDER_ID, Folder(FOLDER_ID, 'EV Low เอกสาร', null));

const ctx = {
  SpreadsheetApp: { openById: (id) => { if (id !== SHEET_ID) throw new Error('ไม่พบชีท ' + id); return { getSheets: () => [sheet] }; } },
  DriveApp: {
    getFolderById: (id) => { const f = folders.get(id); if (!f) throw new Error('ไม่พบโฟลเดอร์'); return f; },
    getFileById: (id) => { const f = files.get(id); if (!f) throw new Error('no file'); return { setTrashed: (t) => { f.trashed = t; } }; },
  },
  Utilities: { base64Decode: (s) => Buffer.from(s, 'base64'), newBlob: (bytes, type, name) => ({ bytes, type, name }) },
  ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  console,
};
vm.createContext(ctx);
const code = fs.readFileSync(codePath, 'utf8').replace('__SECRET__', secret).replace('__SHEET_ID__', SHEET_ID)
  .replace('__SHEET_GID__', '0').replace('__FOLDER_ID__', FOLDER_ID);
vm.runInContext(code, ctx);

// ---------- web app (POST /exec → 302 → GET /echo เหมือน Google)
const results = new Map(); let rid = 1;
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/exec') {
    let body = ''; req.on('data', (d) => { body += d; }).on('end', () => {
      const out = ctx.doPost({ postData: { contents: body, type: req.headers['content-type'] } });
      const id = rid++; results.set(id, out.content);
      res.writeHead(302, { Location: `/echo?id=${id}` }); res.end();
    });
  } else if (req.method === 'GET' && req.url.startsWith('/echo')) {
    const id = Number(new URL(req.url, 'http://x').searchParams.get('id'));
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(results.get(id) || '{}');
  } else if (req.url === '/dump') {
    const rows = []; for (let r = 0; r < lastRow(); r++) rows.push(Array.from({ length: lastCol() }, (_, c) => cell(r, c).v));
    const formulas = []; for (let r = 0; r < lastRow(); r++) formulas.push(Array.from({ length: lastCol() }, (_, c) => cell(r, c).f));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rows, formulas, folders: [...folders.values()].map((f) => ({ id: f.id, name: f.name, parent: f.parent })), files: [...files.values()] }));
  } else if (req.url === '/user-edit') { // จำลองผู้ใช้พิมพ์คอลัมน์ของตัวเองและใส่สูตร
    const c = lastCol(); cell(0, c).v = 'หมายเหตุผู้ใช้'; cell(1, c).v = 'โน้ตของฉัน'; cell(1, c + 1).f = '=1+1'; cell(1, c + 1).v = 2; cell(0, c + 1).v = 'สูตรผู้ใช้';
    res.end('ok');
  } else { res.writeHead(404); res.end(); }
}).listen(Number(port), () => console.log('GAS mock on', port));
