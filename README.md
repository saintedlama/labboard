# labboard

A self-hosted, lightweight [Excalidraw](https://excalidraw.com) workspace designed for your homelab. `labboard` combines the official `@excalidraw/excalidraw` React component on the frontend with event-driven persistence to a Go backend with an embedded SQLite database — packaged into a single, dependency-free binary.

**No authentication. No cloud telemetry. No fluff.**

---

## 🎨 Design & Palette: One Dark Pro Night Flat

`labboard` adopts the **One Dark Pro Night Flat** color scheme ([VSCode Themes reference](https://vscodethemes.com/e/zhuangtongfa.Material-theme/one-dark-pro-night-flat)) across both the application chrome and the Excalidraw drawing canvas.

### Color Swatches & Tokens

#### Surfaces & Backgrounds

| Token | Hex | Role |
|---|---|---|
| `bg-canvas` | `#16191d` | Canvas background, overall window background |
| `bg-surface` | `#1e2227` | Cards, panels, sidebars, modal overlays |
| `bg-input` | `#1d1f23` | Search bars, text inputs, dropdown fields |
| `bg-active` | `#23272e` | Selected items, active navigation buttons |
| `bg-hover` | `#2c313a` | Hovered list rows, button hover states |
| `bg-focus` | `#323842` | Focused element background highlight |

#### Borders & Dividers

| Token | Hex | Role |
|---|---|---|
| `border-subtle` | `#181a1f` | Inset dividers, subtle list borders |
| `border-default` | `#37393d` | Standard card and panel borders |
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
└─────────────────────────────────────────────┼───────────────┘
                                              ▼
                                   ┌─────────────────────┐
                                   │ SQLite DB (WAL Mode)│
                                   │    labboard.db      │
                                   └─────────────────────┘
```

- **Single Binary**: Frontend assets are compiled into static files and embedded directly into the Go executable via `embed.FS`.
- **Zero Configuration**: Starts immediately with local defaults; persistence just works via SQLite.
- **Auto-Save Engine**: Excalidraw change events are debounced and synchronized seamlessly to the backend with save status tracking.
- **REST API**:
  - `GET /api/boards` — List boards (id, title, tags, createdAt, updatedAt)
  - `POST /api/boards` — Create a new board
  - `GET /api/boards/:id` — Get board metadata and full Excalidraw scene data
  - `PUT /api/boards/:id` — Update board title, tags, or scene elements/state
  - `DELETE /api/boards/:id` — Delete a board
  - `GET /api/library` — Get shared Excalidraw library items
  - `PUT /api/library` — Save/update shared Excalidraw library items

---

## 🚀 Quick Start

### Running with Docker

Run `labboard` using Docker with SQLite data persisted in a named volume or local directory:

```bash
docker run -d \
  --name labboard \
  -p 8080:8080 \
  -v labboard-data:/data \
  ghcr.io/saintedlama/labboard:latest
```

Open `http://localhost:8080` in your browser.

### Docker Compose

```yaml
services:
  labboard:
    image: ghcr.io/saintedlama/labboard:latest
    container_name: labboard
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    environment:
      - HOST=0.0.0.0
      - PORT=8080
      - DATA_DIR=/data
      - DB_NAME=labboard.db
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
- [Node.js](https://nodejs.org/) (20+) with [Corepack](https://nodejs.org/api/corepack.html) and `pnpm`
- [Invincible](https://github.com/chris/invincible) (process runner for development)

Enable Corepack:
```bash
corepack enable
```

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
├── frontend/           # React + Vite application (managed with pnpm via Corepack)
│   ├── src/
│   │   ├── components/ # BoardsList, BoardEditor
│   │   ├── styles/     # One Dark Pro Night Flat theme
│   │   └── api/        # Backend API client
│   ├── package.json
│   ├── pnpm-lock.yaml
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
1. **Frontend**: Vite dev server managed with `corepack pnpm dev` on an auto-assigned or designated port with HMR and API proxy.
2. **Backend**: Go API server watching for file changes.

### Building for Production

To produce the standalone single binary:

```bash
# 1. Build the React frontend with pnpm (via Corepack)
cd frontend
corepack enable
pnpm install
pnpm run build
cd ..

# 2. Build the Go binary with embedded assets
go build -ldflags="-s -w" -o labboard ./cmd/labboard
```

The resulting `labboard` binary is completely self-contained and ready to deploy.

---

## 📄 License

Licensed under the [MIT License](./LICENSE) (same as [Excalidraw](https://github.com/excalidraw/excalidraw/blob/master/LICENSE)).
