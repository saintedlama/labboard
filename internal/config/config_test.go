package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/saintedlama/labboard/internal/config"
)

func clearEnv(t *testing.T) {
	t.Helper()
	keys := []string{"HOST", "PORT", "DATA_DIR", "DB_NAME", "LABBOARD_ENV_FILE"}
	for _, k := range keys {
		old, exists := os.LookupEnv(k)
		if exists {
			t.Cleanup(func() { _ = os.Setenv(k, old) })
			_ = os.Unsetenv(k)
		}
	}
}

func TestConfigDefaults(t *testing.T) {
	clearEnv(t)

	cfg, err := config.Load([]string{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Host != "127.0.0.1" {
		t.Fatalf("expected host 127.0.0.1, got %q", cfg.Host)
	}
	if cfg.Port != "8080" {
		t.Fatalf("expected port 8080, got %q", cfg.Port)
	}
	if cfg.DataDir != "./data" {
		t.Fatalf("expected data-dir ./data, got %q", cfg.DataDir)
	}
	if cfg.DBName != "labboard.db" {
		t.Fatalf("expected db-name labboard.db, got %q", cfg.DBName)
	}
	if cfg.Addr() != "127.0.0.1:8080" {
		t.Fatalf("expected addr 127.0.0.1:8080, got %q", cfg.Addr())
	}
}

func TestConfigFromEnvFile(t *testing.T) {
	clearEnv(t)

	tmpDir := t.TempDir()
	envPath := filepath.Join(tmpDir, "custom.env")
	envContent := "HOST=0.0.0.0\nPORT=9090\nDATA_DIR=/custom/data\nDB_NAME=custom.db\n"
	if err := os.WriteFile(envPath, []byte(envContent), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}

	cfg, err := config.Load([]string{"-env", envPath})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Host != "0.0.0.0" {
		t.Fatalf("expected host 0.0.0.0, got %q", cfg.Host)
	}
	if cfg.Port != "9090" {
		t.Fatalf("expected port 9090, got %q", cfg.Port)
	}
	if cfg.DataDir != "/custom/data" {
		t.Fatalf("expected data-dir /custom/data, got %q", cfg.DataDir)
	}
	if cfg.DBName != "custom.db" {
		t.Fatalf("expected db-name custom.db, got %q", cfg.DBName)
	}
}

func TestConfigFlagPrecedenceOverEnv(t *testing.T) {
	clearEnv(t)

	t.Setenv("HOST", "0.0.0.0")
	t.Setenv("PORT", "7000")

	cfg, err := config.Load([]string{"-port", "4000", "-host", "127.0.0.2"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Host != "127.0.0.2" {
		t.Fatalf("flag host should override env, got %q", cfg.Host)
	}
	if cfg.Port != "4000" {
		t.Fatalf("flag port should override env, got %q", cfg.Port)
	}
}

func TestConfigMissingExplicitEnvFile(t *testing.T) {
	clearEnv(t)

	_, err := config.Load([]string{"-env", "nonexistent.env"})
	if err == nil {
		t.Fatalf("expected error for missing explicit env file, got nil")
	}
}
