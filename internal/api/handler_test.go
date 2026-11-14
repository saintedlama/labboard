package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/saintedlama/labboard/internal/api"
	"github.com/saintedlama/labboard/internal/db"
	"github.com/saintedlama/labboard/internal/models"
)

func setupTestServer(t *testing.T) *api.Server {
	t.Helper()
	store, err := db.Open(t.TempDir(), "test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	distFS := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html><body>ok</body></html>")},
	}
	return api.NewServer(store, distFS)
}

func TestBoardCRUDAndSPAFallback(t *testing.T) {
	srv := setupTestServer(t)

	// 1. Create board
	createBody := `{"title":"Homelab Network","tags":["infra","network"],"data":{"elements":[{"id":"r1","type":"rectangle"}],"appState":{},"files":{}}}`
	req := httptest.NewRequest(http.MethodPost, "/api/boards", bytes.NewBufferString(createBody))
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var created models.Board
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("decode created: %v", err)
	}
	if created.ID == "" || created.Title != "Homelab Network" || len(created.Tags) != 2 {
		t.Fatalf("unexpected created board: %+v", created)
	}

	// 2. List boards (with tag filter)
	req = httptest.NewRequest(http.MethodGet, "/api/boards?tag=infra", nil)
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var list []models.BoardSummary
	if err := json.NewDecoder(rec.Body).Decode(&list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list) != 1 || list[0].ID != created.ID {
		t.Fatalf("expected 1 board in list, got %+v", list)
	}

	// 3. Get board
	req = httptest.NewRequest(http.MethodGet, "/api/boards/"+created.ID, nil)
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	// 4. Update board
	updateBody := `{"title":"Updated Homelab","tags":["homelab"]}`
	req = httptest.NewRequest(http.MethodPut, "/api/boards/"+created.ID, bytes.NewBufferString(updateBody))
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var updated models.Board
	if err := json.NewDecoder(rec.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated: %v", err)
	}
	if updated.Title != "Updated Homelab" || len(updated.Tags) != 1 || updated.Tags[0] != "homelab" {
		t.Fatalf("unexpected updated board: %+v", updated)
	}

	// 5. SPA fallback route
	req = httptest.NewRequest(http.MethodGet, "/boards/"+created.ID, nil)
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte("<html>")) {
		t.Fatalf("expected SPA index.html fallback, got %d: %s", rec.Code, rec.Body.String())
	}

	// 6. Delete board
	req = httptest.NewRequest(http.MethodDelete, "/api/boards/"+created.ID, nil)
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}

	// 7. Get deleted board returns 404
	req = httptest.NewRequest(http.MethodGet, "/api/boards/"+created.ID, nil)
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", rec.Code)
	}
}
