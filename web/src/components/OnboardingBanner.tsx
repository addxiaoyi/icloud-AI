import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { request } from '../api/client'
import type { AccountSummary } from '../api/types'

const DISMISS_KEY = 'onboarding-dismissed'

/** 首次使用横幅:有账号未配置/无账号时显示操作指引,完成后或手动关闭即不再显示 */
export default function OnboardingBanner() {
  const [visible, setVisible] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (localStorage.getItem(DISMISS_KEY) === '1') return
    request<AccountSummary[]>('/api/accounts')
      .then((accounts) => {
        if (cancelled) return
        const pending = accounts.filter((a) => a.status !== 'active')
        // 无账号或有待配置账号时展示
        if (accounts.length === 0 || pending.length > 0) {
          setPendingCount(pending.length)
          setVisible(true)
        }
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 轮询账号状态, 全部 active 后自动收起
  useEffect(() => {
    if (!visible) return
    const timer = setInterval(() => {
      request<AccountSummary[]>('/api/accounts')
        .then((accounts) => {
          const pending = accounts.filter((a) => a.status !== 'active')
          if (accounts.length > 0 && pending.length === 0) {
            setVisible(false)
          } else {
            setPendingCount(pending.length)
          }
        })
        .catch(() => {})
    }, 15_000)
    return () => clearInterval(timer)
  }, [visible])

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setVisible(false)
  }

  if (loading || !visible) return null

  return (
    <div
      className="card"
      role="status"
      style={{
        marginBottom: 16,
        borderColor: 'var(--color-primary)',
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
      }}
    >
      <div style={{ flex: 1 }}>
        <strong>
          {pendingCount > 0
            ? `👋 还有 ${pendingCount} 个账号未完成 iCloud 登录`
            : '👋 欢迎使用 iCloud HME 管理台'}
        </strong>
        <p className="hint" style={{ marginTop: 4 }}>
          {pendingCount > 0 ? (
            <>
              到「<Link to="/accounts">账号</Link>」页点该行的「<strong>登录以启用</strong>」，
              输入 Apple ID 密码和 6 位验证码即可。账号状态变为「正常」后就能创建别名收验证码了。
            </>
          ) : (
            <>
              三步上手：①「<Link to="/accounts">账号</Link>」页添加 iCloud 账号并登录 ②
              「<Link to="/aliases">别名</Link>」页创建隐藏邮箱 ③
              「<Link to="/inbox">收件箱</Link>」查看验证码（自动提取，点击复制）。
            </>
          )}
        </p>
      </div>
      <button onClick={dismiss} title="不再显示">
        知道了
      </button>
    </div>
  )
}
