import { useEffect, useRef, useState } from 'react'
import Dialog from './Dialog'
import { request, ApiError } from '../api/client'
import type { AccountSummary, InboxMessage, FullMessage } from '../api/types'
import { useToast } from './ToastProvider'
import { copyText } from '../utils/clipboard'

interface BatchRegisterDialogProps {
  accountId: string
  accounts: AccountSummary[]
  onClose: () => void
  onCreated: () => void
}

interface BatchItem {
  email: string
  label: string
  /** 执行时实际使用的账号(多账号轮询时逐条不同) */
  accountId?: string
  status: 'pending' | 'creating' | 'waiting' | 'done' | 'timeout' | 'error' | 'cancelled'
  code?: string
  error?: string
}

interface HistoryEntry {
  savedAt: string
  accountId: string
  items: BatchItem[]
}

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as HistoryEntry[]
  } catch {
    return []
  }
}

const CODE_PATTERNS = [
  /(?:验证码|verification code|code is|您的代码|OTP)\D{0,10}(\d{4,8})/i,
  /\b(\d{6})\b/,
  /\b(\d{4,8})\b/,
]

const STORAGE_KEY = 'batch-register-history'

function extractCode(text: string): string | null {
  for (const pat of CODE_PATTERNS) {
    const m = text.match(pat)
    if (m) return m[1]
  }
  return null
}

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx < 1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key && value) out[key] = value
  }
  return out
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 智能轮询间隔: 前 30s 每 3s, 之后 5s */
function pollDelay(elapsedMs: number): number {
  return elapsedMs < 30_000 ? 3_000 : 5_000
}

