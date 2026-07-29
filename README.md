# WhatsApp Multi

A small desktop app that runs several fully-isolated WhatsApp Web accounts in one window,
with native notifications and unread badges.

Built on Electron 43. Linux-first (developed and verified on Ubuntu 26.04 / Wayland / GNOME 50).

> **Status: early.** Accounts, notifications, unread badges, downloads and the right-click
> menu, tray and downloads work and are verified. Auto-update is **not built yet**, and
> packaging / calls / screen share are wired but unverified — see [Feature status](#feature-status).

---

## Why this exists

There is no official WhatsApp desktop client for Linux, and WhatsApp Web itself has no
multi-account support. The existing wrappers either only handle one account, or are built
on Electron APIs that are deprecated or discouraged.

---

## Requirements

- **Node.js 22+** and npm
- **Linux desktop** with a session D-Bus (notifications and the launcher badge use it)
- `gdbus` (ships with glib, almost always present) — used for the launcher badge
- `fonts-noto-color-emoji` — otherwise emoji render as tofu

Each running account consumes one of WhatsApp's **4 linked-device slots for that phone
number**. Multiple accounts mean multiple *different* numbers; pairing the same number
twice costs two of its four slots.

---

## Quick start

```bash
npm install
npm run dev          # dev server with HMR
```

Then press **+** in the left rail and scan the QR code with your phone.

```bash
npm run build        # typecheck + bundle to out/
npm start            # run the built app
npm run typecheck    # main/preload and renderer, separately
```

### `ELECTRON_RUN_AS_NODE`

VS Code's Electron host exports `ELECTRON_RUN_AS_NODE=1` into every terminal it spawns.
If that variable is set, Electron runs the main script as **plain Node**, `require('electron')`
returns a path string, and you get `TypeError: Cannot read properties of undefined (reading 'isPackaged')`.

The `dev` and `start` scripts unset it. If you launch Electron directly, do the same:

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
```

---

## How it works

One `BrowserWindow` renders the account rail; each account is a separate `WebContentsView`
laid over it.

```text
BrowserWindow ── renderer: account rail (React)
   └─ contentView
        ├─ WebContentsView  session=Accounts/<uuid-a>  → web.whatsapp.com
        └─ WebContentsView  session=Accounts/<uuid-b>  → web.whatsapp.com
```

A few choices worth knowing about, because the obvious alternatives are wrong:

- **`WebContentsView`, not `<webview>` or `BrowserView`.** `BrowserView` is formally
  deprecated; `<webview>` carries a standing "we recommend not using this" warning from the
  Electron team. The cost is manual bounds management and views painting above the DOM, so
  the rail is a reserved region rather than an overlay.

- **`session.fromPath()`, not `partition: 'persist:<id>'`.** Electron lowercases and
  percent-escapes partition names before they hit disk, so the directory name would not be
  the account id and "delete this account cleanly" becomes guesswork.

- **Accounts are never hibernated.** WhatsApp Web has no Web Push — notifications come from
  the live page's own WebSocket. A hibernated account is a silent account. Hidden-but-alive
  is deliberate, and `backgroundThrottling` is off.

- **Notifications wrap rather than replace.** Measured on Electron 43: the page-context
  `Notification` constructor reaches `org.freedesktop.Notifications` correctly, while
  `ServiceWorkerRegistration.showNotification()` *resolves its promise and sends nothing*
  ([electron#13041](https://github.com/electron/electron/issues/13041)). So the main-world
  shim subclasses the working constructor — adding the account prefix and a click listener —
  and redirects the dead service-worker path into it.

- **Unread counts come from IndexedDB**, not `document.title`. A title regex matches any
  digit, so a group named "2024 Planning" reads as 2024 unread messages. The reader runs in
  the preload's *isolated* world (IndexedDB is keyed by origin, not JS world), so WhatsApp's
  page code cannot observe or break it.

- **The launcher badge emits `com.canonical.Unity.LauncherEntry` over D-Bus directly**,
  rather than `app.setBadgeCount()` — Electron 44 removes Unity support and makes that API
  macOS-only.

---

## Feature status

| | Status |
|---|---|
| Multiple isolated accounts | ✅ Verified — one signed in while another shows a fresh QR |
| Session persists across restart | ✅ Verified |
| Desktop notifications | ✅ Works (native, via libnotify) |
| Notification click → right account | ✅ Verified per-account, not just focused window |
| Per-account notification prefix | ✅ Applied only when >1 account |
| Unread badges (rail + launcher) | ✅ Verified against real non-zero counts |
| Muted vs. direct unread split | ✅ Muted shows a dot, excluded from launcher count |
| Right-click menu (copy/paste/links/images) | ✅ Built by hand — Electron gives embedded content none |
| Spellcheck suggestions | ✅ Built from the context-menu event + `replaceMisspelling()` |
| Download handling | ✅ Auto-saves to `~/Downloads`, never clobbers, toast reveals the file |
| Rename accounts | ✅ Double-click the rail icon (reorder still missing) |
| Media, emoji, drag-and-drop upload | ⚪ Should work (Chromium default) — not yet verified |
| Voice message recording | ⚠️ **Untested.** Crashes the closest prior art (altus#333) |
| Voice / video calls | ⚪ Permissions granted; not yet verified |
| Screen share | ⚪ Handler wired; **not yet verified** (needs a live call) |
| Tray icon + close-to-tray | ✅ Verified registered with `org.kde.StatusNotifierWatcher` |
| Reorder accounts | ❌ Not implemented |
| Packaging (.deb / AppImage) | ⚪ `electron-builder.yml` written; build not yet run |
| Auto-update | ❌ Not implemented |

Notification **inline reply** is not possible on this target: GNOME's notification daemon
does not advertise the `inline-reply` capability (it does advertise `actions`, which is why
click routing works).

---

## Data layout

```text
~/.config/WhatsAppMulti/          # -dev suffix when unpackaged
  config.json                     # account list, atomic writes
  Accounts/<uuid>/                # one Chromium session tree per account
```

`config.json` is a **sibling** of `Accounts/`, never a parent, so wiping an account can
never take the config with it.

Three safety properties are enforced and tested:

- A **corrupt `config.json` never prunes session directories.** Otherwise "no accounts in
  config" would mean "delete every account's data". Load distinguishes *missing* (first run,
  safe) from *corrupt* (refuse to act).
- **A second instance exits immediately.** `app.quit()` is asynchronous and does not stop
  the script, so without this a doomed second instance would run through `whenReady`, mint an
  account, create a session directory, and only then die.
- **Config survives `SIGKILL`** — writes are debounced then atomic (tmp + rename).

---

## Development notes

Sandboxed preloads **cannot be ESM**. `package.json` is deliberately CommonJS, and the
preload build is pinned to `format: 'cjs'` with a `.cjs` extension in
[`electron.vite.config.ts`](electron.vite.config.ts). If `"type": "module"` is ever added,
electron-vite will silently emit an ESM preload that loads without error but whose
`contextBridge` globals never appear.

The main-world shim is passed through `contextBridge.executeInMainWorld`, which is marked
**Experimental** and **serializes** the function — so it must not close over anything outside
its own parameters, and must avoid syntax that makes the bundler emit helpers (which is why
it uses `Object.defineProperty` instead of a static class field). Install status is reported
to the main process and logged loudly on failure, so a future Electron change surfaces as
`[notify] SHIM NOT INSTALLED` rather than silently losing click routing.

---

## Caveats

WhatsApp's terms discourage unofficial clients. Wrapping `web.whatsapp.com` in a webview is
what several long-lived open-source projects do, but that is not a guarantee — use an account
you can afford to lose.

Electron has no LTS: three majors are supported, roughly eight weeks apart. Expect to bump it
regularly, and read `docs/breaking-changes.md` each time — the Unity badge removal is only
documented there.

---

## License

MIT
