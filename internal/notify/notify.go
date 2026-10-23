// Package notify 提供验证码到达时的推送通知(Bark / Telegram)。
// 配置持久化于 data/notify.json,可全局启用一个或多个渠道。
package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Config 通知配置(持久化)。
type Config struct {
	// Bark 推送(bark.day.app 或自建),为服务器 URL 前缀,如 https://api.day.app/yourkey
	BarkURL string `json:"bark_url,omitempty"`
	// Telegram Bot Token
	TelegramBotToken string `json:"telegram_bot_token,omitempty"`
	// Telegram Chat ID
	TelegramChatID string `json:"telegram_chat_id,omitempty"`
}

// Notifier 发送通知。
type Notifier struct {
	cfgPath string
	client  *http.Client
}

// fileStore 基于文件的配置存储。
type fileStore struct{ path string }

func (s *fileStore) Load() (Config, error) {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return Config{}, nil
		}
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Config{}, fmt.Errorf("解析通知配置失败: %w", err)
	}
	return cfg, nil
}

func (s *fileStore) Save(cfg Config) error {
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, raw, 0o600)
}

// New 创建通知器;dataDir 下读写 notify.json。
func New(dataDir string) *Notifier {
	return &Notifier{
		cfgPath: filepath.Join(dataDir, "notify.json"),
		client:  &http.Client{Timeout: 15 * time.Second},
	}
}

// Config 读取当前配置(每次从盘读,保持简单一致)。
func (n *Notifier) Config() (Config, error) {
	store := fileStore{path: n.cfgPath}
	return store.Load()
}

// SaveConfig 持久化配置(去除首尾空白)。
func (n *Notifier) SaveConfig(cfg Config) error {
	cfg.BarkURL = strings.TrimRight(strings.TrimSpace(cfg.BarkURL), "/")
	cfg.TelegramBotToken = strings.TrimSpace(cfg.TelegramBotToken)
	cfg.TelegramChatID = strings.TrimSpace(cfg.TelegramChatID)
	store := fileStore{path: n.cfgPath}
	return store.Save(cfg)
}

// Enabled 是否至少配置了一个渠道。
func (c Config) Enabled() bool {
	return c.BarkURL != "" || (c.TelegramBotToken != "" && c.TelegramChatID != "")
}

// Message 一条待推送的验证码通知。
type Message struct {
	Alias string // 收件别名
	Code  string // 提取到的验证码
	From  string // 发件人
	Title string // 邮件主题
}

func (m Message) barkBody() string {
	var b strings.Builder
	fmt.Fprintf(&b, "验证码: %s\n", m.Code)
	fmt.Fprintf(&b, "别名: %s\n", m.Alias)
	if m.From != "" {
		fmt.Fprintf(&b, "发件人: %s\n", m.From)
	}
	if m.Title != "" {
		fmt.Fprintf(&b, "主题: %s", m.Title)
	}
	return b.String()
}

// Send 推送到所有已配置渠道;返回每个渠道的错误(空字符串表示成功)。
func (n *Notifier) Send(msg Message) map[string]error {
	cfg, err := n.Config()
	if err != nil {
		return map[string]error{"config": err}
	}
	result := make(map[string]error)
	if cfg.BarkURL != "" {
		result["bark"] = n.sendBark(cfg.BarkURL, msg)
	}
	if cfg.TelegramBotToken != "" && cfg.TelegramChatID != "" {
		result["telegram"] = n.sendTelegram(cfg, msg)
	}
	return result
}

func (n *Notifier) sendBark(baseURL string, msg Message) error {
	// GET {base}/{title}/{body},支持 URL query 参数(响铃等由服务端 URL 自带)
	base := strings.TrimRight(baseURL, "/")
	u := fmt.Sprintf("%s/%s/%s", base, url.PathEscape("验证码 "+msg.Code), url.PathEscape(msg.barkBody()))
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	return n.do(req)
}

type tgResp struct {
	OK          bool   `json:"ok"`
	Description string `json:"description"`
}

func (n *Notifier) sendTelegram(cfg Config, msg Message) error {
	api := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", cfg.TelegramBotToken)
	text := fmt.Sprintf("🔐 验证码: %s\n📮 别名: %s", msg.Code, msg.Alias)
	if msg.From != "" {
		text += fmt.Sprintf("\n📨 发件人: %s", msg.From)
	}
	if msg.Title != "" {
		text += fmt.Sprintf("\n📄 主题: %s", msg.Title)
	}
	payload, _ := json.Marshal(map[string]string{
		"chat_id": cfg.TelegramChatID,
		"text":    text,
	})
	req, err := http.NewRequest(http.MethodPost, api, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	body, err := n.doBody(req)
	if err != nil {
		return err
	}
	var resp tgResp
	if err := json.Unmarshal(body, &resp); err != nil {
		return fmt.Errorf("telegram 响应解析失败: %w", err)
	}
	if !resp.OK {
		return fmt.Errorf("telegram: %s", resp.Description)
	}
	return nil
}

func (n *Notifier) do(req *http.Request) error {
	resp, err := n.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil
}

func (n *Notifier) doBody(req *http.Request) ([]byte, error) {
	resp, err := n.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	buf := new(bytes.Buffer)
	if _, err := buf.ReadFrom(resp.Body); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, buf.String())
	}
	return buf.Bytes(), nil
}

// NotifyAsync 异步发送,失败仅记日志。
func (n *Notifier) NotifyAsync(msg Message) {
	go func() {
		for channel, err := range n.Send(msg) {
			if err != nil {
				log.Printf("通知发送失败 channel=%s alias=%s err=%v", channel, msg.Alias, err)
			}
		}
	}()
}
