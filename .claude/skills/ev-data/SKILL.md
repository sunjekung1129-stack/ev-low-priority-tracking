---
name: ev-data
description: Back up, restore, inspect and change the EV Low Priority tracking data (SQLite data/ev-low.db + data/uploads) safely — import the Excel tracking sheet (Book1.xlsx-style), delete or fix a คำร้อง, look up records, restore from a backup. Use this whenever the user asks to ลบ/แก้/นำเข้า/สำรอง/กู้คืน ข้อมูลหรือคำร้อง, mentions an Excel file of stations to load, or before any schema change or risky data operation — even if they just say "เอาข้อมูลนี้ใส่ระบบ" or "ลบอันนี้ออก".
---

# EV Low Priority — data operations

All data is local: `data/ev-low.db` (SQLite, WAL mode) and `data/uploads/<application id>/…` for attached files. There is no undo in the app, so the rule that keeps this safe is: **take a backup before you change anything**, and tell the user where it is.

Run every script from the project root (`d:/workspace/my-project`). Scripts that `require('server/db')` also run the schema migrations. That is the same code the server runs, so it's safe.

## Backup

```bash
node .claude/skills/ev-data/scripts/backup.js [label]
```

This writes `backups/<YYYYMMDD-HHMMSS>[-label]/` containing a consistent DB snapshot (`VACUUM INTO`, safe while the server is running) and a copy of `uploads/`. It keeps the newest 30 backups. `backups/` is git-ignored. Give the user the full path printed at the end.

## Restore

1. Stop the server (skill `ev-server`).
2. Take a backup of the current state first (`backup.js before-restore`), in case the restore was the wrong call.
3. Copy `backups/<name>/ev-low.db` over `data/ev-low.db`, delete `data/ev-low.db-wal` and `data/ev-low.db-shm`, and replace `data/uploads` with the backup's `uploads`.
4. Start the server and check the request count with the user.

## Import from Excel

The importer reads the first sheet and maps columns by **header name** (row 1), e.g. `สถานี EV`, `กฟฟ.หน้างาน`, `Contract Acc. M/I`, `1.หนังสือ`, `4.หนังสือ`, `หนังสือเปลี่ยนอัตรา`. Rows whose CA (or station name) was imported before are skipped, so re-importing an updated file is safe.

```bash
node .claude/skills/ev-data/scripts/backup.js before-import
npm run import -- "C:\path\to\file.xlsx" --dry-run   # show what would happen
npm run import -- "C:\path\to\file.xlsx"
```

Copy downloaded files into their own folder first rather than reading them from Downloads in place. Show the dry-run summary to the user before the real import if anything looks off (unknown กฟข., rows not completed, missing columns). New offices from the file are not added to the กฟส. list automatically. Point the admin to the "การไฟฟ้า (กฟส.)" page.

## Delete a คำร้อง

The app only offers "ยกเลิกคำร้อง" (keeps history). Do a real delete only when the user explicitly asks.

```bash
node .claude/skills/ev-data/scripts/delete-app.js "<app_no or station name>"          # look up only
node .claude/skills/ev-data/scripts/delete-app.js "<app_no>" --yes                     # backup, then delete
```

Without `--yes` it lists the matches with their attachments, events and invoices. With `--yes` it needs exactly one match, takes a backup, deletes the application (attachments, events, notifications and invoices cascade), and removes `data/uploads/<id>`. Files already pushed to Google Drive are queued to the trash. **The row in the Google Sheet is not removed**, so tell the user to delete that row by hand.

## Add a document to "เอกสารหลักฐานที่เกี่ยวข้อง"

Admins can upload forms in the app. To add a file the user gives you (a PDF in Downloads, say), copy it into its own folder first, then run:

```bash
node scripts/add-document.js "<file>" --title "ชื่อเอกสาร" --category intake|conditions|safety|contract|rules|other --desc "ใช้เมื่อ..." --name "ชื่อไฟล์ตอนดาวน์โหลด.pdf" --sort 5
```

Files are copied to `data/docs/` and a row is added to `documents`. A title that already exists is skipped. These files often carry internal watermarks (staff names) or internal letters, so never add them to git, the Google Drive sync, or the demo site.

## Look things up

For quick read-only questions ("how many completed?", "which ones are missing condition 3?"), query with node:

```bash
node -e "const {db}=require('./server/db'); console.log(db.prepare('SELECT app_no, station_name, status FROM applications ORDER BY id').all())"
```

Main tables: `applications` (form data; extra fields in JSON column `data`), `attachments` (`condition_no` 0 = แบบฟอร์มคำร้อง, 1–3 = เงื่อนไข, 4 = ผลทดสอบความปลอดภัย), `invoices`, `events`, `users`, `offices` (กฟส. → กฟข.), `settings`, `sync_queue`.

When you change data directly in SQL, also call `require('./server/google-sync').queueApp(id)` for each changed application so the Google Sheet row catches up.
