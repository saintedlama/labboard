import { useEffect, useMemo, useRef, useState } from "react";
import {
  exportScene,
  getNonDeletedElements,
  getTextFromElements,
  parseLibraryTokensFromUrl,
  restoreElements,
} from "@excalidraw/excalidraw";
import { BookOpen, Search, Shapes, Trash2, X } from "lucide-react";
import {
  fetchAndTagLibraryFromUrl,
  getLibrary,
  LibraryItemData,
  mergeAndTagLibraryItems,
  saveLibrary,
  stripAddLibraryUrlParams,
} from "../api/library";
import { AppTheme } from "../utils/theme";
import { ConfirmDialog } from "./ConfirmDialog";

type ExportElements = Parameters<typeof exportScene>[0]["data"]["elements"];
type RestoreInput = Parameters<typeof restoreElements>[0];

const UNTAGGED_SET_FILTER = "__untagged__";

type ConfirmDeleteTarget =
  | { type: "item"; item: LibraryItemData; label: string }
  | { type: "deleteAll" }
  | { type: "deleteSelected"; setFilter: string; setLabel: string; count: number };

function getItemLabel(item: LibraryItemData): string {
  const named = typeof item.name === "string" ? item.name.trim() : "";
  if (named) return named;

  try {
    const restored = restoreElements((item.elements ?? []) as RestoreInput, null);
    const nonDeleted = getNonDeletedElements(restored);
    const text = getTextFromElements(nonDeleted)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (text) return text;
  } catch {
    // ignore text extraction errors
  }

  return "Untitled item";
}

function getItemSetName(item: LibraryItemData): string | null {
  if (typeof item.sourceSet !== "string") return null;
  const trimmed = item.sourceSet.trim();
  return trimmed || null;
}

interface LibraryItemPreviewProps {
  item: LibraryItemData;
  theme: AppTheme;
}

