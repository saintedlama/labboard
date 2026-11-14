package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/saintedlama/labboard/frontend"
	"github.com/saintedlama/labboard/internal/api"
	"github.com/saintedlama/labboard/internal/config"
	"github.com/saintedlama/labboard/internal/db"
)

func main() {
	cfg, err := config.Load(os.Args[1:])
	if err != nil {
		log.Fatalf("configuration error: %v", err)
	}

	store, err := db.Open(cfg.DataDir, cfg.DBName)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			log.Printf("error closing database: %v", err)
		}
	}()

	distFS, err := frontend.DistFS()
	if err != nil {
		log.Fatalf("failed to load embedded frontend: %v", err)
	}

	handler := api.NewServer(store, distFS)
	addr := cfg.Addr()

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("labboard listening on http://%s (db: %s)", addr, cfg.DBPath())
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}
