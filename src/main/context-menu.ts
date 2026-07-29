import { Menu, MenuItem, clipboard, type WebContents } from 'electron'
import { openExternal } from './navigation'

/**
 * Electron gives embedded content NO context menu at all — without this there is
 * no right-click copy/paste inside WhatsApp.
 *
 * It also has no built-in spellcheck suggestion UI: `webPreferences.spellcheck`
 * only underlines words. The suggestions have to be built by hand from the
 * context-menu event and applied with replaceMisspelling().
 */
export function attachContextMenu(wc: WebContents, isDev: boolean): void {
  wc.on('context-menu', (_event, params) => {
    const menu = new Menu()
    const add = (item: MenuItem): void => menu.append(item)
    const separator = (): void => add(new MenuItem({ type: 'separator' }))

    // --- spelling ---------------------------------------------------------
    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions.slice(0, 6)
      if (suggestions.length === 0) {
        add(new MenuItem({ label: 'No spelling suggestions', enabled: false }))
      } else {
        for (const word of suggestions) {
          add(new MenuItem({ label: word, click: () => wc.replaceMisspelling(word) }))
        }
      }
      separator()
      add(
        new MenuItem({
          label: `Add “${params.misspelledWord}” to dictionary`,
          click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        }),
      )
      separator()
    }

    // --- links ------------------------------------------------------------
    if (params.linkURL) {
      add(new MenuItem({ label: 'Open link in browser', click: () => openExternal(params.linkURL) }))
      add(
        new MenuItem({
          label: 'Copy link address',
          click: () => clipboard.writeText(params.linkURL),
        }),
      )
      separator()
    }

    // --- images -----------------------------------------------------------
    if (params.hasImageContents && params.srcURL) {
      // There is no 'copyImage' menu role; copyImageAt() is the actual API.
      add(
        new MenuItem({
          label: 'Copy image',
          click: () => wc.copyImageAt(params.x, params.y),
        }),
      )
      add(new MenuItem({ label: 'Save image as…', click: () => wc.downloadURL(params.srcURL) }))
      separator()
    }

    // --- editing ----------------------------------------------------------
    const flags = params.editFlags
    if (params.isEditable || params.selectionText) {
      add(new MenuItem({ label: 'Cut', role: 'cut', enabled: flags.canCut }))
      add(new MenuItem({ label: 'Copy', role: 'copy', enabled: flags.canCopy }))
      add(new MenuItem({ label: 'Paste', role: 'paste', enabled: flags.canPaste }))
      if (params.isEditable) {
        add(new MenuItem({ label: 'Select all', role: 'selectAll', enabled: flags.canSelectAll }))
      }
      separator()
    }

    if (isDev) {
      add(
        new MenuItem({
          label: 'Inspect element',
          click: () => wc.inspectElement(params.x, params.y),
        }),
      )
    }

    // Trailing separators look broken; drop them before showing.
    while (menu.items.length > 0 && menu.items[menu.items.length - 1].type === 'separator') {
      menu.items.pop()
    }
    if (menu.items.length > 0) menu.popup()
  })
}
