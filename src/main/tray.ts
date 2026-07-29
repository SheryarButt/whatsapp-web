import { join } from 'node:path'
import { Menu, Tray, app, nativeImage, type BrowserWindow } from 'electron'
import type { AccountRecord, UnreadReport } from '../shared/types'

export interface TrayState {
  accounts: AccountRecord[]
  activeAccountId: string | null
  unread: Record<string, UnreadReport>
  total: number
}

function iconPath(size: number): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icons', `${size}x${size}.png`)
    : join(__dirname, '..', '..', 'build', 'icons', `${size}x${size}.png`)
}

/**
 * Status-icon integration.
 *
 * Electron's Linux tray speaks StatusNotifierItem over D-Bus (verified: this
 * session owns org.kde.StatusNotifierWatcher). Two Linux caveats drive the
 * design here:
 *   - MenuItem properties do not update in place; the WHOLE menu must be
 *     rebuilt and re-set on every change.
 *   - tray.setTitle() is a no-op, so unread has to go in the tooltip and the
 *     menu labels rather than beside the icon.
 */
export class AppTray {
  private tray: Tray | null = null

  constructor(
    private readonly win: BrowserWindow,
    private readonly onActivate: (accountId: string) => void,
  ) {}

  /** @returns true if the tray was actually created. */
  init(): boolean {
    try {
      const image = nativeImage.createFromPath(iconPath(22))
      if (image.isEmpty()) {
        console.warn('[tray] icon missing or unreadable; tray disabled')
        return false
      }
      this.tray = new Tray(image)
      this.tray.setToolTip('WhatsApp Multi')
      // On Linux 'click' fires on activation, which may not be a left click and
      // is unreliable — the context menu is the supported interaction.
      this.tray.on('click', () => this.toggleWindow())
      return true
    } catch (err) {
      console.warn('[tray] unavailable:', err)
      return false
    }
  }

  private toggleWindow(): void {
    if (this.win.isDestroyed()) return
    if (this.win.isVisible() && !this.win.isMinimized()) {
      this.win.hide()
    } else {
      this.showWindow()
    }
  }

  private showWindow(): void {
    if (this.win.isDestroyed()) return
    if (this.win.isMinimized()) this.win.restore()
    this.win.show()
    this.win.focus()
  }

  /** Rebuild and re-set the entire menu — required on Linux for any change. */
  update(state: TrayState): void {
    if (!this.tray) return

    const accountItems = state.accounts.map((account) => {
      const u = state.unread[account.id]
      const suffix =
        u && u.status === 'ok' && u.direct > 0
          ? `  (${u.direct})`
          : u && u.status === 'ok' && (u.muted > 0 || u.markedUnread > 0)
            ? '  •'
            : ''
      return {
        label: `${account.name}${suffix}`,
        type: 'radio' as const,
        checked: account.id === state.activeAccountId,
        click: () => {
          this.onActivate(account.id)
          this.showWindow()
        },
      }
    })

    const menu = Menu.buildFromTemplate([
      {
        label: state.total > 0 ? `${state.total} unread` : 'No unread messages',
        enabled: false,
      },
      { type: 'separator' },
      ...(accountItems.length > 0
        ? accountItems
        : [{ label: 'No accounts', enabled: false as const }]),
      { type: 'separator' },
      { label: 'Show / hide window', click: () => this.toggleWindow() },
      { label: 'Quit', click: () => app.quit() },
    ])

    this.tray.setContextMenu(menu)
    this.tray.setToolTip(
      state.total > 0 ? `WhatsApp Multi — ${state.total} unread` : 'WhatsApp Multi',
    )
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
