export interface AccountRecord {
  id: string
  name: string
  color: string
  createdAt: string
}

export interface AppConfig {
  schemaVersion: number
  accounts: AccountRecord[]
  activeAccountId: string | null
  alerts: AlertSettings
}

/**
 * Priority alerts: messages whose text contains one of these keywords get a
 * notification that stays on screen until dismissed, instead of the normal one
 * that auto-expires.
 */
export interface AlertSettings {
  enabled: boolean
  /** Matched case-insensitively. */
  keywords: string[]
  /** Require a whole-word hit, so "urgent" does not fire on "insurgent". */
  wholeWord: boolean
}

export const DEFAULT_ALERTS: AlertSettings = {
  enabled: true,
  keywords: [],
  wholeWord: true,
}

/**
 * 'db-absent' and 'error' exist so "we cannot determine the count" is never
 * rendered as "you are all caught up". A WhatsApp storage migration would
 * otherwise silently look like zero unread forever.
 */
export type UnreadStatus = 'ok' | 'db-absent' | 'error'

export interface UnreadReport {
  status: UnreadStatus
  /** Unread messages in unarchived, unmuted chats. */
  direct: number
  /** Unread messages in unarchived but muted chats. */
  muted: number
  /** Chats manually flagged unread (WhatsApp stores a negative sentinel). */
  markedUnread: number
}

export const EMPTY_UNREAD: UnreadReport = {
  status: 'db-absent',
  direct: 0,
  muted: 0,
  markedUnread: 0,
}

export interface ShellState {
  accounts: AccountRecord[]
  activeAccountId: string | null
  unread: Record<string, UnreadReport>
  alerts: AlertSettings
}

export const CURRENT_SCHEMA_VERSION = 1

export const WHATSAPP_URL = 'https://web.whatsapp.com/'
export const WHATSAPP_HOST = 'web.whatsapp.com'

/** Height of the account tab bar, in CSS px. The shell renderer draws it;
 *  account views are inset from the top by exactly this much. */
export const TAB_BAR_HEIGHT = 40

export const ACCOUNT_COLORS = [
  '#25D366',
  '#34B7F1',
  '#F59E0B',
  '#EF4444',
  '#A855F7',
  '#EC4899',
  '#14B8A6',
  '#6366F1',
] as const
