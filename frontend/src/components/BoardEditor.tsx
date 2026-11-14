import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent } from "react";
import {
  CommandPalette,
  Excalidraw,
  THEME,
  applyDarkModeFilter,
  parseLibraryTokensFromUrl,
  serializeAsJSON,
  useHandleLibrary,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Coffee,
  Crosshair,
  Eye,
  Grid3x3,
  HelpCircle,
  ImageDown,
  Link,
  Link2,
  Loader2,
  Magnet,
  Menu,
  Moon,
  Pipette,
  RotateCcw,
  Search,
  Sun,
  Terminal,
  Trash,
  X,
} from "lucide-react";
import { Board, BoardData, getBoard, updateBoard, deleteBoard } from "../api/boards";
import {
  fetchAndTagLibraryFromUrl,
  getLibrary,
  LibraryItemData,
  mergeAndTagLibraryItems,
  saveLibrary,
  stripAddLibraryUrlParams,
} from "../api/library";
import { ConfirmDialog } from "./ConfirmDialog";

type ExcalidrawProps = ComponentProps<typeof Excalidraw>;
type ExcalidrawAPI = Parameters<NonNullable<ExcalidrawProps["onExcalidrawAPI"]>>[0];
type ExcalidrawLibraryItems = Awaited<ReturnType<NonNullable<ExcalidrawAPI>["updateLibrary"]>>;
type OnChangeParams = Parameters<NonNullable<ExcalidrawProps["onChange"]>>;
type InitialData = Exclude<ExcalidrawProps["initialData"], (() => unknown) | Promise<unknown> | undefined>;

interface BoardEditorProps {
  boardId: string;
  onBack: () => void;
}

type SaveStatus = "saved" | "dirty" | "saving" | "error";
type CanvasTheme = "dark" | "light";

interface EditorPreferences {
  gridModeEnabled: boolean;
  zenModeEnabled: boolean;
  viewModeEnabled: boolean;
  bindingPreference: "enabled" | "disabled";
  objectsSnapModeEnabled: boolean;
  isMidpointSnappingEnabled: boolean;
}

const PREFS_STORAGE_KEY = "labboard_preferences";

const CANVAS_BACKGROUND_PICKS = [
  { color: "#ffffff", label: "Default" },
  { color: "#f8f9fa", label: "Slate" },
  { color: "#f5faff", label: "Blue" },
  { color: "#fffce8", label: "Yellow" },
  { color: "#fdf8f6", label: "Warm" },
] as const;

function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").replace(/,+$/, "").trim().toLowerCase();
}

function readStoredPreferences(): Omit<EditorPreferences, "gridModeEnabled" | "viewModeEnabled"> {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<EditorPreferences>;
      return {
        zenModeEnabled: Boolean(parsed.zenModeEnabled),
        bindingPreference: parsed.bindingPreference === "disabled" ? "disabled" : "enabled",
        objectsSnapModeEnabled: Boolean(parsed.objectsSnapModeEnabled),
        isMidpointSnappingEnabled:
          typeof parsed.isMidpointSnappingEnabled === "boolean"
            ? parsed.isMidpointSnappingEnabled
            : true,
      };
    }
  } catch {
    // ignore storage read errors
  }
  return {
    zenModeEnabled: false,
    bindingPreference: "enabled",
    objectsSnapModeEnabled: false,
    isMidpointSnappingEnabled: true,
  };
}

function writeStoredPreferences(prefs: EditorPreferences): void {
  try {
    localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({
        zenModeEnabled: prefs.zenModeEnabled,
        bindingPreference: prefs.bindingPreference,
        objectsSnapModeEnabled: prefs.objectsSnapModeEnabled,
        isMidpointSnappingEnabled: prefs.isMidpointSnappingEnabled,
      })
    );
  } catch {
    // ignore storage write errors
  }
}

