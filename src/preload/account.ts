import { contextBridge, ipcRenderer } from 'electron'
import { startUnreadPolling } from './unread-reader'

/**
 * Injected into web.whatsapp.com. Runs next to third-party code, so the exposed
 * surface is deliberately anaemic: it can only REPORT upward. Nothing here takes
 * a caller-supplied path, URL, or channel name.
 *
 * A session-registered preload runs in EVERY frame, including the about:blank and
 * cross-origin subframes WhatsApp creates. Everything below must run once per
 * page, not once per frame.
 */
const isTopFrame = window.top === window.self

if (isTopFrame) {
  // ---------------------------------------------------------------------------
  // Callbacks handed to the main world. contextBridge copies functions across
  // the world boundary, which is how the shim talks back to us.
  // ---------------------------------------------------------------------------
  const onShown = (title: string, body: string): void => {
    ipcRenderer.send('wa:notification-shown', {
      title: String(title).slice(0, 200),
      body: String(body).slice(0, 500),
    })
  }

  const onClick = (): void => {
    ipcRenderer.send('wa:notification-click')
  }

  /**
   * Install into the PAGE's world, not ours.
   *
   * Measured on Electron 43: `new Notification()` from page context reaches
   * org.freedesktop.Notifications correctly, but
   * ServiceWorkerRegistration.showNotification() resolves its promise and sends
   * nothing at all (electron#13041, open since 2018). So we WRAP the working
   * constructor rather than replacing it, and redirect the broken worker path
   * into it.
   *
   * This cannot be done by assigning to window.Notification from this file:
   * contextIsolation gives the preload a separate JS world that shares the DOM
   * but not globals, so WhatsApp's own code would never see the patch.
   *
   * The function below is SERIALIZED — it must be self-contained, with no
   * closure over anything outside its own parameters.
   */
  function installShim(): unknown {
    return contextBridge.executeInMainWorld({
      func: (shown: (t: string, b: string) => void, clicked: () => void) => {
        const w = window as unknown as Record<string, unknown>
        const Native = w.Notification as (new (t: string, o?: unknown) => unknown) | undefined
        if (!Native) return 'no-Notification-API'
        if ((Native as unknown as Record<string, unknown>).__waWrapped) return 'already-wrapped'

        // Object.defineProperty rather than a static class field: class fields
        // make the bundler emit a helper that would not survive serialization.
        const Wrapped = class extends (Native as new (t: string, o?: unknown) => object) {
          constructor(title: string, options?: { body?: string }) {
            const label = w.__waAccountLabel as string | undefined
            super(label ? label + ' · ' + title : title, options)
            try {
              shown(String(title), String((options && options.body) || ''))
            } catch {
              /* reporting must never break the notification itself */
            }
            try {
              ;(this as unknown as EventTarget).addEventListener('click', () => {
                try {
                  clicked()
                } catch {
                  /* ignore */
                }
              })
            } catch {
              /* ignore */
            }
          }
        }
        Object.defineProperty(Wrapped, '__waWrapped', { value: true })
        w.Notification = Wrapped

        // Redirect the silently-dropped service-worker path into the constructor
        // that actually works. Forward ONLY { body }: passing the full options
        // object is known to make notifications appear intermittently.
        try {
          const swProto = (w.ServiceWorkerRegistration as { prototype?: Record<string, unknown> })
            ?.prototype
          if (swProto) {
            swProto.showNotification = function (title: string, options?: { body?: string }) {
              const N = w.Notification as new (t: string, o?: unknown) => unknown
              new N(String(title), { body: options && options.body })
              return Promise.resolve()
            }
          }
        } catch {
          /* worker path is best-effort */
        }

        return (w.Notification as unknown as Record<string, unknown>).__waWrapped
          ? 'installed'
          : 'failed'
      },
      args: [onShown, onClick],
    })
  }

  let status: string
  try {
    status = String(installShim())
  } catch (err) {
    // executeInMainWorld is marked Experimental — if it ever changes shape, we
    // want a loud signal rather than silently losing click routing.
    status = 'threw: ' + String(err)
  }
  ipcRenderer.send('wa:shim-status', status)

  // Main tells us which account we are once it knows; the shim reads this global
  // at notification time, so ordering does not matter.
  ipcRenderer.on('wa:set-label', (_event, label: string) => {
    try {
      contextBridge.executeInMainWorld({
        func: (l: string) => {
          ;(window as unknown as Record<string, unknown>).__waAccountLabel = l
        },
        args: [String(label || '')],
      })
    } catch {
      /* ignore */
    }
  })

  // Read from IndexedDB in this (isolated) world and report upward. The page is
  // never involved, so a WhatsApp UI rewrite cannot break it — only a storage
  // schema change can, and that surfaces as status 'db-absent'.
  startUnreadPolling((report) => {
    ipcRenderer.send('wa:unread', report)
  })
}
