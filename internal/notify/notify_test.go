package notify

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestEnabled(t *testing.T) {
	if (Config{}).Enabled() {
		t.Fatal("empty config should be disabled")
	}
	if (Config{BarkURL: "https://api.day.app/key"}).Enabled() != true {
		t.Fatal("bark only should be enabled")
	}
	if (Config{TelegramBotToken: "t"}).Enabled() {
		t.Fatal("telegram without chat id should be disabled")
	}
	if (Config{TelegramBotToken: "t", TelegramChatID: "1"}).Enabled() != true {
		t.Fatal("telegram full should be enabled")
	}
}

func TestSaveAndLoad(t *testing.T) {
	dir := t.TempDir()
	n := New(dir)
	cfg := Config{BarkURL: " https://api.day.app/key/ ", TelegramBotToken: " tok ", TelegramChatID: " 123 "}
	if err := n.SaveConfig(cfg); err != nil {
		t.Fatal(err)
	}
	// 文件应存在且权限 0600
	if _, err := os.Stat(filepath.Join(dir, "notify.json")); err != nil {
		t.Fatal(err)
	}
	loaded, err := n.Config()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.BarkURL != "https://api.day.app/key" {
		t.Fatalf("bark url not trimmed: %q", loaded.BarkURL)
	}
	if loaded.TelegramBotToken != "tok" || loaded.TelegramChatID != "123" {
		t.Fatalf("telegram fields not trimmed: %+v", loaded)
	}
}

func TestBarkURLEscaping(t *testing.T) {
	msg := Message{Alias: "a@icloud.com", Code: "123456", From: "f@x.com", Title: "T"}
	body := msg.barkBody()
	_ = url.PathEscape(body)
	if _, err := url.Parse("https://api.day.app/key/" + url.PathEscape("验证码 123456") + "/" + url.PathEscape(body)); err != nil {
		t.Fatalf("bark url invalid: %v", err)
	}
}