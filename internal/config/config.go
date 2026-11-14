package config

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
)

const (
	DefaultHost    = "127.0.0.1"
	DefaultPort    = "8080"
	DefaultDataDir = "./data"
	DefaultDBName  = "labboard.db"
	DefaultEnvFile = ".env"
)

type Config struct {
	Host    string
	Port    string
	DataDir string
	DBName  string
	EnvFile string
}

func (c *Config) Addr() string {
	return fmt.Sprintf("%s:%s", c.Host, c.Port)
}

func (c *Config) DBPath() string {
	return filepath.Join(c.DataDir, c.DBName)
}

// Load loads configuration with the following precedence (highest to lowest):
// 1. CLI flags (-host, -port, -data-dir, -db-name, -env)
// 2. Environment variables (HOST, PORT, DATA_DIR, DB_NAME)
// 3. .env file (or custom file passed via -env / LABBOARD_ENV_FILE)
// 4. Defaults (Host: 127.0.0.1, Port: 8080, DataDir: ./data, DBName: labboard.db)
func Load(args []string) (*Config, error) {
	explicitEnvFile := findEnvArg(args)
	envFile := explicitEnvFile
	if envFile == "" {
		envFile = os.Getenv("LABBOARD_ENV_FILE")
	}
	if envFile == "" {
		envFile = DefaultEnvFile
	}

	if err := loadEnvFile(envFile, explicitEnvFile != ""); err != nil {
		return nil, err
	}

	cfg := &Config{
		EnvFile: envFile,
	}

	defaultHost := envOrDefault("HOST", DefaultHost)
	defaultPort := envOrDefault("PORT", DefaultPort)
	defaultDataDir := envOrDefault("DATA_DIR", DefaultDataDir)
	defaultDBName := envOrDefault("DB_NAME", DefaultDBName)

	fs := flag.NewFlagSet("labboard", flag.ContinueOnError)
	fs.SetOutput(io.Discard)

	var dummyEnv string
	fs.StringVar(&dummyEnv, "env", envFile, "Path to .env configuration file")
	fs.StringVar(&cfg.Host, "host", defaultHost, "HTTP listen host")
	fs.StringVar(&cfg.Port, "port", defaultPort, "HTTP listen port")
	fs.StringVar(&cfg.DataDir, "data-dir", defaultDataDir, "Directory for SQLite database")
	fs.StringVar(&cfg.DBName, "db-name", defaultDBName, "SQLite database filename")

	if err := fs.Parse(args); err != nil {
		return nil, fmt.Errorf("parse flags: %w", err)
	}

	return cfg, nil
}

func loadEnvFile(filename string, required bool) error {
	info, err := os.Stat(filename)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			if required {
				return fmt.Errorf("env file not found: %s", filename)
			}
			return nil
		}
		return fmt.Errorf("read env file %s: %w", filename, err)
	}

	if info.IsDir() {
		if required {
			return fmt.Errorf("env file is a directory: %s", filename)
		}
		return nil
	}

	// godotenv.Load does not overwrite existing process environment variables
	if err := godotenv.Load(filename); err != nil {
		return fmt.Errorf("load env file %s: %w", filename, err)
	}
	return nil
}

func findEnvArg(args []string) string {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "-env" || arg == "--env" {
			if i+1 < len(args) {
				return args[i+1]
			}
		}
		if strings.HasPrefix(arg, "-env=") {
			return strings.TrimPrefix(arg, "-env=")
		}
		if strings.HasPrefix(arg, "--env=") {
			return strings.TrimPrefix(arg, "--env=")
		}
	}
	return ""
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
