import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ShellState } from '../shared/types'

/**
 * Privileged bridge for our OWN renderer only. Note that raw ipcRenderer.on is
 * never exposed — onState wraps it and hands back an unsubscribe function, so
 * the renderer cannot listen on arbitrary channels.
 */
const api = {
  getState: (): Promise<ShellState | null> => ipcRenderer.invoke('shell:getState'),

  addAccount: (name: string): Promise<ShellState | null> =>
    ipcRenderer.invoke('shell:addAccount', name),

  activateAccount: (id: string): Promise<ShellState | null> =>
    ipcRenderer.invoke('shell:activateAccount', id),

  renameAccount: (id: string, name: string): Promise<ShellState | null> =>
    ipcRenderer.invoke('shell:renameAccount', id, name),

  removeAccount: (id: string): Promise<ShellState | null> =>
    ipcRenderer.invoke('shell:removeAccount', id),

  /** Pops the native per-tab menu (rename / reload / remove). */
  tabMenu: (id: string): Promise<null> => ipcRenderer.invoke('shell:tabMenu', id),

  /** Pops the native app menu (start at login, version, quit). */
  settingsMenu: (): Promise<null> => ipcRenderer.invoke('shell:settingsMenu'),

  processIds: (): Promise<Record<string, number> | null> => ipcRenderer.invoke('shell:processIds'),

  setAlerts: (alerts: {
    enabled: boolean
    keywords: string[]
    wholeWord: boolean
  }): Promise<ShellState | null> => ipcRenderer.invoke('shell:setAlerts', alerts),

  /** Restores the account view that the alerts panel was covering. */
  closeAlerts: (): Promise<ShellState | null> => ipcRenderer.invoke('shell:closeAlerts'),

  onOpenAlerts: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('shell:openAlerts', handler)
    return () => {
      ipcRenderer.removeListener('shell:openAlerts', handler)
    }
  },

  /** Main asks us to open the inline rename editor for a tab. */
  onBeginRename: (cb: (id: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('shell:beginRename', handler)
    return () => {
      ipcRenderer.removeListener('shell:beginRename', handler)
    }
  },

  /** Main asks us to confirm removal — the dialog lives renderer-side. */
  onConfirmRemove: (cb: (id: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('shell:confirmRemove', handler)
    return () => {
      ipcRenderer.removeListener('shell:confirmRemove', handler)
    }
  },

  onState: (cb: (state: ShellState) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, state: ShellState): void => cb(state)
    ipcRenderer.on('shell:state', handler)
    return () => {
      ipcRenderer.removeListener('shell:state', handler)
    }
  },
}

contextBridge.exposeInMainWorld('shell', api)

export type ShellApi = typeof api
