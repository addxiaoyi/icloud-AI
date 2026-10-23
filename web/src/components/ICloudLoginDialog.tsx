import { useEffect, useRef, useState } from 'react'
import Dialog from './Dialog'
import { request, ApiError } from '../api/client'

interface ICloudLoginDialogProps {
  accountId: string
  open: boolean
  onClose: () => void
  onSaved: () => void
}

/** iCloud 账号登录对话框:支持 OTP 两阶段;Enter 提交,OTP 满 6 位自动提交 */
export default function ICloudLoginDialog({
  accountId,
  open,
  onClose,
  onSaved,
}: ICloudLoginDialogProps) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpRequired, setOtpRequired] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const otpRef = useRef<HTMLInputElement>(null)
  const pwdRef = useRef<HTMLInputElement>(null)
  const autoSentRef = useRef(false)

  // 打开时聚焦密码框;进入 OTP 阶段自动聚焦验证码
  useEffect(() => {
    if (!open) return
    if (otpRequired) {
      otpRef.current?.focus()
    } else {
      pwdRef.current?.focus()
    }
  }, [open, otpRequired])

  function reset() {
    setPassword('')
    setShowPassword(false)
    setOtp('')
    setOtpRequired(false)
    setError('')
    setSubmitting(false)
    autoSentRef.current = false
  }

  async function doSubmit(pwd: string, otpCode: string) {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await request(`/api/accounts/${accountId}/login`, {
        method: 'POST',
        body: JSON.stringify({
          password: pwd,
          ...(otpRequired ? { otp_code: otpCode } : {}),
        }),
      })
      reset()
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OTP_REQUIRED') {
        setOtpRequired(true)
        setError('')
      } else {
        setError(err instanceof ApiError ? err.message : '登录请求失败，请检查网络状态')
      }
    } finally {
      setSubmitting(false)
    }
  }

  function handleOtpChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setOtp(digits)
    // 满 6 位自动提交(只触发一次,防重复)
    if (digits.length === 6 && !autoSentRef.current && password) {
      autoSentRef.current = true
      void doSubmit(password, digits)
    }
  }

  return (
    <Dialog
      title="iCloud 登录"
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
    >
      {error && (
        <div className="alert-error" role="alert">
          {error}
        </div>
      )}
      {otpRequired && (
        <div className="alert-info">
          该账号开启了双重认证，请输入 Apple 发送到你设备的 6 位验证码。
        </div>
      )}
      {!otpRequired ? (
        <div className="form-field">
          <label htmlFor="icloud-login-password">Apple ID 密码</label>
          <div style={{ position: 'relative' }}>
            <input
              ref={pwdRef}
              id="icloud-login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ paddingRight: 64 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password) {
                  void doSubmit(password, '')
                }
              }}
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? '隐藏密码明文' : '显示密码明文'}
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
              }}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
          <p className="hint">建议使用 App 专用密码；开启 2FA 的账号登录后需输入验证码。</p>
        </div>
      ) : (
        <div className="form-field">
          <label htmlFor="icloud-login-otp">6 位验证码</label>
          <input
            ref={otpRef}
            id="icloud-login-otp"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(e) => handleOtpChange(e.target.value)}
            autoComplete="one-time-code"
            placeholder="123456"
            style={{
              fontSize: '1.6em',
              letterSpacing: '0.5em',
              textAlign: 'center',
              fontFamily: 'monospace',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && otp.length === 6) {
                void doSubmit(password, otp)
              }
            }}
          />
          <p className="hint">
            输满 6 位自动提交。{submitting ? '验证中…' : ''}
          </p>
        </div>
      )}
      <div className="form-actions">
        <button
          onClick={() => {
            reset()
            onClose()
          }}
        >
          取消
        </button>
        {!otpRequired ? (
          <button
            className="primary"
            onClick={() => void doSubmit(password, '')}
            disabled={submitting || !password}
          >
            {submitting ? '登录中…' : '登录'}
          </button>
        ) : (
          <button
            className="primary"
            onClick={() => void doSubmit(password, otp)}
            disabled={submitting || otp.length !== 6}
          >
            {submitting ? '验证中…' : '验证'}
          </button>
        )}
      </div>
    </Dialog>
  )
}