/** 批量注册对话框：创建别名 + 轮询收件箱提取验证码；支持多账号轮询、并发、持久化 */
export default function BatchRegisterDialog({
  accountId,
  accounts,
  onClose,
  onCreated,
}: BatchRegisterDialogProps) {
  const [target, setTarget] = useState(accountId)
  const [count, setCount] = useState(5)
  const [labelPrefix, setLabelPrefix] = useState('batch')
  const [interval, setIntervalSec] = useState(10)
  const [codeTimeout, setCodeTimeout] = useState(120)
  const [concurrency, setConcurrency] = useState(1)
  const [autoCopy, setAutoCopy] = useState(false)
  const [enableSubmit, setEnableSubmit] = useState(false)
  const [submitUrl, setSubmitUrl] = useState('')
  const [submitMethod, setSubmitMethod] = useState('POST')
  const [submitHeaders, setSubmitHeaders] = useState('')
  const [submitBody, setSubmitBody] = useState('')
  const [notifyOnCode, setNotifyOnCode] = useState(true)
  const [running, setRunning] = useState(false)
  const [items, setItems] = useState<BatchItem[]>(() => loadHistory()[0]?.items ?? [])
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())
  const [error, setError] = useState('')
  const cancelRef = useRef(false)
  const autoCopyRef = useRef(false)
  const itemsRef = useRef<BatchItem[]>([])
  const notifyRef = useRef(true)
  const submitCfgRef = useRef<{ url: string; method: string; headers: Record<string, string>; body: string } | null>(null)
  const { show, showCopyable } = useToast()

  // 批结束保存历史(在 handleStart / rerunFailed 中调用)
  function saveHistory(entryItems: BatchItem[]) {
    if (entryItems.length === 0) return
    const entry: HistoryEntry = {
      savedAt: new Date().toISOString(),
      accountId: target,
      items: entryItems,
    }
    const updated = [entry, ...loadHistory().filter((h) => h.items !== entryItems)].slice(0, 10)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    } catch {
      // ignore
    }
    setHistory(updated)
  }

  // items 落定后同步到 ref(非运行时)
  useEffect(() => {
    if (!running) {
      itemsRef.current = items
    }
  }, [items, running])

  function patchItem(index: number, patch: Partial<BatchItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  /** 取全文兜底: preview 无码时调单封邮件接口 */
  async function codeFromFullBody(acct: string, msg: InboxMessage): Promise<string | null> {
    try {
      const full = await request<FullMessage>(
        `/api/inbox/${encodeURIComponent(msg.id)}?account_id=${encodeURIComponent(acct)}`,
      )
      return extractCode(`${full.subject} ${full.body}`)
    } catch {
      return null
    }
  }

  async function pollCode(acct: string, alias: string, timeoutSec: number): Promise<string | null> {
    const deadline = Date.now() + timeoutSec * 1000
    const start = Date.now()
    const seen = new Set<string>()
    while (Date.now() < deadline) {
      if (cancelRef.current) return null
      try {
        const data = await request<{ messages: InboxMessage[] }>(
          `/api/inbox?account_id=${encodeURIComponent(acct)}&alias=${encodeURIComponent(alias)}&limit=10&days=1`,
        )
        for (const msg of data.messages ?? []) {
          if (seen.has(msg.id)) continue
          seen.add(msg.id)
          let code = extractCode(`${msg.subject} ${msg.preview}`)
          if (!code) {
            code = await codeFromFullBody(acct, msg)
          }
          if (code) return code
        }
      } catch {
        // 单次轮询失败继续重试
      }
      await sleep(pollDelay(Date.now() - start))
    }
    return null
  }

  /** 目标账号列表: 单账号 or 全部 active 账号轮询 */
  function targetAccounts(): string[] {
    if (target === '*') {
      const active = accounts.filter((a) => a.status === 'active')
      return active.length > 0 ? active.map((a) => a.id) : [accountId]
    }
    return [target]
  }

  /** 收到验证码后的后续动作: 通知推送 + 可选两步式提交 */
  async function afterCode(alias: string, code: string, label: string, index: number): Promise<string> {
    let statusNote = ''
    if (notifyRef.current) {
      try {
        await request('/api/notify/send', {
          method: 'POST',
          body: JSON.stringify({ alias, code, title: label }),
        })
      } catch {
        statusNote = '通知失败'
      }
    }
    const cfg = submitCfgRef.current
    if (cfg) {
      try {
        const data = await request<{ success: boolean; step2?: { status: number; error?: string } }>('/api/submit', {
          method: 'POST',
          body: JSON.stringify({
            alias,
            code,
            label,
            step2: { url: cfg.url, method: cfg.method, headers: cfg.headers, body: cfg.body },
          }),
        })
        if (!data.success) {
          statusNote = statusNote ? `${statusNote}；提交失败` : '提交失败'
          patchItem(index, { error: `提交响应异常: ${data.step2?.status ?? ''}` })
        } else {
          statusNote = statusNote ? `${statusNote}；已提交` : '已提交'
        }
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : '提交请求失败'
        statusNote = statusNote ? `${statusNote}；${msg}` : msg
        patchItem(index, { error: msg })
      }
    }
    return statusNote
  }

  async function createAndPoll(acct: string, label: string, index: number, timeoutSec: number): Promise<'done' | 'timeout' | 'error'> {
    patchItem(index, { status: 'creating', accountId: acct })
    try {
      const data = await request<{ email: string }>('/api/create', {
        method: 'POST',
        body: JSON.stringify({ account_id: acct, label }),
      })
      patchItem(index, { email: data.email, status: 'waiting' })
      const code = await pollCode(acct, data.email, timeoutSec)
      if (code) {
        const note = await afterCode(data.email, code, label, index)
        patchItem(index, { status: 'done', code })
        if (autoCopyRef.current) {
          void copyText(code)
        }
        if (note) {
          show(`${label}: ${note}`)
        }
        return 'done'
      }
      patchItem(index, { status: cancelRef.current ? 'cancelled' : 'timeout' })
      return cancelRef.current ? 'error' : 'timeout'
    } catch (err) {
      patchItem(index, {
        status: 'error',
        error: err instanceof ApiError ? err.message : '请求失败',
      })
      return 'error'
    }
  }

  async function handleStart() {
    if (running) return
    const n = Math.floor(count)
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      setError('数量需为 1-100')
      return
    }
    const conc = Math.max(1, Math.min(10, Math.floor(concurrency) || 1))
    const accts = targetAccounts()
    // 并发 >1 时按账号分摊: 每个账号一条串行队列, 避免同账号并发触发限频
    if (conc > 1 && accts.length < 2) {
      setError('并发 >1 需要多个正常状态账号（单账号串行防限频，或选择「全部账号」）')
      return
    }

    setRunning(true)
    setError('')
    autoCopyRef.current = autoCopy

    notifyRef.current = notifyOnCode
    submitCfgRef.current = enableSubmit && submitUrl.trim()
      ? {
          url: submitUrl.trim(),
          method: submitMethod,
          headers: parseHeaders(submitHeaders),
          body: submitBody,
        }
      : null
    const newItems: BatchItem[] = Array.from({ length: n }, (_, i) => ({
      email: '',
      label: `${labelPrefix.trim() || 'batch'}-${i + 1}`,
      status: 'pending' as const,
    }))
    setItems(newItems)
    itemsRef.current = newItems
    cancelRef.current = false
    onCreated()

    const queue = Array.from({ length: n }, (_, i) => i)
    let done = 0

    async function worker(): Promise<void> {
      while (queue.length > 0 && !cancelRef.current) {
        const index = queue.shift()
        if (index === undefined) break
        // 多账号轮询分派; 单账号固定
        const acct = accts.length > 1 ? accts[index % accts.length] : accts[0]
        const result = await createAndPoll(acct, `${labelPrefix.trim() || 'batch'}-${index + 1}`, index, codeTimeout)
        if (result === 'done') done++
        // 同一 worker 串行间隔(防限频); 队列耗尽则不等待
        if (queue.length > 0 && !cancelRef.current) {
          await sleep(Math.max(0, interval) * 1000)
        }
      }
    }

    const workers = Array.from({ length: Math.min(conc, n) }, () => worker())
    await Promise.all(workers)

    setRunning(false)
    saveHistory(itemsRef.current.length > 0 ? itemsRef.current : items)
    show(`批量完成：成功提取验证码 ${done}/${n}${cancelRef.current ? '（已取消）' : ''}`)
  }

  async function copyResult() {
    const lines = items
      .filter((it) => it.email)
      .map((it) => `${it.email}\t${it.code ?? it.status}`)
      .join('\n')
    if (!lines) return
    if (await copyText(lines)) {
      show('结果已复制')
    } else {
      showCopyable(lines, '复制失败，请手动复制')
    }
  }

  function exportCsv() {
    const rows = [['label', 'email', 'code', 'status', 'error']]
    for (const it of items) {
      rows.push([it.label, it.email, it.code ?? '', it.status, it.error ?? ''])
    }
    const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `batch-register-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  /** 对失败/超时且未拿到验证码的条目重跑 */
  async function rerunFailed() {
    if (running) return
    setRunning(true)
    setError('')
    cancelRef.current = false
    autoCopyRef.current = autoCopy
    notifyRef.current = notifyOnCode
    submitCfgRef.current = enableSubmit && submitUrl.trim()
      ? { url: submitUrl.trim(), method: submitMethod, headers: parseHeaders(submitHeaders), body: submitBody }
      : null
    const accts = targetAccounts()
    const targets = items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => it.status === 'error' || it.status === 'timeout' || it.status === 'cancelled')
    let done = items.filter((it) => it.status === 'done').length

    for (let t = 0; t < targets.length; t++) {
      if (cancelRef.current) break
      const { it, i } = targets[t]
      const acct = accts.length > 1 ? accts[i % accts.length] : accts[0]
      const result = await createAndPoll(acct, it.label, i, codeTimeout)
      if (result === 'done') done++
      if (t < targets.length - 1 && !cancelRef.current) {
        await sleep(Math.max(0, interval) * 1000)
      }
    }
    setRunning(false)
    saveHistory(items.length > 0 ? items : itemsRef.current)
    show(`重跑完成：累计成功 ${done}/${items.length}`)
  }

  const doneCount = items.filter((it) => it.status === 'done').length
  const hasFailed = items.some((it) => it.status === 'error' || it.status === 'timeout' || it.status === 'cancelled')
  const multiAccount = target === '*'

  const statusText: Record<BatchItem['status'], string> = {
    pending: '等待中',
    creating: '创建别名…',
    waiting: '等待邮件…',
    done: '完成',
    timeout: '超时',
    error: '失败',
    cancelled: '已取消',
  }

  return (
    <Dialog
      title="批量注册"
      open
      onClose={() => {
        if (running) {
          cancelRef.current = true
        } else {
          onClose()
        }
      }}
    >
      {error && (
        <div className="alert-error" role="alert">
          {error}
        </div>
      )}

      {items.length === 0 && (
        <>
          <div className="form-field">
            <label htmlFor="batch-target">使用账号</label>
            <select id="batch-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}（{a.status === 'active' ? '正常' : a.status === 'pending' ? '待配置' : '异常'}）
                </option>
              ))}
              {accounts.filter((a) => a.status === 'active').length > 1 && (
                <option value="*">全部正常账号（轮询分摊）</option>
              )}
            </select>
            <p className="hint">多账号轮询可分摊 iCloud 限频压力。</p>
          </div>
          <div className="form-field">
            <label htmlFor="batch-count">数量</label>
            <input
              id="batch-count"
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
            <p className="hint">1-100，每条生成一个别名并等待验证码。</p>
          </div>
          <div className="form-field">
            <label htmlFor="batch-prefix">标签前缀</label>
            <input
              id="batch-prefix"
              value={labelPrefix}
              onChange={(e) => setLabelPrefix(e.target.value.slice(0, 180))}
              maxLength={180}
              placeholder="如：ctf、shop"
            />
            <p className="hint">实际标签为「前缀-序号」。</p>
          </div>
          <div className="form-field">
            <label htmlFor="batch-concurrency">并发数</label>
            <input
              id="batch-concurrency"
              type="number"
              min={1}
              max={10}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
            />
            <p className="hint">
              {multiAccount
                ? '每个账号一条串行队列，同账号内仍串行防限频。'
                : '单账号仅支持 1；选择「全部正常账号」后可提高并发。'}
            </p>
          </div>
          <div className="form-field">
            <label htmlFor="batch-interval">每轮间隔（秒）</label>
            <input
              id="batch-interval"
              type="number"
              min={0}
              max={600}
              value={interval}
              onChange={(e) => setIntervalSec(Number(e.target.value))}
            />
            <p className="hint">同一账号两次创建之间的最小间隔，建议 ≥ 5 秒。</p>
          </div>
          <div className="form-field">
            <label htmlFor="batch-timeout">验证码等待超时（秒）</label>
            <input
              id="batch-timeout"
              type="number"
              min={10}
              max={600}
              value={codeTimeout}
              onChange={(e) => setCodeTimeout(Number(e.target.value))}
            />
            <p className="hint">前 30 秒每 3 秒查询一次，之后每 5 秒；摘要无验证码时自动取邮件全文。</p>
          </div>
          <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              id="batch-autocopy"
              type="checkbox"
              checked={autoCopy}
              onChange={(e) => setAutoCopy(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <label htmlFor="batch-autocopy" style={{ margin: 0 }}>
              收到验证码后自动复制到剪贴板
            </label>
          </div>

          <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              id="batch-notify"
              type="checkbox"
              checked={notifyOnCode}
              onChange={(e) => setNotifyOnCode(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <label htmlFor="batch-notify" style={{ margin: 0 }}>
              收到验证码时推送通知（在「设置」页配置 Bark/Telegram）
            </label>
          </div>

          <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              id="batch-enable-submit"
              type="checkbox"
              checked={enableSubmit}
              onChange={(e) => setEnableSubmit(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <label htmlFor="batch-enable-submit" style={{ margin: 0 }}>
              收到验证码后自动提交（两步式注册）
            </label>
          </div>
          {enableSubmit && (
            <>
              <div className="form-field">
                <label htmlFor="submit-url">提交 URL 模板</label>
                <input
                  id="submit-url"
                  value={submitUrl}
                  onChange={(e) => setSubmitUrl(e.target.value)}
                  placeholder="https://target.com/api/verify?email={alias}&code={code}"
                />
                <p className="hint">
                  支持占位符：{'{alias}'} {'{code}'} {'{label}'} {'{url_escape_alias}'}。服务端代理请求，无 CORS 限制。
                </p>
              </div>
              <div className="form-field">
                <label htmlFor="submit-method">方法</label>
                <select
                  id="submit-method"
                  value={submitMethod}
                  onChange={(e) => setSubmitMethod(e.target.value)}
                >
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="submit-headers">请求头（每行 Key: Value）</label>
                <textarea
                  id="submit-headers"
                  value={submitHeaders}
                  onChange={(e) => setSubmitHeaders(e.target.value)}
                  rows={2}
                  placeholder={'Authorization: Bearer xxx'}
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
              <div className="form-field">
                <label htmlFor="submit-body">请求体模板</label>
                <textarea
                  id="submit-body"
                  value={submitBody}
                  onChange={(e) => setSubmitBody(e.target.value)}
                  rows={3}
                  placeholder={'{"email": "{alias}", "code": "{code}"}'}
                  style={{ fontFamily: 'monospace' }}
                />
                <p className="hint">GET 请求忽略请求体。</p>
              </div>
            </>
          )}
        </>
      )}
      {items.length > 0 && (
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.9em' }}>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{it.label}</td>
                  <td style={{ padding: '4px 8px', wordBreak: 'break-all' }}>{it.email || '—'}</td>
                  <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                    {it.status === 'done' ? (
                      <button
                        type="button"
                        className="badge badge-active"
                        style={{ border: 'none', cursor: 'copy', fontFamily: 'monospace' }}
                        title="点击复制"
                        onClick={() => void copyText(it.code ?? '').then(() => show('验证码已复制'))}
                      >
                        {it.code}
                      </button>
                    ) : (
                      <span title={it.error}>{statusText[it.status]}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && !running && history.length > 0 && (
        <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="batch-history" style={{ margin: 0, whiteSpace: 'nowrap' }}>
            历史批次
          </label>
          <select
            id="batch-history"
            style={{ width: 'auto', flex: 1 }}
            defaultValue=""
            onChange={(e) => {
              const idx = Number(e.target.value)
              if (!Number.isNaN(idx) && history[idx]) setItems(history[idx].items)
            }}
          >
            <option value="">— 选择要查看的批次 —</option>
            {history.map((h, i) => (
              <option key={h.savedAt} value={i}>
                {new Date(h.savedAt).toLocaleString()} · {h.items.length} 条 · 成功{' '}
                {h.items.filter((x) => x.status === 'done').length}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(STORAGE_KEY)
              setHistory([])
              show('历史记录已清空')
            }}
          >
            清空
          </button>
        </div>
      )}

      {items.length > 0 && (
        <p className="hint">
          进度：{doneCount}/{items.length} {running ? '（运行中，关闭对话框可取消）' : ''}
        </p>
      )}

      <div className="form-actions">
        {items.length === 0 ? (
          <>
            <button onClick={onClose}>取消</button>
            <button className="primary" onClick={() => void handleStart()}>
              开始
            </button>
          </>
        ) : running ? (
          <button
            onClick={() => {
              cancelRef.current = true
            }}
          >
            取消批量
          </button>
        ) : (
          <>
            <button onClick={() => setItems([])}>重新配置</button>
            <button onClick={() => void copyResult()}>复制结果</button>
            <button onClick={exportCsv}>导出 CSV</button>
            {hasFailed && (
              <button className="primary" onClick={() => void rerunFailed()}>
                重跑失败项
              </button>
            )}
            {!hasFailed && (
              <button className="primary" onClick={() => { setItems([]); onClose() }}>
                关闭
              </button>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
