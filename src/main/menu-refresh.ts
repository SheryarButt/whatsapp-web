/**
 * "Start at login" is exposed in three places: the ⚙ menu, the tray menu and
 * the window menu bar. None of them update in place — Electron menus have to be
 * rebuilt — so toggling from any one has to rebuild the others or they show a
 * stale tick.
 *
 * A tiny indirection avoids threading a callback through the tray, the IPC
 * layer and the menu builder, which all sit at different levels.
 */
let refresh: () => void = () => {}

export function setMenuRefresh(fn: () => void): void {
  refresh = fn
}

export function refreshMenus(): void {
  try {
    refresh()
  } catch (err) {
    console.warn('[menu] refresh failed:', err)
  }
}
