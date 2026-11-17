---
name: ev-server
description: Start, stop, restart or check the EV Low Priority tracking web server (Node/Express, port 3000) on this Windows machine. Use this whenever the user says the site won't open, shows "ไม่พบ API" or an error page, asks to เปิด/ปิด/รีสตาร์ท/เริ่ม ระบบหรือเซิร์ฟเวอร์, after any change to server/*.js, server/db.js or scripts that the running server loads, and before checking the live app in a browser — even if the user doesn't say "server".
---

# EV Low Priority — server control

The app is one Node process (`npm start` → `node server/index.js`) serving the API and the static files in `public/`. Data lives in `data/` (SQLite `ev-low.db` + `uploads/`).

Why restarts matter: files in `public/` are read from disk on every request, so front-end edits show up after a browser refresh. Code in `server/` is loaded once at start-up, so after any server change the running process keeps the old code. The front end then calls endpoints the old process doesn't know and the user sees **"ไม่พบ API"**. The fix is always to restart the server, then have the user press Ctrl+F5.

Start-up also runs the database migrations in `server/db.js`. Back up first (skill `ev-data`) when the change touches the schema.

## Check status

```bash
node .claude/skills/ev-server/scripts/status.js
```

It prints whether port 3000 is listening, which PID owns it, and whether the running code is current. It probes `/api/lookups`: 401 = current code (login required), 404 = old code still running.

## Restart (or start)

1. Stop whatever is listening on 3000 (and any leftover test ports you started):
   ```bash
   powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { Stop-Process -Id $c.OwningProcess -Force; 'stopped ' + $c.OwningProcess } else { 'nothing on 3000' }"
   ```
   If the user started the server in their own terminal, it's fine to stop it, but tell them you did so. Their terminal will show the process ended.
2. Start it with the Bash tool, `run_in_background: true`, from the project root:
   ```bash
   cd "d:/workspace/my-project" && npm start
   ```
   A background task notification saying a *previous* server task "failed" right after you stopped it is expected (exit code from the kill). It is not a new problem.
3. Verify with the status script. Expect `home 200` and `api 401`.
4. Tell the user to press **Ctrl+F5** in the browser.

## Things to tell the user

- A server started from this Claude session stops when the session or VS Code closes. Next time they must run `npm start` in the VS Code terminal (Ctrl+`). Unsent Google sync work stays queued and resumes on the next start.
- To stop it themselves: click in that terminal and press Ctrl+C.
- Port already in use (`EADDRINUSE`) means an old server is still running. Stop it with step 1.

## Don'ts

- Don't run test servers against the real `data/` folder. Use the `ev-verify` skill, which works on a copy and a different port.
- Don't change `PORT` for the real server unless the user asks. Their bookmarks and instructions use 3000.
