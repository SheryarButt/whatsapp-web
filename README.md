# WhatsApp Multi

A small desktop app that runs several fully-isolated WhatsApp Web accounts in one window,
with native notifications and unread badges.

Built on Electron 43. Linux-first (developed and verified on Ubuntu 26.04 / Wayland / GNOME 50).

> **Status: usable.** Everything in the [feature table](#feature-status) is verified working,
> including voice/video calls, screen share and voice-message recording. Auto-update and tab
> reordering are the notable gaps.

---

## Why this exists

There is no official WhatsApp desktop client for Linux, and WhatsApp Web itself has no
multi-account support. The existing wrappers either only handle one account, or are built
on Electron APIs that are deprecated or discouraged.

Calls, screen share and voice-message recording all work here. That is worth stating plainly
because it is not a given: voice-message recording is an open crash in Altus
([#333](https://github.com/amanharwara/altus/issues/333), since 2024), and WhatsApp Web only
gained calls in early 2026 — the surveyed wrappers have open, unanswered issues for it. Three
decisions are load-bearing for that:

- `webRTCIPHandlingPolicy` is left at Electron's default. Ferdium ships
  `disable_non_proxied_udp`, which makes WhatsApp calls hang forever at "connecting" behind a
  misleading network error ([ferdium#2399](https://github.com/ferdium/ferdium-app/issues/2399)).
- `media` and `display-capture` are granted in **both** `setPermissionRequestHandler` and
  `setPermissionCheckHandler`. Installing only the first is a common and subtle omission.
- `autoplay-policy=no-user-gesture-required`, or a background account is silent — no
  notification ping and no incoming-call ringtone.

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

Then press **+** in the tab bar and scan the QR code with your phone.

```bash
npm run build        # typecheck + bundle to out/
npm start            # run the built app
npm run typecheck    # main/preload and renderer, separately
npm run icons        # regenerate build/icons from the generator script
```

### Getting the app icon to show up

On Wayland a window carries **no icon of its own**. The compositor matches the window's
`app_id` to an installed `.desktop` file and uses that file's `Icon=`. Electron derives
`app_id` from `app.setDesktopName()`, so without a matching entry you get a generic
placeholder in the dock, the switcher *and* on notifications.

Packaged `.deb` builds install one automatically. When running from source:

```bash
npm run desktop:install     # writes to ~/.local/share, no sudo
npm run desktop:uninstall
```

The app reports the result at startup, so a missing entry is never a silent mystery:

```text
[desktop] app_id=com.sheryar.WhatsAppMulti -> ~/.local/share/applications/com.sheryar.WhatsAppMulti.desktop
```

The generated `Exec` points at `node_modules/electron/dist/electron`, **not**
`node_modules/.bin/electron`. The latter is a symlink to `cli.js`, a Node script that spawns
the real binary as a child: fine from a terminal, but launched from the desktop it starts and
immediately dies, so clicking the menu entry appears to do nothing at all.

### `ELECTRON_RUN_AS_NODE`

VS Code's Electron host exports `ELECTRON_RUN_AS_NODE=1` into every terminal it spawns.
If that variable is set, Electron runs the main script as **plain Node**, `require('electron')`
returns a path string, and you get `TypeError: Cannot read properties of undefined (reading 'isPackaged')`.

The `dev` and `start` scripts unset it. If you launch Electron directly, do the same:

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
```

### Start at login

Three places, whichever is closest to hand:

- **⚙ Settings** in the tab bar
- **File → Start at login** in the menu bar
- the **tray** menu (the one that still works when the window is hidden)

All three are rebuilt when any of them changes — Electron menu items cannot be updated in
place, so a stale tick is the default failure and has to be designed out.

It launches with `--hidden`, so at login the app comes up in the tray rather than stealing
focus — accounts still connect and notifications still arrive. If the tray failed to
initialise the window is shown anyway, so the app can never start unreachable.

`app.setLoginItemSettings()` is **not** used: it is an empty function on Linux, so enabling
autostart through it appears to succeed and silently does nothing. Instead an XDG autostart
entry is written to `~/.config/autostart/com.sheryar.WhatsAppMulti.desktop`. Disabling
removes the file, and entries disabled by a desktop settings editor (`Hidden=true` or
`X-GNOME-Autostart-enabled=false`) are read back correctly rather than reported as enabled.

---

## How it works

One `BrowserWindow` renders the account tab bar; each account is a separate `WebContentsView`
laid out beneath it.

```text
┌─ BrowserWindow ─────────────────────────────────┐
│ [Work] [Personal 3] [Client] [+]   ← tab bar,   │  renderer (React), 40px
├─────────────────────────────────────────────────┤
│                                                 │
│   WebContentsView  session=Accounts/<uuid>      │  inset 40px from the top
│   → web.whatsapp.com                            │
└─────────────────────────────────────────────────┘
```

Views paint *above* the DOM, so the tab bar is a reserved region rather than an overlay —
nothing in the renderer can draw on top of an account. `TAB_BAR_HEIGHT` in
[`src/shared/types.ts`](src/shared/types.ts) is the single source of truth; the CSS variable
`--tabbar-height` must match it.

A few choices worth knowing about, because the obvious alternatives are wrong:

- **`WebContentsView`, not `<webview>` or `BrowserView`.** `BrowserView` is formally
  deprecated; `<webview>` carries a standing "we recommend not using this" warning from the
  Electron team. The cost is manual bounds management: there is no `setAutoResize`, and
  laying out on `resize` alone is not enough — a view created before the window settles keeps
  stale bounds, so `show`/`restore`/`maximize`/fullscreen are all wired too.

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
| Rename accounts | ✅ Double-click a tab, or right-click → Rename |
| Media, emoji, drag-and-drop upload | ✅ Verified |
| Voice message recording | ✅ Verified — note this crashes the closest prior art ([altus#333](https://github.com/amanharwara/altus/issues/333)) |
| Voice / video calls | ✅ Verified |
| Screen share | ✅ Verified (xdg-desktop-portal picker on Wayland) |
| Tray icon + close-to-tray | ✅ Verified registered with `org.kde.StatusNotifierWatcher` |
| Per-tab menu (rename / reload / remove) | ✅ Native menu on right-click |
| Reorder accounts | ❌ Not implemented |
| Packaging | ✅ `--dir` build verified: runs, tray icon resolves, asar excludes sources |
| App / tray / notification icon | ✅ Generated set + desktop entry; startup verifies the chain |
| Start at login | ✅ XDG autostart entry, launches hidden to the tray |
| Auto-update | ❌ Not implemented |

Notification **inline reply** is not possible on this target: GNOME's notification daemon
does not advertise the `inline-reply` capability (it does advertise `actions`, which is why
click routing works).

---

## Data layout

```text
~/.config/whatsapp-multi/     # packaged build
~/.config/WhatsAppMulti-dev/  # unpackaged, so dev never touches real accounts
  config.json                 # account list, atomic writes
  Accounts/<uuid>/            # one Chromium session tree per account
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
