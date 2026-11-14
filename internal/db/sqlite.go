package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/saintedlama/labboard/internal/models"
	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("board not found")

type Store struct {
	db *sql.DB
}

func Open(dataDir, dbName string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, dbName)
	sqlDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}

	// SQLite handles concurrent reads well in WAL mode, while serializing writes cleanly.
	sqlDB.SetMaxOpenConns(1)

	if _, err := sqlDB.Exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA busy_timeout = 5000;
		PRAGMA foreign_keys = ON;
	`); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("configure sqlite pragmas: %w", err)
	}

	store := &Store{db: sqlDB}
	if err := store.migrate(); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("migrate database: %w", err)
	}

	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS boards (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			tags TEXT NOT NULL DEFAULT '[]',
			data TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_boards_updated_at ON boards (updated_at DESC);
		CREATE TABLE IF NOT EXISTS app_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
	`)
	return err
}

func (s *Store) GetLibrary(ctx context.Context) (json.RawMessage, error) {
	var val string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM app_settings WHERE key = 'library'`).Scan(&val)
	if errors.Is(err, sql.ErrNoRows) {
		return json.RawMessage(`{"libraryItems":[]}`), nil
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(val) == "" {
		return json.RawMessage(`{"libraryItems":[]}`), nil
	}
	return json.RawMessage(val), nil
}

func (s *Store) SaveLibrary(ctx context.Context, data json.RawMessage) error {
	if len(data) == 0 || !json.Valid(data) {
		data = json.RawMessage(`{"libraryItems":[]}`)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO app_settings (key, value, updated_at)
		VALUES ('library', ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`, string(data), now)
	return err
}

func (s *Store) ListBoards(ctx context.Context, tagFilter, searchQuery string) ([]models.BoardSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, title, tags, created_at, updated_at
		FROM boards
		ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tagFilter = strings.TrimSpace(strings.ToLower(tagFilter))
	searchQuery = strings.TrimSpace(strings.ToLower(searchQuery))

	boards := make([]models.BoardSummary, 0)
	for rows.Next() {
		var (
			b          models.BoardSummary
			tagsJSON   string
			createdRaw string
			updatedRaw string
		)
		if err := rows.Scan(&b.ID, &b.Title, &tagsJSON, &createdRaw, &updatedRaw); err != nil {
			return nil, err
		}

		b.Tags = decodeTags(tagsJSON)
		b.CreatedAt = parseTime(createdRaw)
		b.UpdatedAt = parseTime(updatedRaw)

		if tagFilter != "" && !hasTag(b.Tags, tagFilter) {
			continue
		}
		if searchQuery != "" && !matchesQuery(b.Title, b.Tags, searchQuery) {
			continue
		}

		boards = append(boards, b)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	return boards, nil
}

func (s *Store) GetBoard(ctx context.Context, id string) (*models.Board, error) {
	var (
		b          models.Board
		tagsJSON   string
		dataRaw    string
		createdRaw string
		updatedRaw string
	)

	err := s.db.QueryRowContext(ctx, `
		SELECT id, title, tags, data, created_at, updated_at
		FROM boards
		WHERE id = ?
	`, id).Scan(&b.ID, &b.Title, &tagsJSON, &dataRaw, &createdRaw, &updatedRaw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	b.Tags = decodeTags(tagsJSON)
	if strings.TrimSpace(dataRaw) == "" {
		b.Data = json.RawMessage(`{}`)
	} else {
		b.Data = json.RawMessage(dataRaw)
	}
	b.CreatedAt = parseTime(createdRaw)
	b.UpdatedAt = parseTime(updatedRaw)
	return &b, nil
}

func (s *Store) CreateBoard(ctx context.Context, req models.CreateBoardRequest) (*models.Board, error) {
	id, err := newID()
	if err != nil {
		return nil, fmt.Errorf("generate id: %w", err)
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Untitled Board"
	}

	tags := normalizeTags(req.Tags)
	tagsBytes, err := json.Marshal(tags)
	if err != nil {
		return nil, err
	}

	data := req.Data
	if len(data) == 0 || !json.Valid(data) {
		data = json.RawMessage(`{"elements":[],"appState":{},"files":{}}`)
	}

	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339Nano)

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO boards (id, title, tags, data, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, id, title, string(tagsBytes), string(data), nowStr, nowStr)
	if err != nil {
		return nil, err
	}

	return &models.Board{
		ID:        id,
		Title:     title,
		Tags:      tags,
		Data:      data,
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

func (s *Store) UpdateBoard(ctx context.Context, id string, req models.UpdateBoardRequest) (*models.Board, error) {
	existing, err := s.GetBoard(ctx, id)
	if err != nil {
		return nil, err
	}

	if req.Title != nil {
		trimmed := strings.TrimSpace(*req.Title)
		if trimmed != "" {
			existing.Title = trimmed
		}
	}
	if req.Tags != nil {
		existing.Tags = normalizeTags(*req.Tags)
	}
	if req.Data != nil && len(*req.Data) > 0 && json.Valid(*req.Data) {
		existing.Data = *req.Data
	}

	existing.UpdatedAt = time.Now().UTC()

	tagsBytes, err := json.Marshal(existing.Tags)
	if err != nil {
		return nil, err
	}

	res, err := s.db.ExecContext(ctx, `
		UPDATE boards
		SET title = ?, tags = ?, data = ?, updated_at = ?
		WHERE id = ?
	`, existing.Title, string(tagsBytes), string(existing.Data), existing.UpdatedAt.Format(time.RFC3339Nano), id)
	if err != nil {
		return nil, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected == 0 {
		return nil, ErrNotFound
	}

	return existing, nil
}

func (s *Store) DeleteBoard(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM boards WHERE id = ?`, id)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func newID() (string, error) {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func normalizeTags(raw []string) []string {
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for _, t := range raw {
		trimmed := strings.TrimSpace(t)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func decodeTags(raw string) []string {
	var tags []string
	if err := json.Unmarshal([]byte(raw), &tags); err != nil || tags == nil {
		return []string{}
	}
	return tags
}

func hasTag(tags []string, filterLower string) bool {
	for _, t := range tags {
		if strings.ToLower(t) == filterLower {
			return true
		}
	}
	return false
}

func matchesQuery(title string, tags []string, queryLower string) bool {
	if strings.Contains(strings.ToLower(title), queryLower) {
		return true
	}
	for _, t := range tags {
		if strings.Contains(strings.ToLower(t), queryLower) {
			return true
		}
	}
	return false
}

func parseTime(raw string) time.Time {
	if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t
	}
	return time.Time{}
}
