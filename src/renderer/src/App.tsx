import { useEffect, useState } from 'react'
import { EMPTY_UNREAD, type AccountRecord, type ShellState, type UnreadReport } from '../../shared/types'

/**
 * A number for real unread, a plain dot for muted-only or manually-flagged
 * activity, and a distinct marker when we genuinely cannot tell — "unknown"
 * must never render as "caught up".
 */
function Badge({ unread }: { unread: UnreadReport }): React.JSX.Element | null {
  if (unread.status === 'error') {
    return (
      <span className="badge badge-unknown" title="Could not read unread count">
        !
      </span>
    )
  }
  if (unread.status === 'db-absent') return null // not signed in yet — nothing to report

  if (unread.direct > 0) {
    return (
      <span className="badge" title={`${unread.direct} unread`}>
        {unread.direct > 99 ? '99+' : unread.direct}
      </span>
    )
  }
  if (unread.muted > 0 || unread.markedUnread > 0) {
    const why = unread.muted > 0 ? `${unread.muted} unread (muted)` : 'marked unread'
    return <span className="badge badge-dot" title={why} />
  }
  return null
}

/** Inline rename editor. Native prompt() does not work in Electron renderers. */
function RenameField({
  account,
  onDone,
}: {
  account: AccountRecord
  onDone: (name: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(account.name)
  return (
    <input
      className="tab-rename"
      autoFocus
      value={value}
      title="Enter to save, Escape to cancel"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value)
        else if (e.key === 'Escape') onDone(null)
      }}
      onFocus={(e) => e.currentTarget.select()}
    />
  )
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<ShellState>({
    accounts: [],
    activeAccountId: null,
    unread: {},
  })
  const [renamingId, setRenamingId] = useState<string | null>(null)

  const apply = (result: ShellState | null): void => {
    if (result) setState(result)
  }

  const confirmRemove = (account: AccountRecord): void => {
    const ok = window.confirm(
      `Remove "${account.name}"?\n\nThis signs the account out and deletes its local data. Other accounts are unaffected.`,
    )
    if (ok) void window.shell.removeAccount(account.id).then(apply)
  }

  useEffect(() => {
    void window.shell.getState().then((s) => s && setState(s))
    const offState = window.shell.onState(setState)
    const offRename = window.shell.onBeginRename((id) => setRenamingId(id))
    const offRemove = window.shell.onConfirmRemove((id) => {
      const account = state.accounts.find((a) => a.id === id)
      if (account) confirmRemove(account)
    })
    return () => {
      offState()
      offRename()
      offRemove()
    }
    // state.accounts is read inside onConfirmRemove, so the listener is rebound
    // when the account list changes.
  }, [state.accounts])

  const onAdd = (): void => {
    void window.shell.addAccount(`Account ${state.accounts.length + 1}`).then(apply)
  }

  const finishRename = (account: AccountRecord, name: string | null): void => {
    setRenamingId(null)
    if (name !== null && name.trim() && name !== account.name) {
      void window.shell.renameAccount(account.id, name.trim()).then(apply)
    }
  }

  return (
    <div className="app">
      <nav className="tabbar">
        {state.accounts.map((account) =>
          renamingId === account.id ? (
            <RenameField
              key={account.id}
              account={account}
              onDone={(name) => finishRename(account, name)}
            />
          ) : (
            <button
              key={account.id}
              type="button"
              className={`tab${account.id === state.activeAccountId ? ' active' : ''}`}
              title={`${account.name}\nDouble-click to rename · Right-click for options`}
              onClick={() => void window.shell.activateAccount(account.id).then(apply)}
              onDoubleClick={() => setRenamingId(account.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                void window.shell.tabMenu(account.id)
              }}
            >
              <span className="tab-dot" style={{ background: account.color }} />
              <span className="tab-name">{account.name}</span>
              <Badge unread={state.unread[account.id] ?? EMPTY_UNREAD} />
            </button>
          ),
        )}

        <button type="button" className="tab-add" title="Add account" onClick={onAdd}>
          +
        </button>

        <button
          type="button"
          className="tab-settings"
          title="Settings — start at login, version, quit"
          onClick={() => void window.shell.settingsMenu()}
        >
          <span className="gear" aria-hidden="true">
            ⚙
          </span>
          <span className="label">Settings</span>
        </button>
      </nav>

      {state.accounts.length === 0 && (
        <main className="empty">
          <div>
            <h1>No accounts yet</h1>
            <p>Press + to add one, then scan the QR code with WhatsApp on your phone.</p>
          </div>
        </main>
      )}
    </div>
  )
}
