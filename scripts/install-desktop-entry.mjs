#!/usr/bin/env node
/**
 * Install (or remove) a desktop entry for the DEVELOPMENT build.
 *
 * On Wayland a window has no icon of its own — the compositor matches the
 * window's app_id to an installed .desktop file and uses that file's Icon=.
 * Electron derives app_id from app.setDesktopName(), which we set to
 * com.sheryar.WhatsAppMulti.desktop, so GNOME looks for a file of exactly that
 * name. Without one you get a generic placeholder in the dock, the switcher and
 * on notifications.
 *
 * Packaged .deb builds get this from electron-builder; this script is only for
 * running from source.
 *
 *   node scripts/install-desktop-entry.mjs            # install
 *   node scripts/install-desktop-entry.mjs --remove   # uninstall
 *
 * Everything is written under $XDG_DATA_HOME (~/.local/share) — nothing system
 * wide, no sudo.
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_ID = 'com.sheryar.WhatsAppMulti'
const ICON_NAME = 'whatsapp-multi' // matches electron-builder's executableName
const SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512]

const DATA_HOME = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
const APPS_DIR = join(DATA_HOME, 'applications')
const ICONS_DIR = join(DATA_HOME, 'icons', 'hicolor')
const DESKTOP_FILE = join(APPS_DIR, `${APP_ID}.desktop`)

const remove = process.argv.includes('--remove')

function refreshCaches() {
  for (const [cmd, args] of [
    ['update-desktop-database', [APPS_DIR]],
    ['gtk-update-icon-cache', ['-f', '-t', ICONS_DIR]],
  ]) {
    try {
      execFileSync(cmd, args, { stdio: 'ignore' })
    } catch {
      // Both are optional; GNOME picks changes up on its own soon enough.
    }
  }
}

if (remove) {
  rmSync(DESKTOP_FILE, { force: true })
  for (const size of SIZES) {
    rmSync(join(ICONS_DIR, `${size}x${size}`, 'apps', `${ICON_NAME}.png`), { force: true })
  }
  refreshCaches()
  console.log(`removed ${DESKTOP_FILE} and its icons`)
  process.exit(0)
}

const source = join(PROJECT, 'build', 'icons')
if (!existsSync(join(source, '256x256.png'))) {
  console.error('build/icons is missing — run: node scripts/generate-icons.mjs')
  process.exit(1)
}

for (const size of SIZES) {
  const dest = join(ICONS_DIR, `${size}x${size}`, 'apps')
  mkdirSync(dest, { recursive: true })
  copyFileSync(join(source, `${size}x${size}.png`), join(dest, `${ICON_NAME}.png`))
}

const electron = join(PROJECT, 'node_modules', '.bin', 'electron')

// `env -u ELECTRON_RUN_AS_NODE` matters: if the variable is inherited, Electron
// runs the main script as plain Node and the app exits silently.
mkdirSync(APPS_DIR, { recursive: true })
writeFileSync(
  DESKTOP_FILE,
  `[Desktop Entry]
Type=Application
Name=WhatsApp Multi (dev)
Comment=Multi-account WhatsApp Web client
Exec=env -u ELECTRON_RUN_AS_NODE ${electron} ${PROJECT}
Path=${PROJECT}
Icon=${ICON_NAME}
Terminal=false
Categories=Network;InstantMessaging;
Keywords=whatsapp;chat;messaging;
StartupNotify=true
StartupWMClass=${APP_ID}
`,
  'utf8',
)

refreshCaches()
console.log(`installed ${DESKTOP_FILE}`)
console.log(`icons     ${ICONS_DIR}/<size>/apps/${ICON_NAME}.png`)
console.log('\nRestart the app so the compositor re-matches its app_id.')
