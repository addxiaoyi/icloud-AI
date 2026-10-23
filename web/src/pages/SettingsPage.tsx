import { useEffect, useState } from 'react'
import { request, ApiError } from '../api/client'
import { useToast } from '../components/ToastProvider'
import AsyncState from '../components/AsyncState'

interface NotifyCfg {
  bark_url?: string
  telegram_bot_token?: string
  telegram_chat_id?: string
  has_bark: boolean
  has_telegram: boolean
  enabled: boolean
}

/** 通知设置页: Bark / Telegram 推送配置 */
export default function SettingsPage() {
  const [cfg, setCfg] = useState<NotifyCfg | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [barkUrl, setBarkUrl] = useState('')
  const [tgToken, setTgToken] = useState('')
  const [tgChatId, setTgChatId] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const { show } = useToast()

  useEffect(() => {
    let cancelled = false
    request<NotifyCfg>('/api/notify/config')
      .then((data) => {
        if (cancelled) return
        setCfg(data)
        setBarkUrl(data.bark_url ?? '')
        setTgChatId(data.telegram_chat_id ?? '')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : '加载配置失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      // token 留空表示不修改(服务端不回传完整 token)
      const data = await request<NotifyCfg>('/api/notify/config', {
        method: 'PUT',
        body: JSON.stringify({
          bark_url: barkUrl.trim(),
          telegram_bot_token: tgToken.trim() || undefined,
          telegram_chat_id: tgChatId.trim(),
        }),
      })
      setCfg(data)
      setTgToken('')
      show('通知配置已保存')
    } catch (err) {
      show(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (testing) return
    setTesting(true)
    try {
      const data = await request<{ results: Record<string, string> }>('/api/notify/test', {
        method: 'POST',
      })
      const results = data.results ?? {}
      const failed = Object.entries(results).filter(([, v]) => v)
      if (failed.length === 0) {
        show('测试通知已发送，请查收')
      } else {
        show(`部分失败: ${failed.map(([k, v]) => `${k}=${v}`).join('; ')}`)
      }
    } catch (err) {
      show(err instanceof ApiError ? err.message : '测试发送失败')
    } finally {
      setTesting(false)
    }
  }

  return (
    <section>
      <div className="page-header">
        <div className="page-title">
          <h2>通知设置</h2>
          <p>收到验证码时推送到 Bark 或 Telegram。</p>
        </div>
      </div>

      <AsyncState loading={loading} error={error} empty={false} onRetry={() => window.location.reload()}>
        {cfg && (
          <div className="card" style={{ maxWidth: 640 }}>
            {!cfg.enabled && (
              <div className="alert-info" style={{ marginBottom: 16 }}>
                尚未配置任何渠道。填写以下任一渠道并保存即可启用。
              </div>
            )}

            <h3 style={{ marginTop: 0 }}>Bark 推送</h3>
            <div className="form-field">
              <label htmlFor="bark-url">Bark 服务器 URL</label>
              <input
                id="bark-url"
                value={barkUrl}
                onChange={(e) => setBarkUrl(e.target.value)}
                placeholder="https://api.day.app/你的Key"
              />
              <p className="hint">
                {cfg.has_bark ? '已配置。' : ''}
                从 Bark App 复制推送 URL 前缀（含 Key），可带自定义参数。留空则不启用 Bark。
              </p>
            </div>

            <h3>Telegram</h3>
            <div className="form-field">
              <label htmlFor="tg-token">Bot Token {cfg.has_telegram && '(已配置，留空保持不变)'}</label>
              <input
                id="tg-token"
                type="password"
                autoComplete="off"
                value={tgToken}
                onChange={(e) => setTgToken(e.target.value)}
                placeholder={cfg.has_telegram ? '••••••••' : '123456:ABC-DEF...'}
              />
            </div>
            <div className="form-field">
              <label htmlFor="tg-chat">Chat ID</label>
              <input
                id="tg-chat"
                value={tgChatId}
                onChange={(e) => setTgChatId(e.target.value)}
                placeholder="你的 Chat ID"
              />
              <p className="hint">向 @userinfobot 发消息可查询自己的 Chat ID。Token 与 Chat ID 都填写才启用 Telegram。</p>
            </div>

            <div className="form-actions">
              <button className="primary" onClick={() => void handleSave()} disabled={saving}>
                {saving ? '保存中…' : '保存配置'}
              </button>
              <button onClick={() => void handleTest()} disabled={testing || !cfg.enabled}>
                {testing ? '发送中…' : '发送测试通知'}
              </button>
            </div>
          </div>
        )}
      </AsyncState>
    </section>
  )
}
