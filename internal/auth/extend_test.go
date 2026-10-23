package auth

import (
	"testing"
	"time"
)

func TestExtend(t *testing.T) {
	mgr, err := NewManager(Options{Password: "test-password", TTL: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	sid, _, ok := mgr.Login("test-password")
	if !ok {
		t.Fatal("login failed")
	}
	before, valid := mgr.Validate(sid)
	if !valid {
		t.Fatal("validate failed")
	}
	time.Sleep(10 * time.Millisecond)
	after, ok := mgr.Extend(sid)
	if !ok {
		t.Fatal("extend failed")
	}
	if !after.ExpiresAt.After(before.ExpiresAt) {
		t.Fatalf("expires not extended: before=%v after=%v", before.ExpiresAt, after.ExpiresAt)
	}
	if after.CSRFToken != before.CSRFToken {
		t.Fatal("csrf token should remain stable")
	}
}

func TestExtendInvalidSession(t *testing.T) {
	mgr, err := NewManager(Options{Password: "test-password", TTL: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := mgr.Extend("nonexistent"); ok {
		t.Fatal("extend should fail for unknown session")
	}
}