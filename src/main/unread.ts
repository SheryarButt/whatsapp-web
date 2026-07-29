import { EMPTY_UNREAD, type UnreadReport, type UnreadStatus } from '../shared/types'

const counts = new Map<string, UnreadReport>()

const VALID_STATUS: readonly UnreadStatus[] = ['ok', 'db-absent', 'error']

/** Coerce whatever arrived over IPC into a trustworthy report. */
export function sanitize(raw: unknown): UnreadReport {
  const r = (raw ?? {}) as Partial<UnreadReport>
  const status = VALID_STATUS.includes(r.status as UnreadStatus)
    ? (r.status as UnreadStatus)
    : 'error'
  const clamp = (v: unknown): number => {
    const n = Math.trunc(Number(v))
    return Number.isFinite(n) && n > 0 ? Math.min(n, 99999) : 0
  }
  return {
    status,
    direct: clamp(r.direct),
    muted: clamp(r.muted),
    markedUnread: clamp(r.markedUnread),
  }
}

/** @returns true if this changed anything (so callers can skip redundant work). */
export function setUnread(accountId: string, report: UnreadReport): boolean {
  const prev = counts.get(accountId)
  if (
    prev &&
    prev.status === report.status &&
    prev.direct === report.direct &&
    prev.muted === report.muted &&
    prev.markedUnread === report.markedUnread
  ) {
    return false
  }
  counts.set(accountId, report)
  return true
}

export function forgetUnread(accountId: string): void {
  counts.delete(accountId)
}

export function unreadFor(accountId: string): UnreadReport {
  return counts.get(accountId) ?? EMPTY_UNREAD
}

export function allUnread(accountIds: string[]): Record<string, UnreadReport> {
  const out: Record<string, UnreadReport> = {}
  for (const id of accountIds) out[id] = unreadFor(id)
  return out
}

/**
 * Launcher badge total. Muted chats deliberately excluded — a muted group
 * should not put a number on the dock icon. The rail still shows a dot for them.
 */
export function totalDirect(accountIds: string[]): number {
  let sum = 0
  for (const id of accountIds) sum += unreadFor(id).direct
  return sum
}
