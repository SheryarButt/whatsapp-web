import { join } from 'node:path'
import { app } from 'electron'

/**
 * Icons live in build/icons during development and are copied to
 * resources/icons by electron-builder's extraResources.
 */
export function iconPath(size: number): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icons', `${size}x${size}.png`)
    : join(__dirname, '..', '..', 'build', 'icons', `${size}x${size}.png`)
}