function LibraryItemPreview({ item, theme }: LibraryItemPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    const renderSvg = async () => {
      try {
        const restored = restoreElements((item.elements ?? []) as RestoreInput, null);
        const nonDeleted = getNonDeletedElements(restored) as unknown as ExportElements;
        if (nonDeleted.length === 0) {
          if (!cancelled) setFailed(true);
          return;
        }

        const svg = await exportScene({
          type: "svg",
          data: { elements: nonDeleted },
          config: {
            theme,
            canvasBackgroundColor: false,
            padding: 8,
            maxWidthOrHeight: 112,
            skipInliningFonts: true,
          },
        });

        if (cancelled) return;
        svg.style.maxWidth = "100%";
        svg.style.maxHeight = "100%";
        svg.style.width = "auto";
        svg.style.height = "auto";
        svg.setAttribute("aria-hidden", "true");

        const target = svgWrapRef.current;
        if (target) {
          target.replaceChildren(svg);
          setRendered(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    void renderSvg();

    return () => {
      cancelled = true;
    };
  }, [visible, item, theme]);

  return (
    <div ref={hostRef} className="library-card-thumb">
      <div ref={svgWrapRef} className="library-thumb-svg" />
      {(!rendered || failed) && (
        <span className="library-thumb-fallback" aria-hidden="true">
          <Shapes size={22} />
        </span>
      )}
    </div>
  );
}

interface LibrarySectionProps {
  theme?: AppTheme;
}

export function LibrarySection({ theme = "dark" }: LibrarySectionProps) {
  const [items, setItems] = useState<LibraryItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedSet, setSelectedSet] = useState<string | null>(null);

  // Confirmation modal state
  const [confirmTarget, setConfirmTarget] = useState<ConfirmDeleteTarget | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const initialLoadPromise = getLibrary()
      .then((res) => {
        if (cancelled) return res.libraryItems;
        setItems(res.libraryItems);
        setLoading(false);
        return res.libraryItems;
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load library");
          setLoading(false);
        }
        return [] as LibraryItemData[];
      });

    const handleUrlImport = async (libraryUrl: string) => {
      try {
        stripAddLibraryUrlParams();
        if (document.hidden) {
          await new Promise<void>((resolve) => {
            window.addEventListener("focus", () => resolve(), { once: true });
          });
        }
        if (cancelled) return;

        const { items: taggedItems, setName } = await fetchAndTagLibraryFromUrl(libraryUrl);
        if (cancelled || taggedItems.length === 0) return;

        const shapeWord = taggedItems.length === 1 ? "shape" : "shapes";
        const confirmed = window.confirm(
          `Add ${taggedItems.length} ${shapeWord} from "${setName}" to library?`
        );
        if (!confirmed || cancelled) return;

        const latestPayload = await initialLoadPromise.then(async () => {
          try {
            return await getLibrary();
          } catch {
            return { libraryItems: [] as LibraryItemData[] };
          }
        });
        if (cancelled) return;

        const merged = mergeAndTagLibraryItems(latestPayload.libraryItems, taggedItems);
        if (merged.addedCount === 0 && merged.backfilledCount === 0) {
          setImportNotice(
            `All ${taggedItems.length} ${shapeWord} from "${setName}" are already in your library.`
          );
          return;
        }

        await saveLibrary(merged.items);
        if (cancelled) return;

        setItems(merged.items);
        setError(null);

        if (merged.addedCount > 0 && merged.backfilledCount > 0) {
          setImportNotice(
            `Imported ${merged.addedCount} and tagged ${merged.backfilledCount} existing shapes from "${setName}".`
          );
        } else if (merged.addedCount > 0) {
          setImportNotice(
            `Imported ${merged.addedCount} ${merged.addedCount === 1 ? "shape" : "shapes"} from "${setName}".`
          );
        } else {
          setImportNotice(
            `Tagged ${merged.backfilledCount} existing ${merged.backfilledCount === 1 ? "shape" : "shapes"} with "${setName}".`
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to import library");
        }
      }
    };

    const initialTokens = parseLibraryTokensFromUrl();
    if (initialTokens) {
      stripAddLibraryUrlParams();
      void handleUrlImport(initialTokens.libraryUrl);
    }

    const onHashChange = (event: HashChangeEvent) => {
      const tokens = parseLibraryTokensFromUrl();
      if (!tokens) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stripAddLibraryUrlParams();
      void handleUrlImport(tokens.libraryUrl);
    };

    window.addEventListener("hashchange", onHashChange, { capture: true });

    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange, { capture: true });
    };
  }, []);

  const enrichedItems = useMemo(
    () =>
      items.map((item) => ({
        item,
        label: getItemLabel(item),
        sourceSet: getItemSetName(item),
      })),
    [items]
  );

  const { availableSets, hasUntagged } = useMemo(() => {
    const setNames = new Set<string>();
    let untagged = false;
    for (const entry of enrichedItems) {
      if (entry.sourceSet) {
        setNames.add(entry.sourceSet);
      } else {
        untagged = true;
      }
    }
    return {
      availableSets: Array.from(setNames).sort((a, b) => a.localeCompare(b)),
      hasUntagged: untagged,
    };
  }, [enrichedItems]);

  useEffect(() => {
    if (selectedSet === null) return;
    if (selectedSet === UNTAGGED_SET_FILTER) {
      if (!hasUntagged || availableSets.length === 0) {
        setSelectedSet(null);
      }
      return;
    }
    if (!availableSets.includes(selectedSet)) {
      setSelectedSet(null);
    }
  }, [selectedSet, availableSets, hasUntagged]);

  const selectedSetItems = useMemo(() => {
    if (selectedSet === null) return [];
    return enrichedItems.filter(({ sourceSet }) =>
      selectedSet === UNTAGGED_SET_FILTER ? sourceSet === null : sourceSet === selectedSet
    );
  }, [enrichedItems, selectedSet]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enrichedItems.filter(({ label, item, sourceSet }) => {
      if (selectedSet === UNTAGGED_SET_FILTER) {
        if (sourceSet !== null) return false;
      } else if (selectedSet !== null) {
        if (sourceSet !== selectedSet) return false;
      }

      if (!q) return true;
      return (
        label.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (sourceSet ? sourceSet.toLowerCase().includes(q) : false)
      );
    });
  }, [enrichedItems, query, selectedSet]);

  const handleOpenDeleteConfirm = () => {
    setConfirmError(null);
    if (selectedSet !== null) {
      const setLabel =
        selectedSet === UNTAGGED_SET_FILTER ? "Untagged" : selectedSet;
      setConfirmTarget({
        type: "deleteSelected",
        setFilter: selectedSet,
        setLabel,
        count: selectedSetItems.length,
      });
      return;
    }
    setConfirmTarget({ type: "deleteAll" });
  };

  const handleConfirmDelete = async () => {
    if (!confirmTarget) return;

    try {
      setConfirmBusy(true);
      setConfirmError(null);
      if (confirmTarget.type === "deleteAll") {
        await saveLibrary([]);
        setItems([]);
        setQuery("");
        setSelectedSet(null);
        setImportNotice(null);
      } else if (confirmTarget.type === "deleteSelected") {
        const nextItems = enrichedItems
          .filter(({ sourceSet }) =>
            confirmTarget.setFilter === UNTAGGED_SET_FILTER
              ? sourceSet !== null
              : sourceSet !== confirmTarget.setFilter
          )
          .map(({ item }) => item);
        await saveLibrary(nextItems);
        setItems(nextItems);
        setSelectedSet(null);
        setImportNotice(null);
      } else {
        const nextItems = items.filter((item) => item.id !== confirmTarget.item.id);
        await saveLibrary(nextItems);
        setItems(nextItems);
      }
      setConfirmTarget(null);
    } catch (err) {
      setConfirmError(
        err instanceof Error
          ? err.message
          : confirmTarget.type === "deleteAll"
            ? "Failed to delete library items"
            : confirmTarget.type === "deleteSelected"
              ? "Failed to delete selected library items"
              : "Failed to delete library item"
      );
    } finally {
      setConfirmBusy(false);
    }
  };

  const isFiltered = Boolean(query.trim()) || selectedSet !== null;

  const confirmDialogTitle =
    confirmTarget?.type === "deleteAll"
      ? "Delete All Library Items"
      : confirmTarget?.type === "deleteSelected"
        ? "Delete Selected Library Items"
        : "Delete Library Item";

  const confirmDialogMessage =
    confirmTarget?.type === "deleteAll"
      ? `Are you sure you want to delete all ${items.length} ${
          items.length === 1 ? "item" : "items"
        } from the library? This action cannot be undone.`
      : confirmTarget?.type === "deleteSelected"
        ? confirmTarget.setFilter === UNTAGGED_SET_FILTER
          ? `Are you sure you want to delete all ${confirmTarget.count} untagged ${
              confirmTarget.count === 1 ? "item" : "items"
            } from the library? This action cannot be undone.`
          : `Are you sure you want to delete all ${confirmTarget.count} ${
              confirmTarget.count === 1 ? "item" : "items"
            } from "${confirmTarget.setLabel}"? This action cannot be undone.`
        : confirmTarget?.type === "item"
          ? `Are you sure you want to delete "${confirmTarget.label}" from the library?`
          : "";

  const confirmDialogLabel =
    confirmTarget?.type === "deleteAll"
      ? "Delete All"
      : confirmTarget?.type === "deleteSelected"
        ? "Delete Selected"
        : "Delete";

  const confirmDialogBusyLabel = "Deleting...";

  return (
    <section className="library-section" aria-labelledby="library-section-heading">
      <div className="library-header">
        <div className="library-title-group">
          <span className="library-title-icon">
            <BookOpen size={16} />
          </span>
          <h2 id="library-section-heading" className="library-heading">
            Library
          </h2>
          {!loading && (
            <span className="library-count-badge">
              {isFiltered
                ? `${filteredItems.length} / ${items.length}`
                : `${items.length} ${items.length === 1 ? "item" : "items"}`}
            </span>
          )}
        </div>

        {items.length > 0 && (
          <div className="library-header-actions">
            <div className="library-search-wrap">
              <span className="search-icon">
                <Search size={14} />
              </span>
              <input
                type="text"
                className="input library-search-input"
                placeholder="Filter library items..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter library items"
              />
            </div>

            <button
              type="button"
              className="btn library-clear-btn"
              onClick={handleOpenDeleteConfirm}
            >
              <Trash2 size={14} />
              {selectedSet !== null ? "Delete Selected" : "Delete All"}
            </button>
          </div>
        )}
      </div>

      {availableSets.length > 0 && (
        <div className="tag-filter-bar library-set-filter-bar" aria-label="Filter library by set">
          <button
            type="button"
            className={`tag-pill tag-pill-neutral ${selectedSet === null ? "active" : ""}`}
            onClick={() => setSelectedSet(null)}
          >
            All sets
          </button>
          {availableSets.map((setName) => (
            <button
              key={setName}
              type="button"
              className={`tag-pill ${selectedSet === setName ? "active" : ""}`}
              onClick={() =>
                setSelectedSet((prev) => (prev === setName ? null : setName))
              }
            >
              {setName}
            </button>
          ))}
          {hasUntagged && (
            <button
              type="button"
              className={`tag-pill tag-pill-neutral ${
                selectedSet === UNTAGGED_SET_FILTER ? "active" : ""
              }`}
              onClick={() =>
                setSelectedSet((prev) =>
                  prev === UNTAGGED_SET_FILTER ? null : UNTAGGED_SET_FILTER
                )
              }
            >
              Untagged
            </button>
          )}
        </div>
      )}

      {importNotice && (
        <div className="library-notice-banner" role="status">
          <span>{importNotice}</span>
          <button
            type="button"
            className="btn btn-ghost library-notice-close"
            aria-label="Dismiss notification"
            onClick={() => setImportNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="boards-card">
        {loading ? (
          <div className="empty-state library-empty-state">
            <p>Loading library...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state library-empty-state">
            <p>
              No library items saved yet. Open any board and use the Excalidraw Library panel to add or import shapes.
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="empty-state library-empty-state">
            <p>No library items match your filter.</p>
          </div>
        ) : (
          <div className="library-grid">
            {filteredItems.map(({ item, label, sourceSet }) => {
              const elemCount = Array.isArray(item.elements) ? item.elements.length : 0;
              return (
                <div key={item.id} className="library-card">
                  <button
                    type="button"
                    className="btn btn-ghost library-card-remove"
                    aria-label={`Delete library item ${label}`}
                    title={`Delete "${label}"`}
                    onClick={() => {
                      setConfirmError(null);
                      setConfirmTarget({ type: "item", item, label });
                    }}
                    disabled={confirmBusy}
                  >
                    <Trash2 size={14} />
                  </button>

                  <LibraryItemPreview item={item} theme={theme} />

                  <div className="library-card-meta">
                    <span className="library-card-name" title={label}>
                      {label}
                    </span>
                    <div className="library-card-footer">
                      <span className="library-card-sub">
                        {elemCount} {elemCount === 1 ? "element" : "elements"}
                      </span>
                      {sourceSet && (
                        <button
                          type="button"
                          className={`library-card-set ${
                            selectedSet === sourceSet ? "active" : ""
                          }`}
                          title={
                            typeof item.sourceUrl === "string" && item.sourceUrl
                              ? `Set: ${sourceSet} (${item.sourceUrl})`
                              : `Filter by ${sourceSet}`
                          }
                          onClick={() =>
                            setSelectedSet((prev) => (prev === sourceSet ? null : sourceSet))
                          }
                        >
                          {sourceSet}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title={confirmDialogTitle}
        message={confirmDialogMessage}
        confirmLabel={confirmDialogLabel}
        busy={confirmBusy}
        busyLabel={confirmDialogBusyLabel}
        error={confirmError}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!confirmBusy) {
            setConfirmTarget(null);
            setConfirmError(null);
          }
        }}
      />
    </section>
  );
}
