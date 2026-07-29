import type { UnreadReport } from '../shared/types'

/**
 * Read unread counts straight out of WhatsApp's IndexedDB.
 *
 * Approach lifted from Ferdium's WhatsApp recipe (MIT). The alternative —
 * regexing a number out of document.title — matches any digit in the title, so
 * a group named "2024 Planning" reads as 2024 unread messages.
 *
 * Schema verified live against this build: model-storage v1990, object store
 * "chat", fields unreadCount / archive / muteExpiration / isAutoMuted.
 *
 * This runs in the preload's ISOLATED world, which is fine — IndexedDB is keyed
 * by origin, not by JS world, so no main-world injection is needed here.
 */
const DB_NAME = 'model-storage'
const STORE = 'chat'
const POLL_MS = 6000

let db: IDBDatabase | null = null

interface ChatRow {
  unreadCount?: unknown
  archive?: unknown
  muteExpiration?: unknown
  isAutoMuted?: unknown
}

async function databaseExists(): Promise<boolean> {
  try {
    // indexedDB.open() CREATES the database when absent, which would plant an
    // empty model-storage in WhatsApp's origin. Always check first.
    const list = await indexedDB.databases()
    return list.some((d) => d.name === DB_NAME)
  } catch {
    return false
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME)
    } catch {
      return resolve(null)
    }
    req.onsuccess = () => {
      const opened = req.result
      // WhatsApp deletes and upgrades this database; hold the handle loosely or
      // we block its migrations and go stale.
      opened.onversionchange = () => {
        try {
          opened.close()
        } catch {
          /* ignore */
        }
        if (db === opened) db = null
      }
      opened.onclose = () => {
        if (db === opened) db = null
      }
      resolve(opened)
    }
    req.onerror = () => resolve(null)
    // Opening versionless from a second context can block WhatsApp's own
    // upgrade. Back off rather than hold it up.
    req.onblocked = () => resolve(null)
  })
}

function readChats(handle: IDBDatabase): Promise<ChatRow[]> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = handle.transaction(STORE, 'readonly')
    } catch (err) {
      return reject(err)
    }
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result as ChatRow[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

export function computeCounts(rows: ChatRow[]): Omit<UnreadReport, 'status'> {
  let direct = 0
  let muted = 0
  let markedUnread = 0

  for (const chat of rows) {
    if (chat.archive) continue

    const n = Number(chat.unreadCount)
    if (!Number.isFinite(n) || n === 0) continue

    // A negative unreadCount is WhatsApp's "manually marked as unread" sentinel:
    // real attention needed, but no message count to show.
    if (n < 0) {
      markedUnread += 1
      continue
    }

    const isMuted =
      (chat.muteExpiration != null && Number(chat.muteExpiration) !== 0) ||
      chat.isAutoMuted === true

    if (isMuted) muted += n
    else direct += n
  }

  return { direct, muted, markedUnread }
}

async function sample(): Promise<UnreadReport> {
  if (!db) {
    if (!(await databaseExists())) {
      return { status: 'db-absent', direct: 0, muted: 0, markedUnread: 0 }
    }
    db = await openDatabase()
    if (!db) return { status: 'db-absent', direct: 0, muted: 0, markedUnread: 0 }
  }

  if (!db.objectStoreNames.contains(STORE)) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    db = null
    return { status: 'db-absent', direct: 0, muted: 0, markedUnread: 0 }
  }

  try {
    return { status: 'ok', ...computeCounts(await readChats(db)) }
  } catch {
    db = null // force re-acquire next tick
    return { status: 'error', direct: 0, muted: 0, markedUnread: 0 }
  }
}

export function startUnreadPolling(report: (r: UnreadReport) => void): void {
  let last = ''
  const tick = async (): Promise<void> => {
    const result = await sample()
    const key = `${result.status}:${result.direct}:${result.muted}:${result.markedUnread}`
    if (key !== last) {
      last = key
      report(result)
    }
  }
  void tick()
  setInterval(() => void tick(), POLL_MS)
}
