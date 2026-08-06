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

If the app does not start when launched from the desktop, see
[Troubleshooting](#troubleshooting) — that is a different problem from a missing icon.

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

### Priority alerts

**⚙ Settings → Priority alerts…** Messages containing any of your keywords get a notification
that **stays on screen until dismissed**, instead of the normal one that auto-expires after a
few seconds. Clicking it opens that chat, same as a normal notification.

Whole-word matching is on by default, so `urgent` does not fire on `insurgent`. Word
boundaries use Unicode letter/number classes rather than `\b`, which is ASCII-only in
JavaScript and would mis-handle non-Latin text.

The mechanism is worth knowing, because it is not simply "add an option to the notification":

- `urgency` exists only on Electron's **main-process** `Notification`, not the web API. So a
  priority alert cannot be an upgraded version of WhatsApp's own notification — WhatsApp's has
  to be **suppressed** and ours fired instead, or you would get two per message.
- Suppression has to happen synchronously *inside the page*, before the constructor runs, so
  the keyword list is pushed into the main world and matched there. By the time main hears
  about a notification it has already been shown.
- The shim is therefore a `Proxy` with a `construct` trap rather than a subclass: a subclass
  cannot skip its own `super()` call. On a match it returns a stand-in object that implements
  enough of `Notification` (`onclick`, `close()`, events) for WhatsApp's own code to keep
  working, and main replays the real click into it so the chat still opens.

---

## Troubleshooting

### Start here: get the real error

An app launched from the desktop has **no terminal**, so its crash output goes to the journal
rather than to anywhere you are looking. Almost every "it just doesn't start" is a one-line
`FATAL` that is already recorded:

```bash
journalctl --user -n 200 --no-pager | grep -i whatsapp
```

Lines tagged `com.sheryar.WhatsAppMulti.desktop[<pid>]` are the app's own stderr. systemd also
logs the launch scope, which tells you whether the launch happened at all:

```text
Started app-gnome-com.sheryar.WhatsAppMulti-59917.scope - Application launched by gnome-shell.
com.sheryar.WhatsAppMulti.desktop[59917]: FATAL: The SUID sandbox helper binary was found, but
is not configured correctly...
```

### Why testing from a terminal can lie to you

**A terminal is not the same launch environment as the desktop.** Three differences bite:

| | Terminal | Desktop (`gnome-shell`) |
|---|---|---|
| AppArmor profile | whatever your terminal has — VS Code's permits user namespaces | `unconfined`, which on Ubuntu 24.04+ does **not** |
| Controlling terminal | yes | no |
| Environment | your shell profile, possibly with `ELECTRON_RUN_AS_NODE` | the session's |

A fix can therefore pass from a terminal and still fail when clicked. Check what you are
actually testing under:

```bash
cat /proc/self/attr/current                     # your shell's AppArmor profile
cat /proc/$(pgrep -x gnome-shell)/attr/current  # the desktop session's
unshare -Ur true && echo "userns allowed here"  # the capability that differs
```

`gio launch <file>.desktop` gets closer than running the `Exec` line by hand, but it still
**inherits your shell's AppArmor profile**, so it is not conclusive either. The journal is.

### Known failures

| Symptom | Cause |
|---|---|
| Nothing happens from the apps menu, but it runs fine from a terminal | [SUID sandbox not configured](#suid-sandbox-not-configured) |
| Exits instantly with no output, or `TypeError: ... reading 'isPackaged'` | [`ELECTRON_RUN_AS_NODE`](#electron_run_as_node) |
| Generic placeholder icon in dock, switcher and notifications | no `.desktop` entry matching the app_id → `npm run desktop:install` |
| Start-at-login stopped working | the entry stores absolute paths and the project moved → toggle it off and on |
| Notifications stopped appearing | `[notify] SHIM NOT INSTALLED` in the log — `contextBridge.executeInMainWorld` is Experimental and may have changed |
| Unread badge stuck | `[unread] status=db-absent` or `error` means the count is *unknown*, not zero — WhatsApp's IndexedDB schema may have moved |

#### SUID sandbox not configured

Ubuntu 24.04+ sets `kernel.apparmor_restrict_unprivileged_userns=1`, so an unconfined process
cannot create the user namespace Chromium's sandbox needs. Electron falls back to the SUID
helper and aborts if it is not root-owned.

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Re-run after any `npm install`, which replaces the binary. `npm run desktop:install` detects
this and prints the commands.

Adding `--no-sandbox` also "works" and is **not** recommended: this app renders a third-party
site, and the flag removes its OS sandbox entirely. Installing the `.deb` is the durable
answer — its post-install script sets the ownership and ships an AppArmor profile.

#### `ELECTRON_RUN_AS_NODE`

VS Code's Electron host exports `ELECTRON_RUN_AS_NODE=1` into every terminal it spawns. With
it set, Electron runs the main script as **plain Node**: `require('electron')` returns a path
string instead of the module, so you get `TypeError: Cannot read properties of undefined
(reading 'isPackaged')` — or, from a packaged binary, a silent exit with no output at all.

The `dev` and `start` scripts unset it, and both generated `.desktop` files put
`env -u ELECTRON_RUN_AS_NODE` in their `Exec`. If you launch Electron by hand, do the same:

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
```

#### A note on `.bin/electron`

`node_modules/.bin/electron` is a symlink to `cli.js`, a Node script that spawns the real
binary as a child. That works from a terminal but not from the desktop — the app starts and
immediately dies. Both generated `.desktop` files point at
`node_modules/electron/dist/electron` directly for this reason.

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
| Priority alerts (keyword → persistent notification) | ✅ Verified: urgency=2 on D-Bus, no duplicate, click opens the chat |
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
