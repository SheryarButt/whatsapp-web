import { rm } from 'node:fs/promises'
import {
  Menu,
  Notification,
  app,
  ipcMain,
  session,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron'
import type { ShellState } from '../shared/types'
import type { AccountViewManager } from './account-view'
import type { AppTray } from './tray'
import * as autostart from './autostart'
import { refreshMenus } from './menu-refresh'
import {
  addAccount,
  getConfig,
  removeAccount,
  renameAccount,
  setActiveAccount,
  getAlerts,
  setAlerts,
} from './config-store'
import { accountSessionDir } from './paths'
import { setLauncherBadge } from './badge'
import { iconPath } from './icons'
import { allUnread, forgetUnread, sanitize, setUnread, totalDirect } from './unread'

export function shellState(): ShellState {
  const c = getConfig()
  return {
    accounts: c.accounts,
    activeAccountId: c.activeAccountId,
    unread: allUnread(c.accounts.map((a) => a.id)),
    alerts: c.alerts,
  }
}

export interface IpcApi {
  broadcast: () => void
  activate: (accountId: string) => void
  /** Same action as the + button, for the menu bar. */
  addAccount: () => void
  /** Reload whichever account is on screen. */
  reloadActive: () => void
}

export function registerIpc(
  win: BrowserWindow,
  views: AccountViewManager,
  tray: AppTray | null,
): IpcApi {
  const broadcast = (): void => {
    const state = shellState()
    if (!win.isDestroyed()) win.webContents.send('shell:state', state)
    // Account count decides whether notifications get a name prefix, so labels
    // are recomputed whenever the account set changes.
    views.pushAllLabels()
    views.pushAllAlerts(state.alerts)
    const total = totalDirect(state.accounts.map((a) => a.id))
    setLauncherBadge(total)
    tray?.update({ ...state, total })
  }

  const activate = (accountId: string): void => {
    const account = getConfig().accounts.find((a) => a.id === accountId)
    if (!account) return
    views.ensure(account)
    setActiveAccount(accountId)
    views.setActive(accountId)
    broadcast()
  }

  /**
   * Only the shell renderer may drive these channels. The account views run
   * third-party code and share this ipcMain, so every handler checks the sender.
   * senderFrame is nullable after navigation — guard it or the handler throws.
   */
  const fromShell = (event: IpcMainInvokeEvent): boolean => {
    return !win.isDestroyed() && event.sender.id === win.webContents.id
  }

  ipcMain.handle('shell:getState', (event) => {
    if (!fromShell(event)) return null
    return shellState()
  })

  ipcMain.handle('shell:addAccount', (event, name: unknown) => {
    if (!fromShell(event)) return null
    const account = addAccount(typeof name === 'string' ? name : '')
    views.ensure(account)
    setActiveAccount(account.id)
    views.setActive(account.id)
    broadcast()
    return shellState()
  })

  ipcMain.handle('shell:activateAccount', (event, id: unknown) => {
    if (!fromShell(event) || typeof id !== 'string') return null
    if (!getConfig().accounts.some((a) => a.id === id)) return null
    activate(id)
    return shellState()
  })

  ipcMain.handle('shell:renameAccount', (event, id: unknown, name: unknown) => {
    if (!fromShell(event) || typeof id !== 'string' || typeof name !== 'string') return null
    renameAccount(id, name)
    broadcast()
    return shellState()
  })

  ipcMain.handle('shell:removeAccount', async (event, id: unknown) => {
    if (!fromShell(event) || typeof id !== 'string') return null
    const removed = removeAccount(id)
    if (!removed) return shellState()
    forgetUnread(id)

    // Order matters. Tear the renderer down FIRST so the session has no live
    // clients, then clear, then remove the directory. Note this is still
    // best-effort: WhatsApp's service worker can keep the session writing after
    // close, so pruneOrphanAccountDirs() sweeps survivors at next startup.
    //
    // Do NOT call session.fromPath() on a directory that has no live session —
    // it would create one, and the directory with it.
    const dir = accountSessionDir(id)
    const hadView = views.has(id)
    views.destroy(id)

    if (hadView) {
      try {
        const ses = session.fromPath(dir)
        await ses.clearStorageData()
        await ses.clearCache()
      } catch (err) {
        console.warn('[account] clearStorageData failed', err)
      }
    }

    try {
      await rm(dir, { recursive: true, force: true })
    } catch (err) {
      console.warn('[account] directory removal failed', err)
    }

    const next = getConfig().activeAccountId
    if (next) {
      const account = getConfig().accounts.find((a) => a.id === next)
      if (account) views.ensure(account)
    }
    views.setActive(next)
    broadcast()
    return shellState()
  })

  /**
   * Native right-click menu for a tab. Rename and remove are routed back to the
   * renderer rather than executed here so the inline editor and the confirm
   * dialog stay in one place.
   */
  ipcMain.handle('shell:tabMenu', (event, id: unknown) => {
    if (!fromShell(event) || typeof id !== 'string') return null
    const account = getConfig().accounts.find((a) => a.id === id)
    if (!account) return null

    Menu.buildFromTemplate([
      { label: `Rename “${account.name}”…`, click: () => win.webContents.send('shell:beginRename', id) },
      { label: 'Reload', click: () => views.reload(id) },
      { type: 'separator' },
      { label: 'Remove account…', click: () => win.webContents.send('shell:confirmRemove', id) },
    ]).popup({ window: win })

    return null
  })

  ipcMain.handle('shell:settingsMenu', (event) => {
    if (!fromShell(event)) return null

    Menu.buildFromTemplate([
      {
        label: 'Start at login',
        type: 'checkbox',
        checked: autostart.isEnabled(),
        enabled: autostart.isSupported(),
        click: (item) => {
          if (!autostart.setEnabled(item.checked)) {
            // Writing failed — put the tick back so the UI never claims a
            // setting that did not take.
            item.checked = autostart.isEnabled()
          }
          refreshMenus()
        },
      },
      {
        label: 'Priority alerts…',
        click: () => {
          // Account views paint above the DOM, so the panel is invisible until
          // they are hidden.
          views.setActive(null)
          win.webContents.send('shell:openAlerts')
        },
      },
      { type: 'separator' },
      { label: `WhatsApp Multi ${app.getVersion()}`, enabled: false },
      { label: 'Quit', click: () => app.quit() },
    ]).popup({ window: win })

    return null
  })

  ipcMain.handle('shell:closeAlerts', (event) => {
    if (!fromShell(event)) return null
    views.setActive(getConfig().activeAccountId)
    return shellState()
  })

  ipcMain.handle('shell:setAlerts', (event, next: unknown) => {
    if (!fromShell(event)) return null
    const saved = setAlerts(next)
    views.pushAllAlerts(saved)
    broadcast()
    console.log(
      `[alerts] ${saved.enabled ? 'on' : 'off'}, ${saved.keywords.length} keyword(s), ` +
        `wholeWord=${saved.wholeWord}`,
    )
    return shellState()
  })

  ipcMain.handle('shell:processIds', (event) => {
    if (!fromShell(event)) return null
    return views.processIds()
  })

  // -------------------------------------------------------------------------
  // Channels from the account views (web.whatsapp.com). These carry no
  // authority: the sender is resolved to an account by webContents id, and
  // anything we don't recognise is dropped.
  // -------------------------------------------------------------------------

  ipcMain.on('wa:shim-status', (event, status: unknown) => {
    const accountId = views.accountIdForWebContentsId(event.sender.id)
    if (!accountId) return
    const who = accountId.slice(0, 8)
    const s = String(status)
    if (s === 'installed' || s === 'already-wrapped') {
      console.log(`[notify] shim ${s} for ${who}`)
    } else {
      // executeInMainWorld is Experimental; a silent failure here would cost
      // click routing and the service-worker fallback without any other symptom.
      console.error(`[notify] SHIM NOT INSTALLED for ${who}: ${s}`)
    }
  })

  ipcMain.on('wa:unread', (event, payload: unknown) => {
    const accountId = views.accountIdForWebContentsId(event.sender.id)
    if (!accountId) return
    const report = sanitize(payload)
    if (!setUnread(accountId, report)) return

    // Full broadcast so the rail, launcher badge and tray all stay in sync.
    broadcast()

    const total = totalDirect(getConfig().accounts.map((a) => a.id))
    console.log(
      `[unread] ${accountId.slice(0, 8)} status=${report.status} ` +
        `direct=${report.direct} muted=${report.muted} marked=${report.markedUnread} ` +
        `| launcher total=${total}`,
    )
  })

  /**
   * A keyword matched inside the page, which suppressed WhatsApp's own
   * notification. Fire the prominent one here — `urgency` and `timeoutType`
   * exist only on the main-process Notification, which is the whole reason the
   * page's version has to be suppressed rather than augmented.
   */
  ipcMain.on('wa:priority-notification', (event, payload: unknown) => {
    const accountId = views.accountIdForWebContentsId(event.sender.id)
    if (!accountId) return

    const p = (payload ?? {}) as { id?: number; title?: string; body?: string; keyword?: string }
    const alertId = Number(p.id) | 0
    const account = getConfig().accounts.find((a) => a.id === accountId)
    const who = account ? account.name : 'WhatsApp'
    const title = String(p.title ?? '').slice(0, 200)
    const body = String(p.body ?? '').slice(0, 500)
    const keyword = String(p.keyword ?? '').slice(0, 100)

    if (!Notification.isSupported()) {
      console.warn('[alerts] notifications unsupported; cannot escalate')
      return
    }

    const n = new Notification({
      title: `🔴 ${who} — ${title}`,
      body,
      // GNOME keeps urgency=critical on screen until dismissed; normal ones
      // auto-expire after a few seconds.
      urgency: 'critical',
      timeoutType: 'never',
      icon: iconPath(256),
    })

    n.on('click', () => {
      if (win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      activate(accountId)
      // Replay into WhatsApp's own handler so it opens the right chat.
      views.sendPriorityClick(accountId, alertId)
    })

    n.show()
    console.log(`[alerts] escalated ${accountId.slice(0, 8)} on "${keyword}": ${JSON.stringify(title)}`)
  })

  ipcMain.on('wa:notification-shown', (event, payload: unknown) => {
    const accountId = views.accountIdForWebContentsId(event.sender.id)
    if (!accountId) return
    const title = (payload as { title?: string } | null)?.title ?? ''
    console.log(`[notify] ${accountId.slice(0, 8)} shown: ${JSON.stringify(title)}`)
  })

  ipcMain.on('wa:notification-click', (event) => {
    const accountId = views.accountIdForWebContentsId(event.sender.id)
    if (!accountId) return

    // Raise the window and switch to the account that fired the notification.
    // WhatsApp's own click handler then selects the chat within that account.
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()

    activate(accountId)
    console.log(`[notify] click -> activated ${accountId.slice(0, 8)}`)
  })

  const newAccount = (): void => {
    const account = addAccount(`Account ${getConfig().accounts.length + 1}`)
    views.ensure(account)
    setActiveAccount(account.id)
    views.setActive(account.id)
    broadcast()
  }

  const reloadActive = (): void => {
    const id = getConfig().activeAccountId
    if (id) views.reload(id)
  }

  // A view's preload only exists after dom-ready, so rules pushed before that
  // would be dropped silently.
  views.onViewReady = (accountId) => views.pushAlerts(accountId, getAlerts())

  return { broadcast, activate, addAccount: newAccount, reloadActive }
}
