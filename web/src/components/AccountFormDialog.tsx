import { useState } from 'react'
import Dialog from './Dialog'
import { request, ApiError } from '../api/client'

interface AccountFormDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  /** 添加模式专属: 保存成功后回调新账号 id, 用于一键进入 iCloud 登录 */
  onCreatedWithId?: (id: string) => void
  editing?: {
    id: string
    name: string
    icloudEmail: string
    host: string
  } | null
}

/** 添加账号 / 编辑基本信息对话框 */
export default function AccountFormDialog({
  open,
  onClose,
  onSaved,
  onCreatedWithId,
  editing,
}: AccountFormDialogProps) {
  const [name, setName] = useState(editing?.name ?? '')
  const [icloudEmail, setIcloudEmail] = useState(editing?.icloudEmail ?? '')
  const [host, setHost] = useState(editing?.host ?? 'icloud.com')
  const [cookies, setCookies] = useState('')
  const [proxy, setProxy] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setName('')
    setIcloudEmail('')
    setHost('icloud.com')
    setCookies('')
    setProxy('')
    setError('')
    setSubmitting(false)
  }

  async function handleSubmit(thenLogin = false) {
    if (submitting) return
    if (!name.trim()) {
      setError('请输入账号名称')
      return
    }
    if (!icloudEmail.trim()) {
      setError('请输入 iCloud 邮箱')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      if (editing) {
        await request(`/api/accounts/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, icloud_email: icloudEmail, host }),
        })
      } else {
        const created = await request<{ id: string }>('/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name, icloud_email: icloudEmail, host, proxy, cookies }),
        })
        if (thenLogin && onCreatedWithId && created?.id) {
          onCreatedWithId(created.id)
          return
        }
      }
      reset()
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络连接失败，请检查服务状态')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      title={editing ? '编辑账号' : '添加账号'}
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
      <div className="form-field">
        <label htmlFor="acc-name">名称</label>
        <input
          id="acc-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
        />
      </div>
      <div className="form-field">
        <label htmlFor="acc-email">iCloud 邮箱</label>
        <input
          id="acc-email"
          type="email"
          value={icloudEmail}
          onChange={(e) => {
            const v = e.target.value
            setIcloudEmail(v)
            // 名称未手动填写时, 用邮箱前缀自动填充
            if (!name.trim() && v.includes('@')) {
              setName(v.split('@')[0].slice(0, 64))
            }
          }}
          disabled={Boolean(editing)}
        />
        {editing && <p className="hint">iCloud 邮箱创建后不可修改。</p>}
      </div>
      <div className="form-field">
        <label htmlFor="acc-host">区域</label>
        <select
          id="acc-host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          disabled={Boolean(editing)}
        >
          <option value="icloud.com">全球区 (icloud.com)</option>
          <option value="icloud.com.cn">中国区 (icloud.com.cn)</option>
        </select>
      </div>
      {!editing && (
        <>
          <div className="form-field">
            <label htmlFor="acc-cookies">Cookie（可选，原始文本）</label>
            <textarea
              id="acc-cookies"
              value={cookies}
              onChange={(e) => setCookies(e.target.value)}
              spellCheck={false}
              placeholder="a=1; b=2"
            />
            <p className="hint">可粘贴 Cookie Header 字符串或 JSON。</p>
          </div>
          <div className="form-field">
            <label htmlFor="acc-proxy">代理（可选）</label>
            <input
              id="acc-proxy"
              type="text"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder="http://user:pass@host:port"
            />
          </div>
        </>
      )}
      <div className="form-actions">
        <button onClick={onClose}>取消</button>
        <button onClick={() => void handleSubmit(false)} disabled={submitting}>
          {submitting ? '保存中…' : '仅保存'}
        </button>
        {!editing && (
          <button className="primary" onClick={() => void handleSubmit(true)} disabled={submitting || !icloudEmail.trim()}>
            {submitting ? '处理中…' : '保存并登录 iCloud →'}
          </button>
        )}
        {editing && (
          <button className="primary" onClick={() => void handleSubmit(false)} disabled={submitting}>
            保存
          </button>
        )}
      </div>
    </Dialog>
  )
}
