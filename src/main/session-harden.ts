import type { Session } from 'electron'
import { WHATSAPP_HOST } from '../shared/types'
import { cleanUserAgent } from './user-agent'

/**
 * Electron GRANTS permissions by default when no handler is installed, so every
 * account session needs both handlers — not just the default session.
 */
const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'media', // camera + mic: voice notes, voice/video calls
  'mediaKeySystem',
  'display-capture', // screen share (M6)
  'clipboard-read', // "copy image" out of WhatsApp
  'clipboard-sanitized-write',
  'fullscreen',
  'speaker-selection',
  'pointerLock',
])

function isWhatsAppOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    const u = new URL(origin)
    return u.protocol === 'https:' && u.hostname === WHATSAPP_HOST
  } catch {
    return false
  }
}

export function hardenSession(ses: Session): void {
  const ua = cleanUserAgent(ses.getUserAgent())
  ses.setUserAgent(ua)

  // The header path is separate from navigator.userAgent — setting only one of
  // them leaves some request types advertising Electron.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = ua
    callback({ requestHeaders: details.requestHeaders })
  })

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const origin = details?.requestingUrl
    callback(ALLOWED_PERMISSIONS.has(permission) && isWhatsAppOrigin(origin))
  })

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isWhatsAppOrigin(requestingOrigin)
  })

  configureSpellcheck(ses)
}

/**
 * setSpellCheckerLanguages THROWS on any code that has no Hunspell dictionary,
 * and app.getPreferredSystemLanguages() happily returns such codes (bare "en",
 * region-only entries). Always intersect with what the session actually offers.
 */
function configureSpellcheck(ses: Session): void {
  try {
    const available = new Set(ses.availableSpellCheckerLanguages)
    const wanted = Intl.DateTimeFormat()
      .resolvedOptions()
      .locale.split(',')
      .map((l) => l.trim())
      .filter(Boolean)

    const langs = wanted.filter((l) => available.has(l))
    if (langs.length === 0 && available.has('en-US')) langs.push('en-US')
    if (langs.length > 0) ses.setSpellCheckerLanguages(langs)
  } catch (err) {
    console.warn('[spellcheck] disabled:', err)
  }
}
