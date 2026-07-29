import { execFile } from 'node:child_process'

/**
 * Unread badge on the launcher icon.
 *
 * Deliberately NOT app.setBadgeCount(): Electron 44 removes Unity support
 * entirely (electron#51649), turning it into a macOS-only API. Emitting the
 * D-Bus signal ourselves is what libunity did anyway, keeps working after that
 * removal, and also covers KDE and dash-to-dock.
 *
 * Verified on this machine: Ubuntu Dock is enabled and com.canonical.Unity is
 * owned on the session bus, and the signal below is accepted with the expected
 * (sa{sv}) shape. Consumers listen by match rule, so we do not need to own a
 * bus name.
 */
const DESKTOP_ID = 'com.sheryar.WhatsAppMulti.desktop'
const OBJECT_PATH = '/com/canonical/unity/launcherentry/whatsappmulti'
const IFACE = 'com.canonical.Unity.LauncherEntry.Update'

let lastEmitted: number | null = null
let disabled = false

export function setLauncherBadge(count: number): void {
  if (disabled || process.platform !== 'linux') return

  const n = Math.max(0, Math.trunc(Number(count) || 0))
  if (n === lastEmitted) return // avoid spawning a process on every poll
  lastEmitted = n

  execFile(
    'gdbus',
    [
      'emit',
      '--session',
      '--object-path',
      OBJECT_PATH,
      '--signal',
      IFACE,
      `application://${DESKTOP_ID}`,
      `{'count': <int64 ${n}>, 'count-visible': <${n > 0}>}`,
    ],
    (err) => {
      if (!err) return
      // Missing gdbus or no session bus: stop trying rather than spawn on every
      // change. The in-app rail badges are unaffected.
      disabled = true
      console.warn('[badge] launcher badge disabled:', err.message)
    },
  )
}

/** Clear on quit so a stale count does not persist on the dock icon. */
export function clearLauncherBadge(): void {
  setLauncherBadge(0)
}
