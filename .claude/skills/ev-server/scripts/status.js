// แสดงสถานะเซิร์ฟเวอร์ EV Low Priority (พอร์ต 3000 หรือ PORT ที่ระบุ)
// usage: node .claude/skills/ev-server/scripts/status.js [port]
const { execSync } = require('node:child_process');

const port = Number(process.argv[2] || process.env.PORT || 3000);
const base = `http://localhost:${port}`;

function pidOnPort() {
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || null;
  } catch { return null; }
}

(async () => {
  const pid = pidOnPort();
  const probe = async (p) => { try { return (await fetch(base + p, { signal: AbortSignal.timeout(4000) })).status; } catch { return 0; } };
  const home = await probe('/');
  const api = await probe('/api/lookups');
  console.log(`port ${port}: ${pid ? `listening (PID ${pid})` : 'not listening'}`);
  console.log(`home ${home || '-'} · api ${api || '-'}`);
  if (!pid || !home) console.log('→ เซิร์ฟเวอร์ไม่ได้รันอยู่: start with `npm start` (background)');
  else if (api === 404) console.log('→ โค้ดเก่ายังรันอยู่ (ไม่รู้จัก /api/lookups): restart the server');
  else if (api === 401) console.log('→ OK: current code is running');
  else console.log('→ unexpected response, check the server log');
})();
