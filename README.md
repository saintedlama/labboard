# labboard 📋🎨

> **Self-hosted Excalidraw with persistence in a single binary.**  
> Built for homelabs — no auth, no cloud dependencies, no fluff.

`labboard` couples the official `@excalidraw/excalidraw` React component with a lightweight Go backend backed by SQLite. All frontend assets are embedded into the Go binary at compile time, giving you a zero-dependency, single-file server that persists your boards, sketches, and diagrams right on your home server.

---

## ✨ Features

- **Full Excalidraw Canvas**: Powered by the official `@excalidraw/excalidraw` React component.
- **Persistent Boards**: Canvas events automatically save elements and state into an embedded SQLite database.
- **Board Management**: Simple dashboard to view, filter, create, and delete boards with:
  - Title & description
  - Custom tags
  - Created & updated timestamps
- **Single Binary Deployment**: Go embeds the compiled React SPA using `go:embed`. No separate frontend server or static file hosting required.
- **Homelab First**:
  - No authentication, accounts, or telemetry.
  - Safe by default: binds strictly to `127.0.0.1` unless configured otherwise.
  - Sits neatly behind Tailscale, WireGuard, Cloudflare Access, or a reverse proxy.
  - Tiny resource footprint and instant startup.
  - Easy file-based backups (just copy the `.db` file).
