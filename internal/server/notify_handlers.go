package server

import (
	"net/http"
	"strings"

	"icloud-hme/internal/notify"

	"github.com/gin-gonic/gin"
)

// notifyCfgResponse 返回给前端的脱敏配置。
type notifyCfgResponse struct {
	BarkURL        string `json:"bark_url,omitempty"`
	TelegramBotToken string `json:"telegram_bot_token,omitempty"`
	TelegramChatID string `json:"telegram_chat_id,omitempty"`
	HasBark        bool   `json:"has_bark"`
	HasTelegram    bool   `json:"has_telegram"`
	Enabled        bool   `json:"enabled"`
}

func maskSecret(s string) string {
	if s == "" {
		return ""
	}
	if len(s) <= 6 {
		return "***"
	}
	return s[:4] + "***" + s[len(s)-4:]
}

func toNotifyResponse(cfg notify.Config) notifyCfgResponse {
	return notifyCfgResponse{
		BarkURL:          cfg.BarkURL,
		TelegramBotToken: maskSecret(cfg.TelegramBotToken),
		TelegramChatID:   cfg.TelegramChatID,
		HasBark:          cfg.BarkURL != "",
		HasTelegram:      cfg.TelegramBotToken != "" && cfg.TelegramChatID != "",
		Enabled:          cfg.Enabled(),
	}
}

// getNotifyConfigHandler 处理 GET /api/notify/config。
func (s *Server) getNotifyConfigHandler(c *gin.Context) {
	if s.notifier == nil {
		failCode(c, http.StatusServiceUnavailable, "NOTIFY_UNAVAILABLE", "通知功能未启用")
		return
	}
	cfg, err := s.notifier.Config()
	if err != nil {
		failCode(c, http.StatusInternalServerError, "INTERNAL_ERROR", "读取通知配置失败")
		return
	}
	ok(c, toNotifyResponse(cfg))
}

// putNotifyConfigHandler 处理 PUT /api/notify/config。
func (s *Server) putNotifyConfigHandler(c *gin.Context) {
	if s.notifier == nil {
		failCode(c, http.StatusServiceUnavailable, "NOTIFY_UNAVAILABLE", "通知功能未启用")
		return
	}
	var req notify.Config
	if err := c.ShouldBindJSON(&req); err != nil {
		failCode(c, http.StatusBadRequest, "VALIDATION_ERROR", "参数错误")
		return
	}
	if strings.TrimSpace(req.BarkURL) != "" && !strings.HasPrefix(strings.TrimSpace(req.BarkURL), "http") {
		failCode(c, http.StatusBadRequest, "VALIDATION_ERROR", "Bark URL 需以 http(s):// 开头")
		return
	}
	if err := s.notifier.SaveConfig(req); err != nil {
		failCode(c, http.StatusInternalServerError, "INTERNAL_ERROR", "保存通知配置失败")
		return
	}
	cfg, _ := s.notifier.Config()
	ok(c, toNotifyResponse(cfg))
}

// testNotifyHandler 处理 POST /api/notify/test:发送一条测试通知。
func (s *Server) testNotifyHandler(c *gin.Context) {
	if s.notifier == nil {
		failCode(c, http.StatusServiceUnavailable, "NOTIFY_UNAVAILABLE", "通知功能未启用")
		return
	}
	cfg, _ := s.notifier.Config()
	if !cfg.Enabled() {
		failCode(c, http.StatusBadRequest, "VALIDATION_ERROR", "尚未配置任何通知渠道")
		return
	}
	msg := notify.Message{
		Alias: "test@icloud.com",
		Code:  "000000",
		From:  "icloud-hme",
		Title: "测试通知",
	}
	results := s.notifier.Send(msg)
	ok(c, gin.H{"results": results})
}

type sendNotifyReq struct {
	Alias string `json:"alias"`
	Code  string `json:"code"`
	From  string `json:"from"`
	Title string `json:"title"`
}

// sendNotifyHandler 处理 POST /api/notify/send:推送一条验证码通知。
func (s *Server) sendNotifyHandler(c *gin.Context) {
	if s.notifier == nil {
		failCode(c, http.StatusServiceUnavailable, "NOTIFY_UNAVAILABLE", "通知功能未启用")
		return
	}
	var req sendNotifyReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Alias == "" || req.Code == "" {
		failCode(c, http.StatusBadRequest, "VALIDATION_ERROR", "参数错误: alias 与 code 必填")
		return
	}
	cfg, _ := s.notifier.Config()
	if !cfg.Enabled() {
		ok(c, gin.H{"sent": false, "reason": "未配置通知渠道"})
		return
	}
	results := s.notifier.Send(notify.Message{
		Alias: req.Alias,
		Code:  req.Code,
		From:  req.From,
		Title: req.Title,
	})
	ok(c, gin.H{"sent": true, "results": results})
}
