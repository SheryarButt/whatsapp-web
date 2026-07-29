import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Launch at login.
 *
 * app.setLoginItemSettings() is a NO-OP on Linux — browser_linux.cc implements
 * it as an empty function, so "enable autostart" appears to succeed and does
 * nothing. The XDG autostart spec is the actual mechanism: drop a .desktop file
 * in $XDG_CONFIG_HOME/autostart and the session runs it at login.
 */
const ENTRY_NAME = 'com.sheryar.WhatsAppMulti.desktop'

/** Passed to the autostart launch so it comes up in the tray, not on screen. */
export const HIDDEN_FLAG = '--hidden'

function autostartDir(): string {
  const configHome = process.env['XDG_CONFIG_HOME'] || join(app.getPath('home'), '.config')
  return join(configHome, 'autostart')
}

function entryPath(): string {
  return join(autostartDir(), ENTRY_NAME)
}

/** Quote for a .desktop Exec= value, which splits on unquoted whitespace. */
function quote(value: string): string {
  return `"${value.replace(/(["`$\\])/g, '\\$1')}"`
}

function execLine(): string {
  if (app.isPackaged) {
    return `${quote(process.execPath)} ${HIDDEN_FLAG}`
  }
  // From source, process.execPath is the Electron binary and getAppPath() is the
  // project root. `env -u ELECTRON_RUN_AS_NODE` is required: if that variable is
  // inherited from the session, Electron runs the main script as plain Node and
  // exits silently.
  return `env -u ELECTRON_RUN_AS_NODE ${quote(process.execPath)} ${quote(app.getAppPath())} ${HIDDEN_FLAG}`
}

export function isSupported(): boolean {
  return process.platform === 'linux'
}

export function isEnabled(): boolean {
  if (!isSupported()) return false
  try {
    const contents = readFileSync(entryPath(), 'utf8')
    // Some desktop editors disable an entry by flipping these rather than
    // deleting the file.
    if (/^Hidden\s*=\s*true\s*$/im.test(contents)) return false
    if (/^X-GNOME-Autostart-enabled\s*=\s*false\s*$/im.test(contents)) return false
    return true
  } catch {
    return false
  }
}

export function setEnabled(enabled: boolean): boolean {
  if (!isSupported()) return false

  try {
    if (!enabled) {
      rmSync(entryPath(), { force: true })
      console.log('[autostart] disabled')
      return true
    }

    mkdirSync(autostartDir(), { recursive: true })
    writeFileSync(
      entryPath(),
      `[Desktop Entry]
Type=Application
Name=WhatsApp Multi
Comment=Multi-account WhatsApp Web client
Exec=${execLine()}
Icon=whatsapp-multi
Terminal=false
Categories=Network;InstantMessaging;
StartupWMClass=com.sheryar.WhatsAppMulti
X-GNOME-Autostart-enabled=true
`,
      'utf8',
    )
    console.log(`[autostart] enabled -> ${entryPath()}`)
    return true
  } catch (err) {
    console.warn('[autostart] could not update entry:', err)
    return false
  }
}

/** True when this process was launched by the autostart entry. */
export function launchedHidden(): boolean {
  return process.argv.includes(HIDDEN_FLAG)
}

export function entryLocation(): string {
  return entryPath()
}
