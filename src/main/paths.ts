import { join } from 'node:path'
import { app } from 'electron'

/**
 * Layout under userData:
 *
 *   <userData>/
 *     config.json          <- account list (atomic writes)
 *     Accounts/<uuid>/     <- one Chromium session tree per account
 *
 * config.json is a SIBLING of Accounts/, never a parent, so wiping an account
 * directory can never take the config with it.
 */

export function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function accountsDir(): string {
  return join(app.getPath('userData'), 'Accounts')
}

/**
 * Absolute session directory for an account. We use session.fromPath() with this
 * rather than partition:'persist:<id>' — Electron lowercases and percent-escapes
 * partition names before they hit disk, so the folder name would not be the
 * account id and "delete this account cleanly" becomes guesswork.
 */
export function accountSessionDir(accountId: string): string {
  return join(accountsDir(), accountId)
}
