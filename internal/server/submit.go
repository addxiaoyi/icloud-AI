package server

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const submitMaxBodySize = 64 * 1024
const submitTimeout = 30 * time.Second

type submitStep struct {
	// URL 模板,支持占位符 {alias} {code} {label}
	URL    string            `json:"url"`
	Method string            `json:"method"`
	// Header 模板,值支持占位符
	Headers map[string]string `json:"headers,omitempty"`
	// Body 模板,支持占位符
	Body string `json:"body,omitempty"`
}

type submitReq struct {
	// Step1 注册(可选,若为空则跳过)
	Step1 *submitStep `json:"step1,omitempty"`
	// Step2 提交验证码
	Step2 submitStep `json:"step2"`
	Alias string     `json:"alias"`
	Code  string     `json:"code"`
	Label string     `json:"label"`
}

type stepResult struct {
	Status  int    `json:"status"`
	Body    string `json:"body"`
	Error   string `json:"error,omitempty"`
	Latency int64  `json:"latency_ms"`
}

func renderTemplate(tpl string, alias, code, label string) string {
	r := strings.NewReplacer(
		"{alias}", alias,
		"{code}", code,
		"{label}", label,
		"{url_escape_alias}", urlEscape(alias),
	)
	return r.Replace(tpl)
}

func urlEscape(s string) string {
	// 简单 encodeURIComponent
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// runSubmitStep 执行单步 HTTP 请求。
func runSubmitStep(step submitStep, alias, code, label string) stepResult {
	start := time.Now()
	result := stepResult{}
	method := strings.ToUpper(strings.TrimSpace(step.Method))
	if method == "" {
		method = http.MethodPost
	}
	if method != http.MethodGet && method != http.MethodPost && method != http.MethodPut && method != http.MethodPatch {
		result.Error = fmt.Sprintf("不支持的方法: %s", method)
		return result
	}
	target := renderTemplate(step.URL, alias, code, label)
	if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
		result.Error = "URL 需以 http(s):// 开头"
		return result
	}
	var bodyReader io.Reader
	if step.Body != "" && method != http.MethodGet {
		bodyReader = strings.NewReader(renderTemplate(step.Body, alias, code, label))
	}
	req, err := http.NewRequest(method, target, bodyReader)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	for k, v := range step.Headers {
		req.Header.Set(k, renderTemplate(v, alias, code, label))
	}
	if step.Body != "" && method != http.MethodGet && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: submitTimeout}
	resp, err := client.Do(req)
	if err != nil {
		result.Error = err.Error()
		result.Latency = time.Since(start).Milliseconds()
		return result
	}
	defer resp.Body.Close()
	result.Status = resp.StatusCode
	body, err := io.ReadAll(io.LimitReader(resp.Body, submitMaxBodySize))
	if err != nil {
		result.Error = err.Error()
	} else {
		result.Body = string(body)
	}
	result.Latency = time.Since(start).Milliseconds()
	return result
}

// handleSubmitHandler 处理 POST /api/submit:两步式注册代理提交。
func (s *Server) handleSubmitHandler(c *gin.Context) {
	var req submitReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Alias == "" || req.Code == "" || req.Step2.URL == "" {
		failCode(c, http.StatusBadRequest, "VALIDATION_ERROR", "参数错误: alias, code, step2.url 必填")
		return
	}
	response := gin.H{}
	if req.Step1 != nil && req.Step1.URL != "" {
		r1 := runSubmitStep(*req.Step1, req.Alias, req.Code, req.Label)
		response["step1"] = r1
		if r1.Error != "" || r1.Status >= 400 {
			response["success"] = false
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "code": "UPSTREAM_FAILURE", "message": "第一步(注册)失败", "data": response})
			return
		}
	}
	r2 := runSubmitStep(req.Step2, req.Alias, req.Code, req.Label)
	response["step2"] = r2
	if r2.Error != "" || r2.Status >= 400 {
	response["success"] = false
	c.JSON(http.StatusBadGateway, gin.H{"success": false, "code": "UPSTREAM_FAILURE", "message": "第二步(提交验证码)失败", "data": response})
	return
	}
	response["success"] = true
	ok(c, response)
}
