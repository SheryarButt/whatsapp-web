import { Menu, app, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import * as autostart from './autostart'

export interface AppMenuActions {
  win: BrowserWindow
  addAccount: () => void
  reloadActive: () => void
  /** Called after the setting changes so every surface can be refreshed. */
  onAutostartChanged: () => void
}

/**
 * The window menu bar.
 *
 * Without setApplicationMenu() Electron shows its stock File/Edit/View menu,
 * which exposes nothing about this app. Note the "Start at login" checkbox is
 * rebuilt rather than mutated — the same constraint as the tray, and it keeps
 * this menu in sync when the setting is changed from the tray or the ⚙ button.
 */
export function installAppMenu(actions: AppMenuActions): void {
  const { win, addAccount, reloadActive, onAutostartChanged } = actions

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'Add account', accelerator: 'CmdOrCtrl+N', click: addAccount },
        { label: 'Reload current account', accelerator: 'CmdOrCtrl+R', click: reloadActive },
        { type: 'separator' },
        {
          label: 'Start at login',
          type: 'checkbox',
          checked: autostart.isEnabled(),
          enabled: autostart.isSupported(),
          click: (item) => {
            autostart.setEnabled(item.checked)
            onAutostartChanged()
          },
        },
        { type: 'separator' },
        { label: 'Hide to tray', accelerator: 'CmdOrCtrl+W', click: () => win.hide() },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged
          ? []
          : ([{ type: 'separator' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: `WhatsApp Multi ${app.getVersion()}`, enabled: false },
        { label: `Electron ${process.versions.electron}`, enabled: false },
        { type: 'separator' },
        {
          label: 'Autostart entry location',
          click: () => void shell.showItemInFolder(autostart.entryLocation()),
          enabled: autostart.isSupported() && autostart.isEnabled(),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
