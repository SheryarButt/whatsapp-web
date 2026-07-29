import { rm } from 'node:fs/promises'
import { ipcMain, session, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { ShellState } from '../shared/types'
import type { AccountViewManager } from './account-view'
import {
  addAccount,
  getConfig,
  removeAccount,
  renameAccount,
  setActiveAccount,
} from './config-store'
import { accountSessionDir } from './paths'
import { setLauncherBadge } from './badge'
import { allUnread, forgetUnread, sanitize, setUnread, totalDirect } from './unread'

export function shellState(): ShellState {
  const c = getConfig()
  return {
    accounts: c.accounts,
    activeAccountId: c.activeAccountId,
    unread: allUnread(c.accounts.map((a) => a.id)),
  }
}

export function registerIpc(win: BrowserWindow, views: AccountViewManager): void {
  const broadcast = (): void => {
    if (!win.isDestroyed()) win.webContents.send('shell:state', shellState())
    // Account count decides whether notifications get a name prefix, so labels
    // are recomputed whenever the account set changes.
    views.pushAllLabels()
    setLauncherBadge(totalDirect(getConfig().accounts.map((a) => a.id)))
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
    const account = getConfig().accounts.find((a) => a.id === id)
    if (!account) return null
    views.ensure(account)
    setActiveAccount(id)
    views.setActive(id)
    broadcast()
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

    const ids = getConfig().accounts.map((a) => a.id)
    setLauncherBadge(totalDirect(ids))
    if (!win.isDestroyed()) win.webContents.send('shell:state', shellState())

    const total = totalDirect(ids)
    console.log(
      `[unread] ${accountId.slice(0, 8)} status=${report.status} ` +
        `direct=${report.direct} muted=${report.muted} marked=${report.markedUnread} ` +
        `| launcher total=${total}`,
    )
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

    setActiveAccount(accountId)
    views.setActive(accountId)
    broadcast()
    console.log(`[notify] click -> activated ${accountId.slice(0, 8)}`)
  })
}
