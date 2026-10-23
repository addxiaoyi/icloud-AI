import { http, HttpResponse } from 'msw'

export const handlers = [
  http.post('/api/auth/renew', () =>
    HttpResponse.json({
      success: true,
      data: { csrf_token: 'csrf-x', expires_at: '2026-12-31T00:00:00+08:00' },
    }),
  ),
  http.post('/api/auth/login', () =>
    HttpResponse.json(
      { success: false, code: 'INVALID_CREDENTIALS', message: '管理员密码错误' },
      { status: 401 },
    ),
  ),
  http.get('/api/auth/session', () =>
    HttpResponse.json(
      { success: false, code: 'AUTH_REQUIRED', message: '请先登录' },
      { status: 401 },
    ),
  ),
  http.get('/api/accounts', () =>
    HttpResponse.json({ success: true, data: [] }),
  ),
]
