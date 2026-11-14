import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent } from "react";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { ArrowLeft, Check, Loader2, AlertCircle, X } from "lucide-react";
import { Board, BoardData, getBoard, updateBoard } from "../api/boards";

type ExcalidrawProps = ComponentProps<typeof Excalidraw>;
type OnChangeParams = Parameters<NonNullable<ExcalidrawProps["onChange"]>>;
type InitialData = Exclude<ExcalidrawProps["initialData"], (() => unknown) | Promise<unknown> | undefined>;

interface BoardEditorProps {
  boardId: string;
  onBack: () => void;
}

type SaveStatus = "saved" | "dirty" | "saving" | "error";

export function BoardEditor({ boardId, onBack }: BoardEditorProps) {
  const [board, setBoard] = useState<Board | null>(null);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  const initializedRef = useRef(false);
  const lastSavedJsonRef = useRef<string>("");
  const pendingJsonRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const lastSavedTitleRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    initializedRef.current = false;
    lastSavedJsonRef.current = "";
    pendingJsonRef.current = null;
    setLoading(true);
    setLoadError(null);
    setSaveStatus("saved");

    getBoard(boardId)
      .then((loaded) => {
        if (cancelled) return;
        setBoard(loaded);
        setTitle(loaded.title);
        lastSavedTitleRef.current = loaded.title;
        setTags(loaded.tags ?? []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load board");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [boardId]);

  const persistScene = useCallback(
    async (serializedJson: string, keepalive = false) => {
      setSaveStatus("saving");
      try {
        const parsed = JSON.parse(serializedJson) as BoardData;
        await updateBoard(
          boardId,
          {
            data: {
              elements: parsed.elements ?? [],
              appState: parsed.appState ?? {},
              files: parsed.files ?? {},
            },
          },
          { keepalive }
        );
        lastSavedJsonRef.current = serializedJson;
        if (pendingJsonRef.current === serializedJson) {
          pendingJsonRef.current = null;
          setSaveStatus("saved");
        }
      } catch {
        setSaveStatus("error");
      }
    },
    [boardId]
  );

  const flushPendingSave = useCallback(
    async (keepalive = false) => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (pendingJsonRef.current !== null) {
        await persistScene(pendingJsonRef.current, keepalive);
      }
    },
    [persistScene]
  );

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pendingJsonRef.current !== null) {
        void flushPendingSave(true);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [flushPendingSave]);

  const handleSceneChange = useCallback(
    (
      elements: OnChangeParams[0],
      appState: OnChangeParams[1],
      files: OnChangeParams[2]
    ) => {
      const serialized = serializeAsJSON(elements, appState, files, "database");

      if (!initializedRef.current) {
        initializedRef.current = true;
        lastSavedJsonRef.current = serialized;
        return;
      }

      if (serialized === lastSavedJsonRef.current) {
        return;
      }

      pendingJsonRef.current = serialized;
      setSaveStatus("dirty");

      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        if (pendingJsonRef.current !== null) {
          void persistScene(pendingJsonRef.current);
        }
      }, 700);
    },
    [persistScene]
  );

  const commitTitle = async () => {
    const trimmed = title.trim() || "Untitled Board";
    setTitle(trimmed);
    if (trimmed === lastSavedTitleRef.current) return;

    setSaveStatus("saving");
    try {
      await updateBoard(boardId, { title: trimmed });
      lastSavedTitleRef.current = trimmed;
      setSaveStatus(pendingJsonRef.current ? "dirty" : "saved");
    } catch {
      setSaveStatus("error");
    }
  };

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    }
  };

  const updateTags = async (nextTags: string[]) => {
    setTags(nextTags);
    setSaveStatus("saving");
    try {
      const updated = await updateBoard(boardId, { tags: nextTags });
      setTags(updated.tags);
      setSaveStatus(pendingJsonRef.current ? "dirty" : "saved");
    } catch {
      setSaveStatus("error");
    }
  };

  const handleAddTag = () => {
    const cleaned = tagInput.trim().replace(/^#/, "");
    setTagInput("");
    if (!cleaned) return;
    if (tags.some((t) => t.toLowerCase() === cleaned.toLowerCase())) return;
    void updateTags([...tags, cleaned]);
  };

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    void updateTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleBackClick = async () => {
    await flushPendingSave();
    if (title.trim() !== lastSavedTitleRef.current) {
      await commitTitle();
    }
    onBack();
  };

  if (loading) {
    return (
      <div className="app-shell">
        <div className="empty-state">
          <p>Loading board...</p>
        </div>
      </div>
    );
  }

  if (loadError || !board) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            <ArrowLeft size={16} />
            Boards
          </button>
        </header>
        <main className="main-container">
          <div className="error-banner">{loadError ?? "Board not found"}</div>
        </main>
      </div>
    );
  }

  const initialData: InitialData = {
    elements: (board.data?.elements ?? []) as NonNullable<InitialData>["elements"],
    appState: {
      theme: "dark",
      ...(board.data?.appState ?? {}),
    } as NonNullable<InitialData>["appState"],
    files: (board.data?.files ?? {}) as NonNullable<InitialData>["files"],
  };

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <div className="editor-left">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleBackClick}
            title="Back to boards"
          >
            <ArrowLeft size={16} />
            Boards
          </button>

          <input
            type="text"
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={handleTitleKeyDown}
            aria-label="Board title"
          />

          <div className="editor-tags">
            {tags.map((tag) => (
              <span key={tag} className="editor-tag-chip">
                #{tag}
                <button
                  type="button"
                  className="editor-tag-remove"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => handleRemoveTag(tag)}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <input
              type="text"
              className="tag-add-input"
              placeholder="+ tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={handleAddTag}
              aria-label="Add tag"
            />
          </div>
        </div>

        <div className="editor-right">
          <span
            className={`save-status ${saveStatus}`}
            onClick={() => {
              if (saveStatus === "error" && pendingJsonRef.current) {
                void persistScene(pendingJsonRef.current);
              }
            }}
            style={saveStatus === "error" ? { cursor: "pointer" } : undefined}
          >
            {saveStatus === "saved" && (
              <>
                <Check size={13} />
                Saved
              </>
            )}
            {saveStatus === "dirty" && <>Unsaved</>}
            {saveStatus === "saving" && (
              <>
                <Loader2 size={13} />
                Saving...
              </>
            )}
            {saveStatus === "error" && (
              <>
                <AlertCircle size={13} />
                Retry save
              </>
            )}
          </span>
        </div>
      </header>

      <div className="editor-canvas-wrap">
        <Excalidraw
          key={board.id}
          initialData={initialData}
          onChange={handleSceneChange}
          UIOptions={{
            canvasActions: {
              toggleTheme: true,
            },
          }}
        />
      </div>
    </div>
  );
}
