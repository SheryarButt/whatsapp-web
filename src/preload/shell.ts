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

  processIds: (): Promise<Record<string, number> | null> => ipcRenderer.invoke('shell:processIds'),

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
