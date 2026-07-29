import { useEffect, useState } from 'react'
import { EMPTY_UNREAD, type AccountRecord, type ShellState, type UnreadReport } from '../../shared/types'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * A number for real unread, a plain dot for muted-only or manually-flagged
 * activity, and a distinct marker when we genuinely cannot tell — "unknown"
 * must never render as "caught up".
 */
function Badge({ unread }: { unread: UnreadReport }): React.JSX.Element | null {
  if (unread.status === 'error') {
    return <span className="badge badge-unknown" title="Could not read unread count">!</span>
  }
  if (unread.status === 'db-absent') return null // not logged in yet — nothing to report

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
      className="rename"
      autoFocus
      value={value}
      title="Enter to save, Escape to cancel"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value)
        else if (e.key === 'Escape') onDone(null)
      }}
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

  useEffect(() => {
    void window.shell.getState().then((s) => s && setState(s))
    return window.shell.onState(setState)
  }, [])

  const apply = (result: ShellState | null): void => {
    if (result) setState(result)
  }

  const onAdd = (): void => {
    void window.shell.addAccount(`Account ${state.accounts.length + 1}`).then(apply)
  }

  const onRemove = (account: AccountRecord): void => {
    const ok = window.confirm(
      `Remove "${account.name}"?\n\nThis signs the account out and deletes its local data. Other accounts are unaffected.`,
    )
    if (ok) void window.shell.removeAccount(account.id).then(apply)
  }

  return (
    <div className="app">
      <nav className="rail">
        <div className="rail-scroll">
          {state.accounts.map((account) =>
            renamingId === account.id ? (
              <RenameField
                key={account.id}
                account={account}
                onDone={(name) => {
                  setRenamingId(null)
                  if (name !== null && name.trim() && name !== account.name) {
                    void window.shell.renameAccount(account.id, name.trim()).then(apply)
                  }
                }}
              />
            ) : (
              <button
                key={account.id}
                type="button"
                className={`avatar${account.id === state.activeAccountId ? ' active' : ''}`}
                style={{ color: account.color }}
                title={`${account.name}\nDouble-click to rename · Right-click to remove`}
                onClick={() => void window.shell.activateAccount(account.id).then(apply)}
                onDoubleClick={() => setRenamingId(account.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onRemove(account)
                }}
              >
                <span className="ring" />
                {initials(account.name)}
                <Badge unread={state.unread[account.id] ?? EMPTY_UNREAD} />
              </button>
            ),
          )}
        </div>

        <button type="button" className="add" title="Add account" onClick={onAdd}>
          +
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
