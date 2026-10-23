import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useToast } from './ToastProvider'
import { useTheme, type ThemeChoice } from '../utils/theme'
import { IconAccounts, IconAliases, IconDashboard, IconInbox, IconLogout, IconShield } from './icons'

const THEME_LABELS: Record<ThemeChoice, string> = {
  system: '跟随系统',
  light: '亮色',
  dark: '暗色',
}

/** 会话剩余时间倒计时, <30min 出现续期按钮, <5 分钟变色提醒 */
function SessionCountdown() {
  const { expiresAt, renew } = useAuth()
  const [now, setNow] = useState(() => Date.now())
  const [renewing, setRenewing] = useState(false)
  const { show } = useToast()

  useEffect(() => {
    if (!expiresAt) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [expiresAt])

  if (!expiresAt) return null
  const remainMs = expiresAt - now
  const renewClick = async () => {
    if (renewing) return
    setRenewing(true)
    try {
      await renew()
      show('会话已续期')
    } catch {
      show('续期失败，请重新登录')
    } finally {
      setRenewing(false)
    }
  }
  if (remainMs <= 0) {
    return (
      <span className="badge badge-error" title="会话已过期，请重新登录">
        会话已过期
      </span>
    )
  }
  const minutes = Math.floor(remainMs / 60_000)
  const label = minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60}m` : `${minutes}m`
  const urgent = minutes < 5
  const warn = minutes < 30
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        className={urgent ? 'badge badge-error' : warn ? 'badge badge-pending' : 'badge badge-neutral'}
        title={urgent ? '会话即将过期，操作时会自动跳转登录' : '会话剩余时间'}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        会话 {label}
      </span>
      {warn && (
        <button
          onClick={() => void renewClick()}
          disabled={renewing}
          title="将会话延长一个完整周期"
        >
          {renewing ? '续期中…' : '续期'}
        </button>
      )}
    </span>
  )
}

export default function AppShell() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header>
        <div className="brand">
          <span className="brand-logo" aria-hidden="true">
            <IconShield size={18} />
          </span>
          <span>
            iCloud HME 管理台
            <span className="brand-sub" style={{ display: 'block' }}>
              Hide My Email
            </span>
          </span>
        </div>
        <nav aria-label="主导航">
          <NavLink to="/dashboard">
            <IconDashboard />
            仪表盘
          </NavLink>
          <NavLink to="/accounts">
            <IconAccounts />
            账号
          </NavLink>
          <NavLink to="/aliases">
            <IconAliases />
            别名
          </NavLink>
          <NavLink to="/inbox">
            <IconInbox />
            收件箱
          </NavLink>
        </nav>
        <span className="spacer" />
        <SessionCountdown />
        <select
          aria-label="主题"
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeChoice)}
          style={{ width: 'auto' }}
          title="界面主题"
        >
          {(Object.keys(THEME_LABELS) as ThemeChoice[]).map((t) => (
            <option key={t} value={t}>
              {THEME_LABELS[t]}
            </option>
          ))}
        </select>
        <button onClick={() => void handleLogout()} title="退出登录">
          <IconLogout />
          退出登录
        </button>
      </header>
      <main id="main-content">
        <Outlet />
      </main>
    </div>
  )
}
