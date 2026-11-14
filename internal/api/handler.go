package api

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"path/filepath"
	"strings"

	"github.com/saintedlama/labboard/internal/db"
	"github.com/saintedlama/labboard/internal/models"
)

const maxRequestBodyBytes = 64 << 20 // 64 MB (supports embedded images in Excalidraw files)

type Server struct {
	store  *db.Store
	distFS fs.FS
	mux    *http.ServeMux
}

func NewServer(store *db.Store, distFS fs.FS) *Server {
	s := &Server{
		store:  store,
		distFS: distFS,
		mux:    http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/boards", s.handleListBoards)
	s.mux.HandleFunc("POST /api/boards", s.handleCreateBoard)
	s.mux.HandleFunc("GET /api/boards/{id}", s.handleGetBoard)
	s.mux.HandleFunc("PUT /api/boards/{id}", s.handleUpdateBoard)
	s.mux.HandleFunc("DELETE /api/boards/{id}", s.handleDeleteBoard)
	s.mux.HandleFunc("GET /api/library", s.handleGetLibrary)
	s.mux.HandleFunc("PUT /api/library", s.handleSaveLibrary)
	s.mux.HandleFunc("/", s.handleSPA)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleGetLibrary(w http.ResponseWriter, r *http.Request) {
	lib, err := s.store.GetLibrary(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get library")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(lib)
}

func (s *Server) handleSaveLibrary(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body")
		return
	}
	if len(body) == 0 || !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if err := s.store.SaveLibrary(r.Context(), json.RawMessage(body)); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save library")
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func (s *Server) handleListBoards(w http.ResponseWriter, r *http.Request) {
	tag := r.URL.Query().Get("tag")
	query := r.URL.Query().Get("q")

	boards, err := s.store.ListBoards(r.Context(), tag, query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list boards")
		return
	}
	writeJSON(w, http.StatusOK, boards)
}

func (s *Server) handleCreateBoard(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
	var req models.CreateBoardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	board, err := s.store.CreateBoard(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create board")
		return
	}
	writeJSON(w, http.StatusCreated, board)
}

func (s *Server) handleGetBoard(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	board, err := s.store.GetBoard(r.Context(), id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "board not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get board")
		return
	}
	writeJSON(w, http.StatusOK, board)
}

func (s *Server) handleUpdateBoard(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)

	var req models.UpdateBoardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	board, err := s.store.UpdateBoard(r.Context(), id, req)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "board not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update board")
		return
	}
	writeJSON(w, http.StatusOK, board)
}

func (s *Server) handleDeleteBoard(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	err := s.store.DeleteBoard(r.Context(), id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "board not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete board")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSPA(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	if s.distFS == nil {
		http.Error(w, "frontend assets not embedded", http.StatusServiceUnavailable)
		return
	}

	cleanPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if cleanPath == "" || cleanPath == "." {
		cleanPath = "index.html"
	}

	if s.serveFileIfExists(w, r, cleanPath) {
		return
	}

	// SPA fallback to index.html for client-side routes like /boards/:id
	if s.serveFileIfExists(w, r, "index.html") {
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = w.Write([]byte("labboard frontend not built yet. Run `npm run build` in frontend/ or use Vite dev server."))
}

func (s *Server) serveFileIfExists(w http.ResponseWriter, r *http.Request, name string) bool {
	info, err := fs.Stat(s.distFS, name)
	if err != nil || info.IsDir() {
		return false
	}

	f, err := s.distFS.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()

	if ctype := mime.TypeByExtension(filepath.Ext(name)); ctype != "" {
		w.Header().Set("Content-Type", ctype)
	}

	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else if name == "index.html" {
		w.Header().Set("Cache-Control", "no-cache")
	}

	rs, ok := f.(io.ReadSeeker)
	if ok {
		http.ServeContent(w, r, name, info.ModTime(), rs)
		return true
	}

	data, err := io.ReadAll(f)
	if err != nil {
		return false
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
