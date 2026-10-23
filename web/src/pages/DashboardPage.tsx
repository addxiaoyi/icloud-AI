import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { request, ApiError } from '../api/client'
import type { AccountSummary, Alias, InboxMessage } from '../api/types'
import AsyncState from '../components/AsyncState'
import { IconAccounts, IconAliases, IconInbox, IconCheck, IconClock, IconAlert } from '../components/icons'

interface DashboardData {
  accounts: AccountSummary[]
  aliasesByAccount: Record<string, Alias[]>
  inboxByAccount: Record<string, InboxMessage[]>
}

function isToday(raw: string): boolean {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const accounts = await request<AccountSummary[]>('/api/accounts')
        const aliasesByAccount: Record<string, Alias[]> = {}
        const inboxByAccount: Record<string, InboxMessage[]> = {}
        await Promise.all(
          accounts.map(async (acc) => {
            if (acc.status === 'active' && acc.has_cookies) {
              try {
                const aliasData = await request<{ aliases: Alias[] }>(
                  `/api/aliases?account_id=${encodeURIComponent(acc.id)}`,
                )
                aliasesByAccount[acc.id] = aliasData.aliases ?? []
              } catch {
                aliasesByAccount[acc.id] = []
              }
            } else {
              aliasesByAccount[acc.id] = []
            }
            try {
              const inboxData = await request<{ messages: InboxMessage[] }>(
                `/api/inbox?account_id=${encodeURIComponent(acc.id)}&limit=100&days=1`,
              )
              inboxByAccount[acc.id] = inboxData.messages ?? []
            } catch {
              inboxByAccount[acc.id] = []
            }
          }),
        )
        if (cancelled) return
        setData({ accounts, aliasesByAccount, inboxByAccount })
        setError('')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : '加载仪表盘失败，请检查网络状态')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [retryKey])

  const activeAccounts = data?.accounts.filter((a) => a.status === 'active') ?? []
  const pendingAccounts = data?.accounts.filter((a) => a.status === 'pending') ?? []
  const errorAccounts = data?.accounts.filter((a) => a.status === 'error') ?? []
  const totalAliases = data
    ? Object.values(data.aliasesByAccount).reduce((sum, list) => sum + list.length, 0)
    : 0
  const activeAliases = data
    ? Object.values(data.aliasesByAccount)
        .flat()
        .filter((a) => a.active).length
    : 0
  const todayMails = data
    ? Object.values(data.inboxByAccount)
        .flat()
        .filter((m) => isToday(m.date)).length
    : 0

  const cards = [
    {
      to: '/accounts',
      icon: <IconAccounts size={22} />,
      title: '账号',
      big: data ? `${activeAccounts.length}/${data.accounts.length}` : '—',
      sub: '正常 / 总数',
      warn: pendingAccounts.length + errorAccounts.length,
      warnText: `${pendingAccounts.length} 待配置 · ${errorAccounts.length} 异常`,
    },
    {
      to: '/aliases',
      icon: <IconAliases size={22} />,
      title: '别名',
      big: data ? String(totalAliases) : '—',
      sub: `其中 ${activeAliases} 个启用中`,
    },
    {
      to: '/inbox',
      icon: <IconInbox size={22} />,
      title: '今日邮件',
      big: String(todayMails),
      sub: '最近 24 小时',
    },
  ]

  return (
    <section>
      <div className="page-header">
        <div className="page-title">
          <h2>仪表盘</h2>
          <p>账号健康度、别名与收信总览。</p>
        </div>
      </div>

      <AsyncState loading={loading} error={error} empty={false} onRetry={() => setRetryKey((k) => k + 1)}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
          {cards.map((c) => (
            <Link
              key={c.title}
              to={c.to}
              className="card"
              style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--color-text-secondary)' }}>
                {c.icon}
                <strong>{c.title}</strong>
              </div>
              <div style={{ fontSize: '2em', fontWeight: 700 }}>{c.big}</div>
              <div className="hint">{c.sub}</div>
              {'warn' in c && c.warn != null && c.warn > 0 && (
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-warning)' }}>
                  <IconAlert size={14} />
                  <span style={{ fontSize: '0.85em' }}>{c.warnText}</span>
                </div>
              )}
            </Link>
          ))}
        </div>

        {data && data.accounts.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>账号健康</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>账号</th>
                    <th>状态</th>
                    <th>别名</th>
                    <th>凭证</th>
                    <th>最近验证</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((acc) => (
                    <tr key={acc.id}>
                      <td>{acc.name}<span className="cell-secondary">{acc.id}</span></td>
                      <td>
                        <span className={acc.status === 'active' ? 'badge badge-active' : acc.status === 'pending' ? 'badge badge-pending' : 'badge badge-error'}>
                          {acc.status === 'active' ? <IconCheck size={12} /> : <IconClock size={12} />}
                          {acc.status === 'active' ? '正常' : acc.status === 'pending' ? '待配置' : '异常'}
                        </span>
                      </td>
                      <td>{acc.alias_active} / {acc.alias_total}</td>
                      <td>{acc.has_cookies ? 'Cookie' : '—'}{acc.has_app_password ? ' · App密码' : ''}</td>
                      <td>{acc.last_validated || '—'}</td>
                      <td><Link to={`/aliases?account_id=${acc.id}`}>管理 →</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data && data.accounts.length === 0 && (
          <p className="empty-state">
            暂无账号，<Link to="/accounts" className="link-like">前往「账号」页添加 →</Link>
          </p>
        )}
      </AsyncState>
    </section>
  )
}