- **Fast Local Development**: Integrated with [Invincible](https://github.com/chris/invincible) to orchestrate Go and React live-reloading during development.

---

## 🎨 Color Scheme (One Dark Pro Night Flat)

The UI adheres strictly to the **One Dark Pro Night Flat** palette ([`zhuangtongfa.Material-theme/one-dark-pro-night-flat`](https://vscodethemes.com/e/zhuangtongfa.Material-theme/one-dark-pro-night-flat)), delivering a seamless, high-contrast flat dark theme designed for extended focus:

### Surface & Backgrounds

| Token | Hex | Role |
|---|---|---|
| `bg-canvas` | `#16191d` | Main app background, canvas backdrop, and base layer |
| `bg-surface` | `#1e2227` | Cards, dashboard header, dropdowns, and modal dialogs |
| `bg-input` | `#1d1f23` | Search boxes, text fields, and tag inputs |
| `bg-active` | `#23272e` | Active tabs, selected rows, active badges |
| `bg-hover` | `#2c313a` | Interactive hover state for list items, cards, and buttons |
| `bg-focus` | `#323842` | Focused row / keyboard selection background |

### Borders & Dividers

| Token | Hex | Role |
|---|---|---|
| `border-subtle` | `#181a1f` | Subtle card borders, dividers, and tab boundaries |
| `border-default` | `#37393d` | Input boundaries, table dividers, panel borders |
| `border-focus` | `#528bff` | Focused input ring and active tab indicator |

### Typography

| Token | Hex | Role |
|---|---|---|
| `text-primary` | `#abb2bf` | Standard body text, descriptions, icons |
| `text-bright` | `#d7dae0` | Headings, active board titles, strong highlights |
| `text-muted` | `#667187` | Created/updated timestamps, placeholders, count labels |

### Accents & Tags

| Token | Name | Hex | Role |
|---|---|---|---|
| `accent-blue` | Malibu Blue | `#61afef` | Primary action buttons, active navigation, links |
| `accent-purple` | Purple | `#c678dd` | Tags, board category badges |
| `accent-green` | Green | `#98c379` | Auto-save / synced status indicators, success badges |
| `accent-orange` | Whiskey Orange | `#d19a66` | Unsaved / dirty changes indicator, warning labels |
| `accent-yellow` | Chalky Yellow | `#e5c07b` | Highlighted tags, starred boards |
| `accent-red` | Coral Red | `#e06c75` | Delete board action, destructive buttons, error toasts |
| `accent-cyan` | Fountain Cyan | `#56b6c2` | Secondary filters, tag counters |

### CSS Variables Reference

```css
:root {
  /* Surfaces */
  --color-bg-canvas: #16191d;
  --color-bg-surface: #1e2227;
  --color-bg-input: #1d1f23;
  --color-bg-active: #23272e;
  --color-bg-hover: #2c313a;
  --color-bg-focus: #323842;

  /* Borders */
  --color-border-subtle: #181a1f;
  --color-border-default: #37393d;
  --color-border-focus: #528bff;

  /* Typography */
  --color-text-primary: #abb2bf;
  --color-text-bright: #d7dae0;
  --color-text-muted: #667187;

  /* Accents */
  --color-accent-blue: #61afef;
  --color-accent-purple: #c678dd;
  --color-accent-green: #98c379;
  --color-accent-orange: #d19a66;
  --color-accent-yellow: #e5c07b;
  --color-accent-red: #e06c75;
  --color-accent-cyan: #56b6c2;
}
```

---

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      labboard Binary                        │
│                                                             │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │     React Frontend    │       │       Go Backend      │  │
│  │ (Embedded Static SPA) │       │                       │  │
│  │                       │ HTTP  │  • Static File Server │  │
│  │  • Boards Dashboard   │◄─────►│  • REST API Engine    │  │
│  │  • Excalidraw Canvas  │ JSON  │  • SQLite Storage     │  │
│  │  • Auto-save via      │       │                       │  │
│  │    change events      │       └──────────┬────────────┘  │
│  └───────────────────────┘                  │               │
│                                             ▼               │
│                                    ┌─────────────────┐      │
│                                    │   SQLite File   │      │
│                                    │ (labboard.db)   │      │
│                                    └─────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Data Model

Each board is stored with metadata and serialized scene data:

| Field | Type | Description |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Unique UUID or slug for the board |
| `title` | `TEXT NOT NULL` | Human-readable title |
| `tags` | `TEXT` | Comma-separated or JSON array of tags |
| `data` | `BLOB / JSON` | Serialized Excalidraw elements & state |
| `created_at` | `DATETIME` | Timestamp when the board was created |
| `updated_at` | `DATETIME` | Timestamp of the most recent save |

### REST API

- `GET /api/boards` — List all boards (with optional tag filtering)
- `POST /api/boards` — Create a new board
- `GET /api/boards/:id` — Retrieve a board by ID (including canvas scene data)
- `PUT /api/boards/:id` — Update board title, tags, and canvas data
- `DELETE /api/boards/:id` — Remove a board

---

## 🚀 Quick Start

### Running the Binary

```bash
# Run with defaults (listens on 127.0.0.1:8080, db at ./data/labboard.db)
./labboard

# Custom port and data directory
PORT=3000 DATA_DIR=/var/lib/labboard ./labboard

# Or with CLI flags
./labboard -host 0.0.0.0 -port 8080 -data-dir /var/lib/labboard
```

Open `http://127.0.0.1:8080` in your browser.

### Docker

```bash
docker run -d \
  --name labboard \
  -p 8080:8080 \
  -v $(pwd)/data:/data \
  -e HOST=0.0.0.0 \
  -e DATA_DIR=/data \
  labboard:latest
```

---

## ⚙️ Configuration

`labboard` loads configuration from `.env` files, environment variables, and CLI flags with the following precedence (highest to lowest):

1. **CLI flags** (`-host`, `-port`, `-data-dir`, `-db-name`, `-env`)
2. **Environment variables** (`HOST`, `PORT`, `DATA_DIR`, `DB_NAME`, `LABBOARD_ENV_FILE`)
3. **`.env` file** (automatically loaded from `.env` in the working directory if present)
4. **Defaults** (listed below)

### Configuration Options

| Option | Flag | Env Variable | Default | Description |
|---|---|---|---|---|
| Host | `-host` | `HOST` | `127.0.0.1` | Host interface to bind to (**safe local default**; set to `0.0.0.0` for LAN/Docker access) |
| Port | `-port` | `PORT` | `8080` | Port for the HTTP server to listen on |
| Data Directory | `-data-dir` | `DATA_DIR` | `./data` | Directory where SQLite database file is stored |
| Database Name | `-db-name` | `DB_NAME` | `labboard.db` | SQLite database file name |
| Env File | `-env` | `LABBOARD_ENV_FILE` | `.env` | Path to custom `.env` configuration file |

### Using `.env`

Copy the provided [.env.example](./.env.example) to `.env`:

```bash
cp .env.example .env
```

```env
HOST=127.0.0.1
PORT=8080
DATA_DIR=./data
DB_NAME=labboard.db
```

---

## 🛠️ Development

### Prerequisites

- [Go](https://go.dev/) (1.23+)
- [Node.js](https://nodejs.org/) (20+) and `npm`
- [Invincible](https://github.com/chris/invincible) (process runner for development)

### Directory Structure

```
labboard/
├── cmd/
│   └── labboard/       # Go application entrypoint
├── internal/
│   ├── api/            # HTTP handlers, router, and SPA server
│   ├── config/         # Configuration loading with .env support
│   ├── db/             # SQLite connection, migrations, and CRUD
│   └── models/         # Data structures
├── frontend/           # React + Vite application
│   ├── src/
│   │   ├── components/ # BoardsList, BoardEditor
│   │   ├── styles/     # One Dark Pro Night Flat theme
│   │   └── api/        # Backend API client
│   ├── package.json
│   └── vite.config.ts
├── .env.example        # Example environment configuration
├── .invincible.toml    # Development process orchestration
├── Dockerfile          # Multi-stage production container build
├── go.mod
├── go.sum
├── LICENSE
└── README.md
```

### Developing with Invincible

Invincible runs both the Go backend and Vite dev server concurrently, handling ports, rebuilds, and live-reloading:

```bash
invincible
```

Invincible manages:
1. **Frontend**: Vite dev server on an auto-assigned or designated port with HMR and API proxy.
2. **Backend**: Go API server watching for file changes.

### Building for Production

To produce the standalone single binary:

```bash
# 1. Build the React frontend
cd frontend
npm install
npm run build
cd ..

# 2. Build the Go binary with embedded assets
go build -ldflags="-s -w" -o labboard ./cmd/labboard
```

The resulting `labboard` binary is completely self-contained and ready to deploy.

---

## 📄 License

Licensed under the [MIT License](./LICENSE) (same as [Excalidraw](https://github.com/excalidraw/excalidraw/blob/master/LICENSE)).
