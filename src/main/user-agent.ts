/**
 * Strip our own token and Electron's from the User-Agent.
 *
 * WhatsApp Web serves an "unsupported browser" wall when it sees Electron. We do
 * NOT invent a fake Chrome version — removing the two tokens leaves the honest,
 * current "Chrome/<real> Safari/537.36" that Electron already reports.
 *
 * This must be applied in TWO places or it leaks:
 *   1. app.userAgentFallback (before any view is created)
 *   2. the outgoing User-Agent request header, per session
 * Setting only (1) leaves some request types untouched.
 */
const STRIP = /\s*(?:whatsapp-multi|WhatsAppMulti|Electron)\/[^\s]+/gi

export function cleanUserAgent(ua: string): string {
  return ua.replace(STRIP, '').replace(/\s{2,}/g, ' ').trim()
}
