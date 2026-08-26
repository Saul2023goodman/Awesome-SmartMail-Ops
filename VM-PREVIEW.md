# VM Preview / Screenshot Harness

This folder is a development-only preview harness. The production `manifest.json` is unchanged and still injects only into `https://mail.163.com/*`.

## What it does

- Loads the same production UI and business modules (`content.js`, `content.css`, importer, recognizer, contacts, scheduler, roster).
- Provides a deterministic local “NetEase-like” background so screenshots do not depend on a real account or login state.
- Replaces only browser/mailbox integration with `vm/chrome-shim.js`; no real email, draft, send, or mailbox action is performed.
- Supports batch / single / contacts tabs and optional deterministic sample import.

## Screenshot commands

From the extension root:

```bash
python3 vm/screenshot.py --tab batch --output vm/screenshots/batch.png
python3 vm/screenshot.py --tab single --output vm/screenshots/single.png
python3 vm/screenshot.py --tab contacts --output vm/screenshots/contacts.png
python3 vm/screenshot.py --tab batch --sample --output vm/screenshots/batch-sample.png
```

The runner uses the system Chromium and Python Playwright. It exits non-zero on page-level JavaScript errors.

## Manual preview

Open `vm-preview.html` in a browser. Query parameters:

- `?tab=batch|single|contacts`
- `&max=0` to keep floating mode
- `&sample=1` to paste/import a deterministic two-email sample on the batch tab

Or capture the standard four-state set in one command:

```bash
bash vm/capture-all.sh
```

For responsive checks, pass `--width` and `--height`, for example:

```bash
python3 vm/screenshot.py --tab batch --sample --width 1366 --height 768 --output vm/screenshots/batch-1366x768.png
```
