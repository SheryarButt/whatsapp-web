import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, nativeImage } from 'electron'
import { TAB_BAR_HEIGHT } from '../shared/types'
import { AccountViewManager } from './account-view'
import { clearLauncherBadge } from './badge'
import { iconPath } from './icons'
import { AppTray } from './tray'
import { addAccount, flushConfig, getConfig, loadConfig, setActiveAccount } from './config-store'
import { registerIpc } from './ipc'
import { pruneOrphanAccountDirs } from './prune'
import { cleanUserAgent } from './user-agent'
import { launchedHidden } from './autostart'

// ---------------------------------------------------------------------------
// Pre-ready configuration. Everything here must run before app.whenReady().
// ---------------------------------------------------------------------------

// Keep dev experiments away from real logged-in accounts: a preload edit
// restarts Electron, and schema experiments should not touch the real config.
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'WhatsAppMulti-dev'))
}

// Without this, background accounts are silent — no notification ping and no
// incoming-call ringtone, because a hidden view has received no user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// NOTE: deliberately NOT setting webRTCIPHandlingPolicy. Any value other than
// the default (notably 'disable_non_proxied_udp') makes WhatsApp calls hang
// forever at "connecting" behind a bogus network error.

// The single key behind the notification icon, Wayland app_id / X11 WM_CLASS,
// taskbar grouping, and the launcher badge. Electron gives no error if unset;
// four separate things just quietly break.
if (process.platform === 'linux') {
  app.setDesktopName('com.sheryar.WhatsAppMulti.desktop')
}

let mainWindow: BrowserWindow | null = null
/** Set on before-quit so close-to-tray knows a real quit is in progress. */
let isQuitting = false
let views: AccountViewManager | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 560,
    minHeight: TAB_BAR_HEIGHT + 460,
    show: false,
    backgroundColor: '#111b21',
    title: 'WhatsApp Multi',
    // Used directly on X11. On Wayland the icon actually comes from the
    // .desktop file matching our app_id — see scripts/install-desktop-entry.mjs.
    icon: nativeImage.createFromPath(iconPath(256)),
    webPreferences: {
      preload: join(__dirname, '../preload/shell.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void win.loadURL(rendererUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/**
 * app.quit() is asynchronous: on its own it does NOT stop this script, so a
 * second instance would still reach whenReady, mint an account, create a
 * session directory, and only then die — leaving orphaned dirs behind and
 * racing the real instance's config writes. exit(0) stops immediately and
 * deliberately skips before-quit so it cannot flush anything.
 */
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  bootstrap()
}

function bootstrap(): void {
  app.whenReady().then(onReady)

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
    flushConfig()
    // Otherwise a stale count sticks to the dock icon after we exit.
    clearLauncherBadge()
  })
}

/**
 * A missing desktop entry breaks the window icon, the switcher icon, the
 * notification icon and the launcher badge — all silently, with a generic
 * placeholder as the only symptom. Say so plainly at startup.
 */
function checkDesktopEntry(): void {
  if (process.platform !== 'linux') return

  const name = process.env['CHROME_DESKTOP']
  if (!name) {
    console.warn('[desktop] CHROME_DESKTOP unset — setDesktopName() did not take effect')
    return
  }

  const dataHome = process.env['XDG_DATA_HOME'] || join(app.getPath('home'), '.local', 'share')
  const dataDirs = (process.env['XDG_DATA_DIRS'] || '/usr/local/share:/usr/share').split(':')
  const found = [dataHome, ...dataDirs]
    .filter(Boolean)
    .map((dir) => join(dir, 'applications', name))
    .find((candidate) => existsSync(candidate))

  if (found) {
    console.log(`[desktop] app_id=${name.replace(/\.desktop$/, '')} -> ${found}`)
  } else {
    console.warn(
      `[desktop] no ${name} installed — the app will show a generic icon.\n` +
        '          Run: npm run desktop:install',
    )
  }
}

function onReady(): void {
  // Must happen before any view is created.
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback)

  checkDesktopEntry()

  loadConfig()

  mainWindow = createWindow()
  // Prefix notifications with the account name only when there is more than one
  // account — with a single account it would be pure noise.
  views = new AccountViewManager(mainWindow, (accountId) => {
    const { accounts } = getConfig()
    if (accounts.length < 2) return ''
    return accounts.find((a) => a.id === accountId)?.name ?? ''
  })
  // The tray's activate handler is only available after registerIpc returns, so
  // it is routed through a mutable reference.
  let activate: (accountId: string) => void = () => {}
  const tray = new AppTray(mainWindow, (id) => activate(id))
  const hasTray = tray.init()

  const api = registerIpc(mainWindow, views, hasTray ? tray : null)
  activate = api.activate

  // Started by the autostart entry: stay in the tray rather than stealing focus
  // at login. Without a tray there would be no way back, so show it anyway.
  const startHidden = launchedHidden() && hasTray
  mainWindow.once('ready-to-show', () => {
    if (startHidden) console.log('[autostart] launched hidden; use the tray to open')
    else mainWindow?.show()
  })

  /**
   * Close-to-tray. Accounts must stay alive for notifications to arrive, so
   * closing the window hides it instead of quitting — but ONLY when there is a
   * tray to restore it from, otherwise the app would become unreachable.
   */
  if (hasTray) {
    mainWindow.on('close', (event) => {
      if (isQuitting || !mainWindow) return
      event.preventDefault()
      mainWindow.hide()
    })
  }

  // Must run before any view is created: session.fromPath() re-creates whatever
  // directory it is handed, so an orphan can only be swept while no Session
  // object exists for it.
  pruneOrphanAccountDirs()

  const config = getConfig()

  // First run: give the user something to scan a QR code into.
  if (config.accounts.length === 0) {
    const first = addAccount('Account 1')
    setActiveAccount(first.id)
  }

  for (const account of getConfig().accounts) {
    views.ensure(account)
  }
  views.setActive(getConfig().activeAccountId)
  api.broadcast()

  mainWindow.on('closed', () => {
    views?.destroyAll()
    views = null
    mainWindow = null
  })
}
