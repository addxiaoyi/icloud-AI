import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { ApiError } from '../api/client'
import { IconShield } from '../components/icons'

/** 密码输入框:带显示/隐藏切换 */
function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        placeholder={placeholder}
        style={{ paddingRight: 40 }}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShow((v) => !v)}
        aria-label={show ? '隐藏密码明文' : '显示密码明文'}
        title={show ? '隐藏密码' : '显示密码'}
        style={{
          position: 'absolute',
          right: 6,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          color: 'var(--color-text-tertiary)',
          display: 'flex',
        }}
      >
        {show ? '🙈' : '👁'}
      </button>
    </div>
  )
}

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting || !password) return
    setSubmitting(true)
    setError('')
    try {
      await login(password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录请求失败，请检查网络状态')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-brand">
        <span className="logo" aria-hidden="true">
          <IconShield size={28} />
        </span>
        <h1>iCloud HME 管理台</h1>
        <p>批量管理 iCloud 隐藏邮箱与验证码邮件</p>
      </div>
      <form onSubmit={handleSubmit} className="card login-form">
        {error && (
          <div className="alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-field">
          <label htmlFor="admin-password">管理员密码</label>
          <PasswordInput
            id="admin-password"
            value={password}
            onChange={setPassword}
            placeholder="输入管理员密码"
                />
        </div>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={submitting || !password}>
            {submitting ? '登录中…' : '登录'}
          </button>
        </div>
      </form>
    </div>
  )
}
