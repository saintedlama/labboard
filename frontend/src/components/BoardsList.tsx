import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { Moon, Pencil, Plus, Search, Sun, Trash2, X } from "lucide-react";
import {
  BoardSummary,
  createBoard,
  deleteBoard,
  listBoards,
  updateBoard,
} from "../api/boards";
import { AppTheme } from "../utils/theme";
import { ConfirmDialog } from "./ConfirmDialog";
import logoUrl from "../assets/logo.svg";
import { LibrarySection } from "./LibrarySection";

interface BoardsListProps {
  onOpenBoard: (id: string) => void;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
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

function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").replace(/,+$/, "").trim().toLowerCase();
}

export function BoardsList({ onOpenBoard, theme, onThemeChange }: BoardsListProps) {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Delete confirmation modal state
  const [deletingBoard, setDeletingBoard] = useState<BoardSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Edit modal state
  const [editingBoard, setEditingBoard] = useState<BoardSummary | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
    document.title = "LabBoard";
    void load();
  }, []);

  useEffect(() => {
    if (!editingBoard) return;
    const handleEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !savingEdit) {
        setEditingBoard(null);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("keydown", handleEsc);
    };
  }, [editingBoard, savingEdit]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const b of boards) {
      for (const t of b.tags) {
        tagSet.add(t);
      }
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [boards]);

  useEffect(() => {
    if (selectedTag && !allTags.includes(selectedTag)) {
      setSelectedTag(null);
    }
  }, [allTags, selectedTag]);

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

  const openDeleteConfirm = (board: BoardSummary) => {
    setDeleteError(null);
    setDeletingBoard(board);
  };

  const handleConfirmDelete = async () => {
    if (!deletingBoard) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      await deleteBoard(deletingBoard.id);
      setBoards((prev) => prev.filter((b) => b.id !== deletingBoard.id));
      setDeletingBoard(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete board");
    } finally {
      setDeleting(false);
    }
  };

  const openEditModal = (board: BoardSummary) => {
    setEditingBoard(board);
    setEditTitle(board.title);
    setEditTags(board.tags ?? []);
    setEditTagInput("");
    setEditError(null);
    setDeletingBoard(null);
  };

  const closeEditModal = () => {
    if (savingEdit) return;
    setEditingBoard(null);
  };

  const addEditTag = (rawValue?: string) => {
    const source = rawValue ?? editTagInput;
    const parts = source
      .split(",")
      .map(normalizeTag)
      .filter(Boolean);

    if (parts.length > 0) {
      setEditTags((prev) => {
        const next = [...prev];
        for (const tag of parts) {
          if (!next.includes(tag)) {
            next.push(tag);
          }
        }
        return next;
      });
    }
    setEditTagInput("");
  };

  const handleEditTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEditTag();
    } else if (e.key === "Backspace" && editTagInput === "" && editTags.length > 0) {
      setEditTags((prev) => prev.slice(0, -1));
    }
  };

  const handleRemoveEditTag = (tagToRemove: string) => {
    setEditTags((prev) => prev.filter((t) => t !== tagToRemove));
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingBoard) return;

    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) {
      setEditError("Board title cannot be empty.");
      return;
    }

    // Include any un-committed tag left in the tag input
    const pendingParts = editTagInput
      .split(",")
      .map(normalizeTag)
      .filter(Boolean);
    const finalTags = [...editTags];
    for (const tag of pendingParts) {
      if (!finalTags.includes(tag)) {
        finalTags.push(tag);
      }
    }

    try {
      setSavingEdit(true);
      setEditError(null);
      const updated = await updateBoard(editingBoard.id, {
        title: trimmedTitle,
        tags: finalTags,
      });
      setBoards((prev) =>
        prev.map((b) =>
          b.id === updated.id
            ? {
                id: updated.id,
                title: updated.title,
                tags: updated.tags ?? [],
                createdAt: updated.createdAt,
                updatedAt: updated.updatedAt,
              }
            : b
        )
      );
      setEditingBoard(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update board");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <img src={logoUrl} alt="" className="brand-logo" />
          </span>
          <h1 className="brand-title">LabBoard</h1>
        </div>

        <div className="topbar-actions">
          <div className="topbar-theme-toggle" role="group" aria-label="Color theme">
            <button
              type="button"
              className={`topbar-theme-btn ${theme === "dark" ? "active" : ""}`}
              aria-pressed={theme === "dark"}
              onClick={() => onThemeChange("dark")}
              title="Dark theme"
            >
              <Moon size={13} />
              <span>Dark</span>
            </button>
            <button
              type="button"
              className={`topbar-theme-btn ${theme === "light" ? "active" : ""}`}
              aria-pressed={theme === "light"}
              onClick={() => onThemeChange("light")}
              title="Light theme"
            >
              <Sun size={13} />
              <span>Light</span>
            </button>
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
        </div>
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
                      <span className="row-actions-group">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          aria-label={`Edit ${board.title}`}
                          title="Rename or edit tags"
                          onClick={() => openEditModal(board)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          aria-label={`Delete ${board.title}`}
                          title="Delete board"
                          onClick={() => openDeleteConfirm(board)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <LibrarySection theme={theme} />
      </main>

      {editingBoard && (
        <div
          className="modal-backdrop"
          onClick={closeEditModal}
          role="presentation"
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-board-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="edit-board-modal-title" className="modal-title">
                Edit Board
              </h2>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label="Close modal"
                onClick={closeEditModal}
                disabled={savingEdit}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit}>
              <div className="modal-body">
                {editError && <div className="error-banner">{editError}</div>}

                <div className="form-field">
                  <label htmlFor="edit-board-title" className="form-label">
                    Title
                  </label>
                  <input
                    id="edit-board-title"
                    type="text"
                    className="input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Board title..."
                    autoFocus
                    disabled={savingEdit}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="edit-board-tag-input" className="form-label">
                    Tags
                  </label>
                  <div className="modal-tags-list">
                    {editTags.length === 0 ? (
                      <span className="muted-text">No tags added yet.</span>
                    ) : (
                      editTags.map((tag) => (
                        <span key={tag} className="tag-pill modal-tag-pill">
                          #{tag}
                          <button
                            type="button"
                            className="modal-tag-remove"
                            aria-label={`Remove tag ${tag}`}
                            onClick={() => handleRemoveEditTag(tag)}
                            disabled={savingEdit}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                  <div className="modal-tag-add-row">
                    <input
                      id="edit-board-tag-input"
                      type="text"
                      className="input"
                      value={editTagInput}
                      onChange={(e) => setEditTagInput(e.target.value)}
                      onKeyDown={handleEditTagKeyDown}
                      placeholder="Add tag and press Enter..."
                      disabled={savingEdit}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => addEditTag()}
                      disabled={savingEdit || !normalizeTag(editTagInput)}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn"
                  onClick={closeEditModal}
                  disabled={savingEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingEdit}
                >
                  {savingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deletingBoard)}
        title="Delete Board"
        message={
          deletingBoard
            ? `Are you sure you want to delete "${deletingBoard.title || "Untitled Board"}"? This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        busy={deleting}
        busyLabel="Deleting..."
        error={deleteError}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!deleting) {
            setDeletingBoard(null);
            setDeleteError(null);
          }
        }}
      />
    </div>
  );
}
