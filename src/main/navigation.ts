import { shell, type WebContents } from 'electron'
import { WHATSAPP_HOST } from '../shared/types'

/** Hosts an account view is allowed to navigate to in-place. Everything else is
 *  handed to the OS browser. */
const PINNED_HOSTS = new Set([WHATSAPP_HOST])

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:', 'tel:'])

function hostOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' ? u.hostname : null
  } catch {
    return null
  }
}

export function openExternal(url: string): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return
  }
  if (!EXTERNAL_PROTOCOLS.has(u.protocol)) return
  void shell.openExternal(url)
}

/**
 * Keep an account view pinned to web.whatsapp.com. Note will-navigate does not
 * fire for SPA history pushes, which is fine — WhatsApp is an SPA and we only
 * care about real navigations.
 */
export function pinNavigation(wc: WebContents): void {
  wc.on('will-navigate', (event, url) => {
    const host = hostOf(url)
    if (host && PINNED_HOSTS.has(host)) return
    event.preventDefault()
    openExternal(url)
  })

  wc.on('will-redirect', (event, url) => {
    const host = hostOf(url)
    if (host && PINNED_HOSTS.has(host)) return
    event.preventDefault()
  })

  // Links with target=_blank, and WhatsApp's own click-to-chat popouts.
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
}