export function BoardEditor({ boardId, onBack }: BoardEditorProps) {
  const [board, setBoard] = useState<Board | null>(null);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawAPI>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<"deleteBoard" | "resetCanvas" | null>(null);
  const [deletingBoard, setDeletingBoard] = useState(false);
  const [deleteBoardError, setDeleteBoardError] = useState<string | null>(null);
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>(() => {
    try {
      return localStorage.getItem("labboard_theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [canvasBg, setCanvasBg] = useState<string>("#ffffff");
  const [preferences, setPreferences] = useState<EditorPreferences>(() => {
    const stored = readStoredPreferences();
    return {
      gridModeEnabled: false,
      viewModeEnabled: false,
      ...stored,
    };
  });

  const menuRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const lastSavedJsonRef = useRef<string>("");
  const pendingJsonRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const lastSavedTitleRef = useRef<string>("");
  const titleRef = useRef<string>("");

  titleRef.current = title;

  // Update browser document title to reflect board title
  useEffect(() => {
    const currentTitle = title.trim();
    document.title = currentTitle ? `${currentTitle} — labboard` : "Untitled Board — labboard";
  }, [title]);

  useEffect(() => {
    return () => {
      document.title = "labboard";
    };
  }, []);

  // Shared persistence adapter for Excalidraw libraries (backend SQLite + localStorage fallback)
  const libraryAdapter = useMemo(
    () => ({
      load: async () => {
        try {
          return await getLibrary();
        } catch {
          try {
            const local = localStorage.getItem("labboard_library");
            return local ? JSON.parse(local) : null;
          } catch {
            return null;
          }
        }
      },
      save: async (libraryData: { libraryItems: readonly unknown[] }) => {
        try {
          await saveLibrary([...libraryData.libraryItems] as LibraryItemData[]);
        } catch {
          try {
            localStorage.setItem("labboard_library", JSON.stringify(libraryData));
          } catch {
            // ignore
          }
        }
      },
    }),
    []
  );

  // Intercept #addLibrary=... / ?addLibrary=... BEFORE useHandleLibrary so imported items
  // are automatically tagged with their sourceSet & sourceUrl without duplicate prompts.
  useEffect(() => {
    if (!excalidrawAPI) return;
    let cancelled = false;

    const importTaggedLibraryFromUrl = async ({
      libraryUrl,
      idToken,
    }: {
      libraryUrl: string;
      idToken: string | null;
    }) => {
      try {
        stripAddLibraryUrlParams();
        const shouldPrompt = idToken !== excalidrawAPI.id;
        if (shouldPrompt && document.hidden) {
          await new Promise<void>((resolve) => {
            window.addEventListener("focus", () => resolve(), { once: true });
          });
        }
        if (cancelled) return;

        const { items: taggedItems, setName } = await fetchAndTagLibraryFromUrl(libraryUrl);
        if (cancelled || taggedItems.length === 0) return;

        if (shouldPrompt) {
          const shapeWord = taggedItems.length === 1 ? "shape" : "shapes";
          const confirmed = window.confirm(
            `Add ${taggedItems.length} ${shapeWord} from "${setName}" to library?`
          );
          if (!confirmed) return;
        }

        await excalidrawAPI.updateLibrary({
          openLibraryMenu: true,
          merge: false,
          prompt: false,
          defaultStatus: "published",
          libraryItems: async (currentItems) => {
            const merged = mergeAndTagLibraryItems(
              currentItems as unknown as readonly LibraryItemData[],
              taggedItems
            );
            if (merged.backfilledCount > 0) {
              try {
                await saveLibrary(merged.items);
              } catch {
                try {
                  localStorage.setItem(
                    "labboard_library",
                    JSON.stringify({ libraryItems: merged.items })
                  );
                } catch {
                  // ignore storage errors
                }
              }
            }
            return merged.items as unknown as ExcalidrawLibraryItems;
          },
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to import library";
        excalidrawAPI.updateScene({
          appState: {
            errorMessage: message,
          },
        });
      }
    };

    const initialTokens = parseLibraryTokensFromUrl();
    if (initialTokens) {
      stripAddLibraryUrlParams();
      void importTaggedLibraryFromUrl(initialTokens);
    }

    const onHashChange = (event: HashChangeEvent) => {
      const tokens = parseLibraryTokensFromUrl();
      if (!tokens) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stripAddLibraryUrlParams();
      void importTaggedLibraryFromUrl(tokens);
    };

    window.addEventListener("hashchange", onHashChange, { capture: true });
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange, { capture: true });
    };
  }, [excalidrawAPI]);

  // Hook up official Excalidraw library persistence (load/save via libraryAdapter)
  useHandleLibrary({
    excalidrawAPI,
    adapter: libraryAdapter,
  });

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
        titleRef.current = loaded.title;
        lastSavedTitleRef.current = loaded.title;
        setTags(loaded.tags ?? []);

        const loadedTheme = loaded.data?.appState?.theme;
        if (loadedTheme === "light" || loadedTheme === "dark") {
          setCanvasTheme(loadedTheme);
        }
        const loadedBg = loaded.data?.appState?.viewBackgroundColor;
        setCanvasBg(typeof loadedBg === "string" && loadedBg ? loadedBg : "#ffffff");

        const storedPrefs = readStoredPreferences();
        const initialGrid = Boolean(loaded.data?.appState?.gridModeEnabled);
        setPreferences({
          gridModeEnabled: initialGrid,
          zenModeEnabled: storedPrefs.zenModeEnabled,
          viewModeEnabled: false,
          bindingPreference: storedPrefs.bindingPreference,
          objectsSnapModeEnabled: initialGrid ? false : storedPrefs.objectsSnapModeEnabled,
          isMidpointSnappingEnabled: storedPrefs.isMidpointSnappingEnabled,
        });

        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load board");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [boardId]);

  const persistScene = useCallback(
    async (jsonString: string, keepalive = false) => {
      if (!board) return;
      try {
        setSaveStatus("saving");
        const parsed = JSON.parse(jsonString) as BoardData;
        await updateBoard(
          board.id,
          {
            data: parsed,
          },
          { keepalive }
        );
        lastSavedJsonRef.current = jsonString;
        pendingJsonRef.current = null;
        setSaveStatus("saved");
      } catch (err) {
        console.error("Failed to persist board:", err);
        setSaveStatus("error");
      }
    },
    [board]
  );

  const scheduleSave = useCallback(
    (jsonString: string) => {
      pendingJsonRef.current = jsonString;
      setSaveStatus("dirty");

      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        void persistScene(jsonString);
      }, 800);
    },
    [persistScene]
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

  const commitTitle = useCallback(
    async (overrideTitle?: string) => {
      if (!board) return;
      const trimmed = (overrideTitle ?? titleRef.current).trim();
      if (!trimmed) {
        setTitle(lastSavedTitleRef.current);
        titleRef.current = lastSavedTitleRef.current;
        return;
      }
      if (trimmed === lastSavedTitleRef.current) return;

      try {
        setSaveStatus("saving");
        const updated = await updateBoard(board.id, { title: trimmed });
        setBoard(updated);
        setTitle(updated.title);
        titleRef.current = updated.title;
        lastSavedTitleRef.current = updated.title;
        setSaveStatus("saved");
      } catch (err) {
        console.error("Failed to update title:", err);
        setSaveStatus("error");
      }
    },
    [board]
  );

  // Close custom dropdown when clicking outside (and commit any pending title edit)
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        void commitTitle();
        setMenuOpen(false);
      }
    };
    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        void commitTitle();
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen, commitTitle]);

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
    (...args: OnChangeParams) => {
      const [elements, appState, files] = args;
      if (!board) return;

      if (appState.theme === THEME.DARK || appState.theme === THEME.LIGHT) {
        setCanvasTheme((prev) => {
          if (prev !== appState.theme) {
            try {
              localStorage.setItem("labboard_theme", appState.theme);
            } catch {
              // ignore
            }
            return appState.theme;
          }
          return prev;
        });
      }

      if (typeof appState.viewBackgroundColor === "string" && appState.viewBackgroundColor) {
        setCanvasBg((prev) =>
          prev !== appState.viewBackgroundColor ? appState.viewBackgroundColor : prev
        );
      }

      const nextPrefs: EditorPreferences = {
        gridModeEnabled: Boolean(appState.gridModeEnabled),
        zenModeEnabled: Boolean(appState.zenModeEnabled),
        viewModeEnabled: Boolean(appState.viewModeEnabled),
        bindingPreference:
          appState.bindingPreference === "disabled" ? "disabled" : "enabled",
        objectsSnapModeEnabled: Boolean(appState.objectsSnapModeEnabled),
        isMidpointSnappingEnabled: Boolean(appState.isMidpointSnappingEnabled),
      };

      setPreferences((prev) => {
        if (
          prev.gridModeEnabled === nextPrefs.gridModeEnabled &&
          prev.zenModeEnabled === nextPrefs.zenModeEnabled &&
          prev.viewModeEnabled === nextPrefs.viewModeEnabled &&
          prev.bindingPreference === nextPrefs.bindingPreference &&
          prev.objectsSnapModeEnabled === nextPrefs.objectsSnapModeEnabled &&
          prev.isMidpointSnappingEnabled === nextPrefs.isMidpointSnappingEnabled
        ) {
          return prev;
        }
        writeStoredPreferences(nextPrefs);
        return nextPrefs;
      });

      const serialized = serializeAsJSON(elements, appState, files, "database");

      if (!initializedRef.current) {
        initializedRef.current = true;
        lastSavedJsonRef.current = serialized;
        return;
      }

      if (serialized === lastSavedJsonRef.current) {
        return;
      }

      scheduleSave(serialized);
    },
    [board, scheduleSave]
  );

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitTitle(e.currentTarget.value);
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setTitle(lastSavedTitleRef.current);
      titleRef.current = lastSavedTitleRef.current;
      e.currentTarget.blur();
    }
  };

  const handleAddTag = async (rawValue?: string) => {
    if (!board) return;
    const source = rawValue ?? tagInput;
    const parts = source
      .split(",")
      .map(normalizeTag)
      .filter(Boolean);

    if (parts.length === 0) {
      setTagInput("");
      return;
    }

    const nextTags = [...tags];
    let added = false;
    for (const part of parts) {
      if (!nextTags.includes(part)) {
        nextTags.push(part);
        added = true;
      }
    }

    setTagInput("");
    if (!added) return;

    try {
      const updated = await updateBoard(board.id, { tags: nextTags });
      setBoard(updated);
      setTags(updated.tags ?? nextTags);
    } catch (err) {
      console.error("Failed to add tag:", err);
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!board) return;
    const nextTags = tags.filter((t) => t !== tagToRemove);
    try {
      const updated = await updateBoard(board.id, { tags: nextTags });
      setBoard(updated);
      setTags(updated.tags ?? nextTags);
    } catch (err) {
      console.error("Failed to remove tag:", err);
    }
  };

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      void handleAddTag(e.currentTarget.value);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setTagInput("");
      e.currentTarget.blur();
    }
  };

  const handleBackClick = async () => {
    await commitTitle();
    await flushPendingSave();
    onBack();
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleExportImage = () => {
    void commitTitle();
    setMenuOpen(false);
    excalidrawAPI?.updateScene({
      appState: {
        openDialog: { name: "imageExport" },
      },
    });
  };

  const handleFindOnCanvas = () => {
    void commitTitle();
    setMenuOpen(false);
    excalidrawAPI?.updateScene({
      appState: {
        openDialog: null,
      },
    });
    excalidrawAPI?.toggleSidebar({
      name: "default",
      tab: "search",
      force: true,
    });
  };

  const handleCommandPalette = () => {
    void commitTitle();
    setMenuOpen(false);
    excalidrawAPI?.updateScene({
      appState: {
        openDialog: { name: "commandPalette" },
      },
    });
  };

  const handleHelp = () => {
    void commitTitle();
    setMenuOpen(false);
    excalidrawAPI?.updateScene({
      appState: {
        openDialog: { name: "help" },
      },
    });
  };

  const handleSetTheme = (nextTheme: CanvasTheme) => {
    setCanvasTheme(nextTheme);
    try {
      localStorage.setItem("labboard_theme", nextTheme);
    } catch {
      // ignore
    }
    excalidrawAPI?.updateScene({
      appState: {
        theme: nextTheme,
      },
    });
  };

  const handleSetCanvasBg = (color: string) => {
    setCanvasBg(color);
    excalidrawAPI?.updateScene({
      appState: {
        viewBackgroundColor: color,
      },
    });
  };

  const handleToggleGrid = () => {
    const next = !preferences.gridModeEnabled;
    const nextPrefs: EditorPreferences = {
      ...preferences,
      gridModeEnabled: next,
      objectsSnapModeEnabled: false,
    };
    setPreferences(nextPrefs);
    writeStoredPreferences(nextPrefs);
    excalidrawAPI?.updateScene({
      appState: {
        gridModeEnabled: next,
        objectsSnapModeEnabled: false,
      },
    });
  };

  const handleToggleZenMode = () => {
    const next = !preferences.zenModeEnabled;
    const nextPrefs: EditorPreferences = {
      ...preferences,
      zenModeEnabled: next,
    };
    setPreferences(nextPrefs);
    writeStoredPreferences(nextPrefs);
    excalidrawAPI?.updateScene({
      appState: {
        zenModeEnabled: next,
      },
    });
  };

  const handleToggleViewMode = () => {
    const next = !preferences.viewModeEnabled;
    const nextPrefs: EditorPreferences = {
      ...preferences,
      viewModeEnabled: next,
    };
    setPreferences(nextPrefs);
    excalidrawAPI?.updateScene({
      appState: {
        viewModeEnabled: next,
      },
    });
  };

  const handleToggleArrowBinding = () => {
    const nextPref =
      preferences.bindingPreference === "enabled" ? "disabled" : "enabled";
    const nextPrefs: EditorPreferences = {
      ...preferences,
      bindingPreference: nextPref,
    };
    setPreferences(nextPrefs);
    writeStoredPreferences(nextPrefs);
    excalidrawAPI?.updateScene({
      appState: {
        bindingPreference: nextPref,
        isBindingEnabled: nextPref === "enabled",
      },
    });
  };

  const handleToggleObjectsSnap = () => {
    const next = !preferences.objectsSnapModeEnabled;
    const nextPrefs: EditorPreferences = {
      ...preferences,
      objectsSnapModeEnabled: next,
      gridModeEnabled: false,
    };
    setPreferences(nextPrefs);
    writeStoredPreferences(nextPrefs);
    excalidrawAPI?.updateScene({
      appState: {
        objectsSnapModeEnabled: next,
        gridModeEnabled: false,
      },
    });
  };

  const handleToggleMidpointSnapping = () => {
    const next = !preferences.isMidpointSnappingEnabled;
    const nextPrefs: EditorPreferences = {
      ...preferences,
      isMidpointSnappingEnabled: next,
    };
    setPreferences(nextPrefs);
    writeStoredPreferences(nextPrefs);
    excalidrawAPI?.updateScene({
      appState: {
        isMidpointSnappingEnabled: next,
      },
    });
  };

  const handleResetCanvas = () => {
    void commitTitle();
    setMenuOpen(false);
    setDeleteBoardError(null);
    setConfirmDialog("resetCanvas");
  };

  const handleDeleteBoard = () => {
    if (!board) return;
    void commitTitle();
    setMenuOpen(false);
    setDeleteBoardError(null);
    setConfirmDialog("deleteBoard");
  };

  const handleConfirmModalAction = async () => {
    if (confirmDialog === "resetCanvas") {
      excalidrawAPI?.resetScene();
      setConfirmDialog(null);
      return;
    }

    if (confirmDialog === "deleteBoard" && board) {
      try {
        setDeletingBoard(true);
        setDeleteBoardError(null);
        await deleteBoard(board.id);
        setConfirmDialog(null);
        onBack();
      } catch (err) {
        setDeleteBoardError(err instanceof Error ? err.message : "Failed to delete board");
      } finally {
        setDeletingBoard(false);
      }
    }
  };

  if (loading) {
    return (
      <div className="editor-loading">
        <Loader2 className="spin" size={28} />
        <p>Loading board...</p>
      </div>
    );
  }

  if (loadError || !board) {
    return (
      <div className="editor-error">
        <h2>Failed to open board</h2>
        <p>{loadError ?? "Board not found"}</p>
        <button type="button" className="btn btn-primary" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to boards
        </button>
      </div>
    );
  }

  const initialData: InitialData = {
    elements: (board.data?.elements ?? []) as NonNullable<InitialData>["elements"],
    appState: {
      theme: canvasTheme,
      ...(board.data?.appState ?? {}),
      gridModeEnabled: preferences.gridModeEnabled,
      zenModeEnabled: preferences.zenModeEnabled,
      viewModeEnabled: preferences.viewModeEnabled,
      bindingPreference: preferences.bindingPreference,
      isBindingEnabled: preferences.bindingPreference === "enabled",
      objectsSnapModeEnabled: preferences.objectsSnapModeEnabled,
      isMidpointSnappingEnabled: preferences.isMidpointSnappingEnabled,
    } as NonNullable<InitialData>["appState"],
    files: (board.data?.files ?? {}) as NonNullable<InitialData>["files"],
  };

  const isCustomBg = !CANVAS_BACKGROUND_PICKS.some(
    (pick) => pick.color.toLowerCase() === canvasBg.toLowerCase()
  );

  return (
    <div className="editor-shell">
      {/* 100% Full-Viewport Canvas */}
      <div className="editor-canvas-wrap">
        <Excalidraw
          key={board.id}
          onExcalidrawAPI={(api) => setExcalidrawAPI(api)}
          initialData={initialData}
          onChange={handleSceneChange}
          UIOptions={{
            canvasActions: {
              toggleTheme: true,
            },
          }}
          renderTopLeftUI={() => (
            <div className="editor-floating-bar" role="toolbar" aria-label="Board controls">
              {/* Custom Menu Dropdown substituting Excalidraw's top-left menu */}
              <div className="floating-menu-wrap" ref={menuRef}>
                <button
                  type="button"
                  className={`btn-floating-menu ${menuOpen ? "active" : ""}`}
                  onClick={() => {
                    if (menuOpen) {
                      void commitTitle();
                    } else if (excalidrawAPI) {
                      const appState = excalidrawAPI.getAppState();
                      if (appState.theme === THEME.DARK || appState.theme === THEME.LIGHT) {
                        setCanvasTheme(appState.theme);
                      }
                      if (typeof appState.viewBackgroundColor === "string" && appState.viewBackgroundColor) {
                        setCanvasBg(appState.viewBackgroundColor);
                      }
                      setPreferences({
                        gridModeEnabled: Boolean(appState.gridModeEnabled),
                        zenModeEnabled: Boolean(appState.zenModeEnabled),
                        viewModeEnabled: Boolean(appState.viewModeEnabled),
                        bindingPreference:
                          appState.bindingPreference === "disabled" ? "disabled" : "enabled",
                        objectsSnapModeEnabled: Boolean(appState.objectsSnapModeEnabled),
                        isMidpointSnappingEnabled: Boolean(appState.isMidpointSnappingEnabled),
                      });
                    }
                    setMenuOpen((prev) => !prev);
                  }}
                  title="Board menu"
                  aria-label="Board menu"
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                >
                  <Menu size={16} />
                </button>

                {menuOpen && (
                  <div
                    className="custom-top-dropdown"
                    role="menu"
                    onKeyDown={(e) => {
                      if (e.key !== "Escape") {
                        e.stopPropagation();
                      }
                    }}
                  >
                    <div className="dropdown-top-action-bar">
                      <button
                        type="button"
                        className="custom-dropdown-item dropdown-back-btn"
                        role="menuitem"
                        title="Back to Boards"
                        onClick={() => {
                          setMenuOpen(false);
                          void handleBackClick();
                        }}
                      >
                        <ArrowLeft size={14} />
                        <span>Boards</span>
                      </button>

                      <div className="dropdown-top-icon-actions" role="group" aria-label="Board quick actions">
                        <button
                          type="button"
                          className={`dropdown-icon-action-btn ${copied ? "active" : ""}`}
                          role="menuitem"
                          onClick={handleCopyLink}
                          title={copied ? "Link Copied!" : "Copy Board Link"}
                          aria-label={copied ? "Link Copied!" : "Copy Board Link"}
                        >
                          {copied ? <Check size={14} /> : <Link size={14} />}
                        </button>
                        <button
                          type="button"
                          className="dropdown-icon-action-btn"
                          role="menuitem"
                          onClick={handleExportImage}
                          title="Export image (Ctrl+Shift+E)"
                          aria-label="Export image"
                        >
                          <ImageDown size={14} />
                        </button>
                        <button
                          type="button"
                          className="dropdown-icon-action-btn"
                          role="menuitem"
                          onClick={handleFindOnCanvas}
                          title="Find on canvas (Ctrl+F)"
                          aria-label="Find on canvas"
                        >
                          <Search size={14} />
                        </button>
                        <button
                          type="button"
                          className="dropdown-icon-action-btn"
                          role="menuitem"
                          onClick={handleCommandPalette}
                          title="Command palette (Ctrl+/)"
                          aria-label="Command palette"
                        >
                          <Terminal size={14} />
                        </button>
                        <button
                          type="button"
                          className="dropdown-icon-action-btn"
                          role="menuitem"
                          onClick={handleHelp}
                          title="Help (?)"
                          aria-label="Help"
                        >
                          <HelpCircle size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="custom-dropdown-separator" />

                    <div className="dropdown-section">
                      <label htmlFor="dropdown-board-title" className="dropdown-section-label">
                        Board Name
                      </label>
                      <input
                        id="dropdown-board-title"
                        type="text"
                        className="dropdown-input"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onBlur={() => void commitTitle()}
                        onKeyDown={handleTitleKeyDown}
                        placeholder="Board title..."
                        aria-label="Board title"
                      />
                    </div>

                    <div className="dropdown-section">
                      <label htmlFor="dropdown-board-tag-input" className="dropdown-section-label">
                        Tags
                      </label>
                      {tags.length > 0 && (
                        <div className="dropdown-tags-list">
                          {tags.map((tag) => (
                            <span key={tag} className="dropdown-tag-pill">
                              #{tag}
                              <button
                                type="button"
                                className="dropdown-tag-remove"
                                aria-label={`Remove tag ${tag}`}
                                onClick={() => void handleRemoveTag(tag)}
                              >
                                <X size={11} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="dropdown-tag-add-row">
                        <input
                          id="dropdown-board-tag-input"
                          type="text"
                          className="dropdown-input"
                          placeholder="Add tag..."
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={handleTagKeyDown}
                          aria-label="New tag name"
                        />
                        <button
                          type="button"
                          className="dropdown-tag-add-btn"
                          onClick={() => void handleAddTag()}
                          disabled={!normalizeTag(tagInput)}
                        >
                          Add
                        </button>
                      </div>
                    </div>

                    <div className="custom-dropdown-separator" />

                    <button
                      type="button"
                      className="custom-dropdown-item"
                      role="menuitemcheckbox"
                      aria-checked={preferences.gridModeEnabled}
                      onClick={handleToggleGrid}
                    >
                      <Grid3x3 size={14} />
                      <span className="dropdown-item-label">Toggle Grid</span>
                      <span className="dropdown-shortcut-hint">Ctrl+&apos;</span>
                      <span
                        className={`dropdown-switch ${
                          preferences.gridModeEnabled ? "checked" : ""
                        }`}
                        aria-hidden="true"
                      >
                        <span className="dropdown-switch-thumb" />
                      </span>
                    </button>

                    <button
                      type="button"
                      className="custom-dropdown-item"
                      role="menuitemcheckbox"
                      aria-checked={preferences.zenModeEnabled}
                      onClick={handleToggleZenMode}
                    >
                      <Coffee size={14} />
                      <span className="dropdown-item-label">Zen Mode</span>
                      <span className="dropdown-shortcut-hint">Alt+Z</span>
                      <span
                        className={`dropdown-switch ${
                          preferences.zenModeEnabled ? "checked" : ""
                        }`}
                        aria-hidden="true"
                      >
                        <span className="dropdown-switch-thumb" />
                      </span>
                    </button>

                    <button
                      type="button"
                      className="custom-dropdown-item"
                      role="menuitemcheckbox"
                      aria-checked={preferences.viewModeEnabled}
                      onClick={handleToggleViewMode}
                    >
                      <Eye size={14} />
                      <span className="dropdown-item-label">View Mode</span>
                      <span className="dropdown-shortcut-hint">Alt+R</span>
                      <span
                        className={`dropdown-switch ${
                          preferences.viewModeEnabled ? "checked" : ""
                        }`}
                        aria-hidden="true"
                      >
                        <span className="dropdown-switch-thumb" />
                      </span>
                    </button>

                    <button
                      type="button"
                      className="custom-dropdown-item"
                      role="menuitemcheckbox"
                      aria-checked={preferences.bindingPreference === "enabled"}
                      onClick={handleToggleArrowBinding}
                    >
                      <Link2 size={14} />
                      <span className="dropdown-item-label">Arrow Binding</span>
                      <span
                        className={`dropdown-switch ${
                          preferences.bindingPreference === "enabled" ? "checked" : ""
                        }`}
                        aria-hidden="true"
                      >
                        <span className="dropdown-switch-thumb" />
                      </span>
                    </button>

                    <button
                      type="button"
                      className="custom-dropdown-item"
                      role="menuitemcheckbox"
                      aria-checked={preferences.objectsSnapModeEnabled}
                      onClick={handleToggleObjectsSnap}
                    >
                      <Magnet size={14} />
                      <span className="dropdown-item-label">Snap to Object</span>
                      <span className="dropdown-shortcut-hint">Alt+S</span>
                      <span
                        className={`dropdown-switch ${
                          preferences.objectsSnapModeEnabled ? "checked" : ""
                        }`}
                        aria-hidden="true"
                      >
                        <span className="dropdown-switch-thumb" />
                      </span>
                    </button>

                    <button
                      type="button"
                      className="custom-dropdown-item"
                      role="menuitemcheckbox"
                      aria-checked={preferences.isMidpointSnappingEnabled}
                      onClick={handleToggleMidpointSnapping}
                    >
                      <Crosshair size={14} />
                      <span className="dropdown-item-label">Snap to midpoints</span>
                      <span
                        className={`dropdown-switch ${
                          preferences.isMidpointSnappingEnabled ? "checked" : ""
                        }`}
                        aria-hidden="true"
                      >
                        <span className="dropdown-switch-thumb" />
                      </span>
                    </button>

                    <div className="custom-dropdown-separator" />

                    <div className="dropdown-section">
                      <div className="dropdown-row-between">
                        <span className="dropdown-section-label">Theme</span>
                        <div className="dropdown-theme-toggle" role="group" aria-label="Canvas theme">
                          <button
                            type="button"
                            className={`dropdown-theme-btn ${canvasTheme === "dark" ? "active" : ""}`}
                            aria-pressed={canvasTheme === "dark"}
                            onClick={() => handleSetTheme("dark")}
                            title="Dark theme"
                          >
                            <Moon size={12} />
                            <span>Dark</span>
                          </button>
                          <button
                            type="button"
                            className={`dropdown-theme-btn ${canvasTheme === "light" ? "active" : ""}`}
                            aria-pressed={canvasTheme === "light"}
                            onClick={() => handleSetTheme("light")}
                            title="Light theme"
                          >
                            <Sun size={12} />
                            <span>Light</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="dropdown-section">
                      <div className="dropdown-row-between">
                        <span className="dropdown-section-label">Canvas background</span>
                        <span className="dropdown-bg-hex">
                          {applyDarkModeFilter(canvasBg, canvasTheme === "dark")}
                        </span>
                      </div>
                      <div className="dropdown-bg-swatches" role="group" aria-label="Canvas background">
                        {CANVAS_BACKGROUND_PICKS.map((pick) => {
                          const displayColor = applyDarkModeFilter(
                            pick.color,
                            canvasTheme === "dark"
                          );
                          const isActive =
                            canvasBg.toLowerCase() === pick.color.toLowerCase();
                          return (
                            <button
                              key={pick.color}
                              type="button"
                              className={`dropdown-bg-swatch ${isActive ? "active" : ""}`}
                              style={{ backgroundColor: displayColor }}
                              onClick={() => handleSetCanvasBg(pick.color)}
                              aria-label={`Canvas background ${pick.label}`}
                              aria-pressed={isActive}
                              title={`${pick.label} (${displayColor})`}
                            />
                          );
                        })}

                        <label
                          className={`dropdown-bg-swatch custom ${isCustomBg ? "active" : ""}`}
                          style={
                            isCustomBg
                              ? {
                                  backgroundColor: applyDarkModeFilter(
                                    canvasBg,
                                    canvasTheme === "dark"
                                  ),
                                }
                              : undefined
                          }
                          title="Custom background color"
                        >
                          <Pipette size={12} />
                          <input
                            type="color"
                            className="dropdown-bg-color-input"
                            value={/^#[0-9a-fA-F]{6}$/.test(canvasBg) ? canvasBg : "#ffffff"}
                            onChange={(e) => handleSetCanvasBg(e.target.value)}
                            aria-label="Custom canvas background color"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="custom-dropdown-separator" />

                    <button
                      type="button"
                      className="custom-dropdown-item"
                      role="menuitem"
                      onClick={handleResetCanvas}
                    >
                      <RotateCcw size={14} />
                      <span>Reset the canvas</span>
                    </button>
                    <button
                      type="button"
                      className="custom-dropdown-item"
                      role="menuitem"
                      onClick={handleDeleteBoard}
                    >
                      <Trash size={14} />
                      <span>Delete Board</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          renderTopRightUI={() => (
            <div className="top-right-save-wrap">
              <span
                className={`save-status ${saveStatus}`}
                onClick={() => {
                  if (saveStatus === "error" && pendingJsonRef.current) {
                    void persistScene(pendingJsonRef.current);
                  }
                }}
                title={saveStatus === "error" ? "Click to retry save" : undefined}
                style={saveStatus === "error" ? { cursor: "pointer" } : undefined}
              >
                {saveStatus === "saved" && (
                  <>
                    <Check size={12} />
                    Saved
                  </>
                )}
                {saveStatus === "dirty" && <>Unsaved</>}
                {saveStatus === "saving" && (
                  <>
                    <Loader2 size={12} className="spin" />
                    Saving...
                  </>
                )}
                {saveStatus === "error" && (
                  <>
                    <AlertCircle size={12} />
                    Retry save
                  </>
                )}
              </span>
            </div>
          )}
        >
          <CommandPalette />
        </Excalidraw>
      </div>

      <ConfirmDialog
        open={confirmDialog !== null}
        title={confirmDialog === "resetCanvas" ? "Reset Canvas" : "Delete Board"}
        message={
          confirmDialog === "resetCanvas"
            ? "Reset the canvas and clear all elements? This action cannot be undone."
            : `Are you sure you want to delete "${board.title || "Untitled Board"}"? This action cannot be undone.`
        }
        confirmLabel={confirmDialog === "resetCanvas" ? "Reset Canvas" : "Delete"}
        busy={deletingBoard}
        busyLabel="Deleting..."
        error={deleteBoardError}
        onConfirm={handleConfirmModalAction}
        onCancel={() => {
          if (!deletingBoard) {
            setConfirmDialog(null);
            setDeleteBoardError(null);
          }
        }}
      />
    </div>
  );
}
