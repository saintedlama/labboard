import { useEffect, useMemo, useState } from "react";
import { Layers, Plus, Search, Trash2, X } from "lucide-react";
import {
  BoardSummary,
  createBoard,
  deleteBoard,
  listBoards,
} from "../api/boards";

interface BoardsListProps {
  onOpenBoard: (id: string) => void;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatTimestamp(iso);
}

export function BoardsList({ onOpenBoard }: BoardsListProps) {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const data = await listBoards();
      setBoards(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load boards");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const b of boards) {
      for (const t of b.tags) {
        tagSet.add(t);
      }
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [boards]);

  const filteredBoards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return boards.filter((b) => {
      if (selectedTag && !b.tags.some((t) => t.toLowerCase() === selectedTag.toLowerCase())) {
        return false;
      }
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [boards, query, selectedTag]);

  const handleCreate = async () => {
    try {
      setCreating(true);
      setError(null);
      const created = await createBoard({
        title: "Untitled Board",
        tags: selectedTag ? [selectedTag] : [],
      });
      onOpenBoard(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create board");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setError(null);
      await deleteBoard(id);
      setBoards((prev) => prev.filter((b) => b.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete board");
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Layers size={20} />
          </span>
          <h1 className="brand-title">labboard</h1>
          <span className="brand-sub">self-hosted excalidraw</span>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCreate}
          disabled={creating}
        >
          <Plus size={16} />
          {creating ? "Creating..." : "New Board"}
        </button>
      </header>

      <main className="main-container">
        {error && <div className="error-banner">{error}</div>}

        <div className="toolbar">
          <div className="search-wrap">
            <span className="search-icon">
              <Search size={15} />
            </span>
            <input
              type="text"
              className="input search-input"
              placeholder="Filter boards by title or tag..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {allTags.length > 0 && (
            <div className="tag-filter-bar">
              <button
                type="button"
                className={`tag-pill tag-pill-neutral ${selectedTag === null ? "active" : ""}`}
                onClick={() => setSelectedTag(null)}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`tag-pill ${selectedTag === tag ? "active" : ""}`}
                  onClick={() =>
                    setSelectedTag((curr) => (curr === tag ? null : tag))
                  }
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="boards-card">
          {loading ? (
            <div className="empty-state">
              <p>Loading boards...</p>
            </div>
          ) : filteredBoards.length === 0 ? (
            <div className="empty-state">
              <p>
                {boards.length === 0
                  ? "No boards yet."
                  : "No boards match your filter."}
              </p>
              {boards.length === 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCreate}
                  disabled={creating}
                >
                  <Plus size={16} />
                  Create your first board
                </button>
              )}
            </div>
          ) : (
            <table className="boards-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Tags</th>
                  <th className="col-created">Created</th>
                  <th>Updated</th>
                  <th className="actions-cell">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredBoards.map((board) => (
                  <tr
                    key={board.id}
                    onClick={() => onOpenBoard(board.id)}
                  >
                    <td className="board-title-cell">{board.title}</td>
                    <td>
                      <div className="board-tags-cell">
                        {board.tags.length === 0 ? (
                          <span className="muted-text">—</span>
                        ) : (
                          board.tags.map((tag) => (
                            <span
                              key={tag}
                              className="tag-pill"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTag((curr) =>
                                  curr === tag ? null : tag
                                );
                              }}
                            >
                              #{tag}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td
                      className="muted-text col-created"
                      title={formatTimestamp(board.createdAt)}
                    >
                      {formatTimestamp(board.createdAt)}
                    </td>
                    <td
                      className="muted-text"
                      title={formatTimestamp(board.updatedAt)}
                    >
                      {formatRelative(board.updatedAt)}
                    </td>
                    <td
                      className="actions-cell"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {confirmDeleteId === board.id ? (
                        <span style={{ display: "inline-flex", gap: 4 }}>
                          <button
                            type="button"
                            className="btn btn-danger-confirm"
                            onClick={() => handleDelete(board.id)}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            aria-label="Cancel delete"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            <X size={14} />
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-danger-ghost"
                          aria-label={`Delete ${board.title}`}
                          onClick={() => setConfirmDeleteId(board.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
