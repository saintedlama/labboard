# Contributing to LabBoard

Thank you for your interest in contributing to LabBoard! We welcome bug reports, feature suggestions, documentation improvements, and pull requests.

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## How Can I Contribute?

### Reporting Bugs

Before filing an issue, please search existing GitHub issues to see if the problem has already been reported. When creating a new bug report, include:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected vs. actual behavior
- Environment details (OS, browser, Go version, deployment method such as Docker vs. binary)
- Relevant console or server logs

### Suggesting Features & Enhancements

- Check existing issues and pull requests first.
- Open a feature request issue explaining the use case and desired behavior.
- For larger architectural changes, discuss the approach in an issue before opening a pull request.

### Submitting Pull Requests

Small fixes, documentation updates, and focused bug fixes are welcome directly via Pull Request.

---

## Development Setup

### Prerequisites

- [Go](https://go.dev/) **1.27+**
- [Node.js](https://nodejs.org/) **22+** with [Corepack](https://nodejs.org/api/corepack.html) (`pnpm` 10+)
- Optional: [Invincible](https://github.com/saintedlama/invincible) for running backend + frontend concurrently with file watching

### Initial Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/<your-username>/labboard.git
   cd labboard
   ```
2. Install frontend dependencies:
   ```bash
   cd frontend
   corepack enable
   pnpm install --frozen-lockfile
   cd ..
   ```

---

## Development Workflow

### Running Locally

Start both backend (`:8080`) and frontend Vite dev server (`:5173`) with Invincible:

```bash
invincible
```

Or run them separately:

```bash
# Terminal 1: Go backend
go run ./cmd/labboard

# Terminal 2: Frontend dev server with HMR and /api proxy
cd frontend && corepack pnpm dev
```

### Verification & Linting

Before pushing, run the same checks enforced in CI:

```bash
# Frontend typecheck & production build (required before Go build/tests due to go:embed)
cd frontend
corepack pnpm exec tsc --noEmit
corepack pnpm run build
cd ..

# Formatting, static analysis, and unit/API tests
gofmt -l .
go vet ./...
go mod tidy && git diff --exit-code go.mod go.sum
go run honnef.co/go/tools/cmd/staticcheck@v0.8.2 ./...
go run golang.org/x/tools/cmd/deadcode@v0.50.0 -test ./...
go test -race ./...
```

---

## Codebase Overview

```
labboard/
├── cmd/labboard/       # Main entrypoint & graceful shutdown
├── internal/
│   ├── api/            # HTTP handlers, SPA static server, API tests
│   ├── config/         # CLI flags, env vars, .env loading
│   ├── db/             # SQLite connection, migrations, board & library CRUD
│   └── models/         # API request/response models
├── frontend/           # React 19 + TypeScript + Vite + @excalidraw/excalidraw
└── .github/workflows/  # CI and GHCR Docker publishing workflows
```

---

## Pull Request Guidelines

1. **Branch naming**: Use clear names such as `feat/board-export`, `fix/theme-sync`, or `docs/update-quickstart`.
2. **Commit messages**: We follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`).
3. **Keep checks green**: Ensure frontend typecheck/build and Go formatting, linting, and tests pass cleanly.
4. **Update documentation**: Update [README.md](README.md) if your change affects configuration, API endpoints, or user-facing behavior.

---

## License Notice

LabBoard is licensed under the [MIT License](LICENSE). By contributing to LabBoard, you agree that your contributions will be licensed under the terms of the MIT License.
