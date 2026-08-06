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

  /** A keyword matched: main fires the prominent notification instead. */
  const onPriority = (id: number, title: string, body: string, keyword: string): void => {
    ipcRenderer.send('wa:priority-notification', {
      id: Number(id) | 0,
      title: String(title).slice(0, 200),
      body: String(body).slice(0, 500),
      keyword: String(keyword).slice(0, 100),
    })
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
   * A Proxy rather than a subclass, because priority messages must NOT create a
   * native notification at all — `urgency` is only settable on Electron's
   * main-process Notification, so main fires those. A subclass cannot skip its
   * own super() call; a construct trap can return a stand-in instead.
   *
   * The function below is SERIALIZED — it must be self-contained, with no
   * closure over anything outside its own parameters.
   */
  function installShim(): unknown {
    return contextBridge.executeInMainWorld({
      func: (
        shown: (t: string, b: string) => void,
        clicked: () => void,
        priority: (id: number, t: string, b: string, k: string) => void,
      ) => {
        const w = window as unknown as Record<string, unknown>
        const Native = w.Notification as (new (t: string, o?: unknown) => object) | undefined
        if (!Native) return 'no-Notification-API'
        if ((Native as unknown as Record<string, unknown>).__waWrapped) return 'already-wrapped'

        w.__waAlerts = { enabled: false, keywords: [] as string[], wholeWord: true }
        const pending = new Map<number, EventTarget>()
        w.__waPending = pending
        let seq = 0

        // \b is ASCII-only in JS, which would break word matching inside
        // non-Latin text — this app is explicitly multilingual.
        const isWordChar = (ch: string | undefined): boolean =>
          ch !== undefined && /[\p{L}\p{N}_]/u.test(ch)

        const matchKeyword = (text: string): string | null => {
          const cfg = w.__waAlerts as { enabled: boolean; keywords: string[]; wholeWord: boolean }
          if (!cfg || !cfg.enabled || cfg.keywords.length === 0) return null
          const hay = String(text || '').toLowerCase()
          for (const word of cfg.keywords) {
            let from = 0
            for (;;) {
              const at = hay.indexOf(word, from)
              if (at === -1) break
              if (!cfg.wholeWord) return word
              const before = at === 0 ? undefined : hay[at - 1]
              const after = hay[at + word.length]
              if (!isWordChar(before) && !isWordChar(after)) return word
              from = at + 1
            }
          }
          return null
        }

        /**
         * Stand-in for a suppressed notification. WhatsApp keeps the returned
         * object and sets .onclick / calls .close(), so this has to behave like
         * a Notification even though nothing was shown by the page.
         */
        const makeStub = (title: string, options: { body?: string; tag?: string }): EventTarget => {
          const stub = new EventTarget() as EventTarget & Record<string, unknown>
          stub.title = title
          stub.body = (options && options.body) || ''
          stub.tag = (options && options.tag) || ''
          stub.close = () => {
            try {
              stub.dispatchEvent(new Event('close'))
            } catch {
              /* ignore */
            }
          }
          let handler: EventListener | null = null
          Object.defineProperty(stub, 'onclick', {
            get: () => handler,
            set: (fn) => {
              if (handler) stub.removeEventListener('click', handler)
              handler = typeof fn === 'function' ? (fn as EventListener) : null
              if (handler) stub.addEventListener('click', handler)
            },
            configurable: true,
          })
          return stub
        }

        // Lets main deliver a click on the notification it fired back into
        // WhatsApp's own handler, which is what opens the right chat.
        w.__waFireAlertClick = (id: number): boolean => {
          const stub = pending.get(id)
          if (!stub) return false
          pending.delete(id)
          try {
            stub.dispatchEvent(new Event('click'))
          } catch {
            /* ignore */
          }
          return true
        }

        const Wrapped = new Proxy(Native, {
          construct(target, args) {
            const title = String(args[0] == null ? '' : args[0])
            const options = (args[1] || {}) as { body?: string; tag?: string }
            const body = String(options.body || '')

            const hit = matchKeyword(`${title} ${body}`)
            if (hit) {
              const id = ++seq
              const stub = makeStub(title, options)
              pending.set(id, stub)
              // Bound the map: WhatsApp may never click these.
              if (pending.size > 50) pending.delete(pending.keys().next().value as number)
              try {
                priority(id, title, body, hit)
              } catch {
                /* ignore */
              }
              return stub
            }

            const label = w.__waAccountLabel as string | undefined
            const shownTitle = label ? `${label} · ${title}` : title
            const n = new target(shownTitle, options)
            try {
              shown(title, body)
            } catch {
              /* reporting must never break the notification itself */
            }
            try {
              ;(n as unknown as EventTarget).addEventListener('click', () => {
                try {
                  clicked()
                } catch {
                  /* ignore */
                }
              })
            } catch {
              /* ignore */
            }
            return n
          },
        })

        // Note: defineProperty on a Proxy forwards to the target, so the guard
        // above sees this on re-entry.
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
      args: [onShown, onClick, onPriority],
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

  // Keyword matching has to happen synchronously inside the page to suppress
  // WhatsApp's own notification, so the rules are pushed into the main world.
  ipcRenderer.on('wa:set-alerts', (_event, alerts: unknown) => {
    const a = (alerts ?? {}) as { enabled?: boolean; keywords?: string[]; wholeWord?: boolean }
    try {
      contextBridge.executeInMainWorld({
        func: (enabled: boolean, keywords: string[], wholeWord: boolean) => {
          ;(window as unknown as Record<string, unknown>).__waAlerts = {
            enabled,
            keywords,
            wholeWord,
          }
        },
        args: [
          a.enabled === true,
          Array.isArray(a.keywords) ? a.keywords.map((k) => String(k)) : [],
          a.wholeWord !== false,
        ],
      })
    } catch {
      /* ignore */
    }
  })

  // The prominent notification was clicked: replay it into WhatsApp's own
  // handler so it opens the chat.
  ipcRenderer.on('wa:priority-click', (_event, id: unknown) => {
    try {
      contextBridge.executeInMainWorld({
        func: (alertId: number) => {
          const fire = (window as unknown as Record<string, unknown>).__waFireAlertClick as
            | ((n: number) => boolean)
            | undefined
          if (fire) fire(alertId)
        },
        args: [Number(id) | 0],
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
