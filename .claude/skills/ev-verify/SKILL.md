---
name: ev-verify
description: Verify the EV Low Priority tracking app end to end before reporting work as done — syntax checks, an isolated test server on a copy of the data, an API smoke test of the whole คำร้อง workflow and role/area permissions, browser screenshots (desktop and mobile) with JavaScript-error detection, and a simulated Google Apps Script for Sheets/Drive sync changes. Use this after any change to server/, public/, scripts/ or google-apps-script/, when the user reports a bug and you need to reproduce it, or when asked to ทดสอบ/ตรวจสอบ/เช็ก ระบบ — even for "small" UI tweaks, because the front end is one large vanilla-JS file where a typo breaks every page.
---

# EV Low Priority — verification

Everything runs against a **copy** of `data/` on a different port, with Google sync switched off in the copy. The real data and the real Google Sheet/Drive are never touched. That is the whole point of this skill, so don't shortcut it by pointing tests at port 3000 or `data/`.

Run from the project root (`d:/workspace/my-project`). Ports used for tests: 3999 (app), 3990 (Google mock).

## 1. Syntax check (always)

```bash
for f in server/*.js public/app.js scripts/*.js; do node --check "$f" || echo "FAIL $f"; done
```

## 2. Test server on a copy

```bash
T=$(node .claude/skills/ev-verify/scripts/prepare-test-data.js | tail -1) && echo "$T"
```

This creates the test accounts **t_admin, t_field (กฟจ.เชียงใหม่), t_field2 (กฟจ.ตราด), t_tfd, t_region (กฟน.1)**, all with password `test1234`. Then start the server with the Bash tool, `run_in_background: true`:

```bash
cd "d:/workspace/my-project" && DATA_DIR="<path printed above>" PORT=3999 node server/index.js
```

Check it is up: `node .claude/skills/ev-server/scripts/status.js 3999`.

## 3. API smoke test

```bash
node .claude/skills/ev-verify/scripts/smoke.js http://localhost:3999
```

It runs about 25 checks covering intake (required PDF, CA, Meter; กฟส./กฟข. derived from the account), viewing other areas read-only, edit rights limited to the user's own area, conditions 1–3 incl. "ไม่ผ่าน" not counting, the ready notification, กบล. safety results, test-fee request numbers (12 digits, unique, CPO 2,400/6,500), closing with the Low date, the scope toggle, CSV, and stats. Exit code 1 means something failed. Read the ✗ lines. When you add a feature, add a check for it here.

## 4. Look at the pages

```bash
node .claude/skills/ev-verify/scripts/screenshots.js http://localhost:3999 "<scratchpad>/shots" --user t_admin
node .claude/skills/ev-verify/scripts/screenshots.js http://localhost:3999 "<scratchpad>/shots" --user t_field --mobile
```

Options: `--routes "map,list,new,app,offices,users,google"` (`app` = first request, `app:<id>` = a specific one). Use these names, not `#/…`, because Git Bash rewrites arguments containing `/` into Windows paths. The script reports JavaScript errors and horizontally overflowing tables, and exits 1 if it finds any. **Open the PNGs with the Read tool and actually look**: wrapped labels, clipped columns, overlapping text, and wrong wording are only caught by eye. It tries Chrome first, then Edge. If both fail to launch, say so instead of skipping silently.

For an interaction (open a dialog, click a tab), write a short puppeteer snippet modelled on `screenshots.js`. Wait for the page to settle after `goto` before clicking. Clicking during a re-render gives "Node is detached".

## 5. Google Sheets / Drive changes

When `google-apps-script/Code.gs` or `server/google-sync.js` changes, run the real `Code.gs` against the simulator:

```bash
SECRET=$(DATA_DIR="$T" node -e "const g=require('./server/google-sync');const s=g.settings();g.setSetting('google_webapp_url','http://localhost:3990/exec');g.setSetting('google_sheet_id','SHEET123456789012345678901');g.setSetting('google_folder_id','ROOTFOLDER1234');g.setSetting('google_enabled','1');g.queueAll();process.stdout.write(s.secret)")
node .claude/skills/ev-verify/scripts/gas-mock.js google-apps-script/Code.gs 3990 "$SECRET"   # background
```

Restart the test server on 3999 so it picks up the settings. Wait about 15 s, then `curl -s http://localhost:3990/dump` to inspect the simulated sheet rows/formulas, folders and files. `GET /user-edit` adds a user column and formula so you can confirm the sync never overwrites them. The simulator mirrors the Apps Script APIs the script uses, but it is not Google. Tell the user that the real deployment is the final test.

## 6. Clean up and report

Stop the test processes (ports 3999 and 3990) and delete the temp data folder. In the report to the user, say what was verified and how. Never test against real data or real Google.
