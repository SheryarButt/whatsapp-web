import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig, getLoadStatus } from './config-store'
import { accountsDir } from './paths'

/**
 * Delete account session directories that no config entry claims.
 *
 * Deleting at removal time is racy: WhatsApp registers a service worker, and a
 * session with an active worker can keep writing to its directory after the
 * view is closed, recreating the tree behind the rm. (Reproduced only partially
 * — a session with no service worker deletes cleanly — so this runs as a
 * belt-and-braces sweep rather than the sole mechanism.)
 *
 * Startup is the safe moment: no Session object exists for an orphan yet, so
 * nothing can resurrect it. Must run BEFORE any view is created — calling
 * session.fromPath() on a path re-creates it.
 */
export function pruneOrphanAccountDirs(): string[] {
  const pruned: string[] = []

  // A config we could not parse reports zero accounts, which would make every
  // session directory look orphaned. Deleting them would sign the user out of
  // everything and destroy their message history. Never prune on doubt.
  const status = getLoadStatus()
  if (status !== 'loaded' && status !== 'missing') {
    console.warn(`[prune] skipped: config load status is "${status}"`)
    return pruned
  }

  const root = accountsDir()
  const known = new Set(getConfig().accounts.map((a) => a.id))

  let entries: string[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return pruned // Accounts/ does not exist yet — first run.
  }

  for (const name of entries) {
    if (known.has(name)) continue
    try {
      rmSync(join(root, name), { recursive: true, force: true })
      pruned.push(name)
    } catch (err) {
      console.warn(`[prune] could not remove orphan session dir ${name}:`, err)
    }
  }

  if (pruned.length > 0) {
    console.log(`[prune] removed ${pruned.length} orphaned account session dir(s)`)
  }
  return pruned
}
