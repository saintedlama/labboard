import { loadLibraryFromBlob } from "@excalidraw/excalidraw";

export interface LibraryItemData {
  id: string;
  status?: "published" | "unpublished";
  elements: readonly unknown[];
  created?: number;
  name?: string;
  sourceSet?: string;
  sourceUrl?: string;
  [key: string]: unknown;
}

export interface LibraryPayload {
  libraryItems: LibraryItemData[];
}

interface ExcalidrawLibraryIndexEntry {
  name?: string;
  source?: string;
}

const LOCAL_STORAGE_KEY = "labboard_library";
const EXCALIDRAW_LIBRARIES_INDEX_URL = "https://libraries.excalidraw.com/libraries.json";
const INDEX_FETCH_TIMEOUT_MS = 2500;

let libraryIndexPromise: Promise<ExcalidrawLibraryIndexEntry[]> | null = null;

async function loadExcalidrawLibraryIndex(): Promise<ExcalidrawLibraryIndexEntry[]> {
  if (libraryIndexPromise) {
    return libraryIndexPromise;
  }

  libraryIndexPromise = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), INDEX_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(EXCALIDRAW_LIBRARIES_INDEX_URL, {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch library index (${res.status})`);
      }
      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as ExcalidrawLibraryIndexEntry[]) : [];
    } finally {
      window.clearTimeout(timer);
    }
  })().catch((err) => {
    libraryIndexPromise = null;
    throw err;
  });

  return libraryIndexPromise;
}

export function normalizeLibraryUrl(rawUrl: string): string {
  let decoded = rawUrl;
  try {
    decoded = decodeURIComponent(rawUrl);
  } catch {
    // keep rawUrl if already decoded or malformed escape sequence
  }

  const parsed = new URL(decoded, window.location.origin);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported library URL protocol: ${parsed.protocol}`);
  }
  return parsed.toString();
}

export function deriveSetNameFromUrl(libraryUrl: string): string {
  try {
    const parsed = new URL(libraryUrl, window.location.origin);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const rawLast = segments[segments.length - 1] ?? "";
    let decoded = rawLast;
    try {
      decoded = decodeURIComponent(rawLast);
    } catch {
      // keep rawLast
    }

    const withoutExt = decoded.replace(/\.(excalidrawlib|json)$/i, "");
    const cleaned = withoutExt.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned) {
      return cleaned
        .split(" ")
        .map((word) => {
          if (!word) return "";
          if (word !== word.toLowerCase()) {
            return word;
          }
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(" ");
    }
    if (parsed.hostname) {
      return parsed.hostname;
    }
  } catch {
    // ignore URL parse error
  }

  return "Imported Set";
}

export async function resolveLibrarySetName(libraryUrl: string): Promise<string> {
  const fallback = deriveSetNameFromUrl(libraryUrl);
  try {
    const parsed = new URL(libraryUrl, window.location.origin);
    const pathname = parsed.pathname.replace(/^\/+/, "").toLowerCase();
    const index = await loadExcalidrawLibraryIndex();

    for (const entry of index) {
      if (typeof entry?.source !== "string" || typeof entry?.name !== "string") {
        continue;
      }
      const entrySource = entry.source.replace(/^\/+/, "").toLowerCase();
      if (!entrySource) continue;

      if (
        pathname === entrySource ||
        pathname === `libraries/${entrySource}` ||
        pathname.endsWith(`/${entrySource}`)
      ) {
        const trimmedName = entry.name.trim();
        if (trimmedName) {
          return trimmedName;
        }
      }
    }
  } catch {
    // Fall back gracefully to filename slug when offline or non-index URL
  }

  return fallback;
}

export function stripAddLibraryUrlParams(): void {
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const queryParams = new URLSearchParams(window.location.search);
  let changed = false;

  if (hashParams.has("addLibrary")) {
    hashParams.delete("addLibrary");
    hashParams.delete("token");
    changed = true;
  }

  if (queryParams.has("addLibrary")) {
    queryParams.delete("addLibrary");
    changed = true;
  }

  if (!changed) return;

  const nextSearch = queryParams.toString();
  const nextHash = hashParams.toString();
  const nextUrl =
    window.location.pathname +
    (nextSearch ? `?${nextSearch}` : "") +
    (nextHash ? `#${nextHash}` : "");

  window.history.replaceState({}, document.title, nextUrl);
}

export async function fetchAndTagLibraryFromUrl(rawLibraryUrl: string): Promise<{
  items: LibraryItemData[];
  setName: string;
  sourceUrl: string;
}> {
  const sourceUrl = normalizeLibraryUrl(rawLibraryUrl);

  const [blob, setName] = await Promise.all([
    fetch(sourceUrl).then(async (res) => {
      if (!res.ok) {
        throw new Error(`Failed to fetch library (${res.status})`);
      }
      return res.blob();
    }),
    resolveLibrarySetName(sourceUrl),
  ]);

  const loadedItems = await loadLibraryFromBlob(blob, "published");
  const taggedItems: LibraryItemData[] = loadedItems.map((item) => ({
    ...(item as unknown as LibraryItemData),
    sourceSet: setName,
    sourceUrl,
  }));

  return {
    items: taggedItems,
    setName,
    sourceUrl,
  };
}

function isSameElementSignature(
  a: readonly unknown[],
  b: readonly unknown[]
): boolean {
  if (a.length !== b.length) return false;
  return a.every((el, idx) => {
    const first = el as { id?: unknown; versionNonce?: unknown } | null;
    const second = b[idx] as { id?: unknown; versionNonce?: unknown } | null;
    return (
      first !== null &&
      second !== null &&
      first.id === second.id &&
      first.versionNonce === second.versionNonce
    );
  });
}

function findMatchingIncomingItem(
  existing: LibraryItemData,
  incomingItems: readonly LibraryItemData[]
): LibraryItemData | undefined {
  return incomingItems.find((candidate) => {
    if (candidate.id === existing.id) {
      return true;
    }
    if (Array.isArray(existing.elements) && Array.isArray(candidate.elements)) {
      return isSameElementSignature(existing.elements, candidate.elements);
    }
    return false;
  });
}

function isDuplicateOfExisting(
  existingItems: readonly LibraryItemData[],
  candidate: LibraryItemData
): boolean {
  return existingItems.some((existing) => {
    if (existing.id === candidate.id) {
      return true;
    }
    if (Array.isArray(existing.elements) && Array.isArray(candidate.elements)) {
      return isSameElementSignature(existing.elements, candidate.elements);
    }
    return false;
  });
}

export function mergeAndTagLibraryItems(
  existingItems: readonly LibraryItemData[],
  incomingItems: readonly LibraryItemData[]
): {
  items: LibraryItemData[];
  addedCount: number;
  backfilledCount: number;
} {
  let backfilledCount = 0;

  const updatedExisting = existingItems.map((existing) => {
    const hasSet =
      typeof existing.sourceSet === "string" && existing.sourceSet.trim().length > 0;
    if (hasSet) {
      return existing;
    }

    const match = findMatchingIncomingItem(existing, incomingItems);
    if (!match || !match.sourceSet) {
      return existing;
    }

    backfilledCount += 1;
    return {
      ...existing,
      sourceSet: match.sourceSet,
      sourceUrl: existing.sourceUrl || match.sourceUrl,
    };
  });

  const newItems: LibraryItemData[] = [];
  for (const candidate of incomingItems) {
    if (!isDuplicateOfExisting(updatedExisting, candidate) && !isDuplicateOfExisting(newItems, candidate)) {
      newItems.push(candidate);
    }
  }

  return {
    items: [...newItems, ...updatedExisting],
    addedCount: newItems.length,
    backfilledCount,
  };
}

export async function getLibrary(): Promise<LibraryPayload> {
  const res = await fetch("/api/library");
  if (!res.ok) {
    let msg = `Failed to load library (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) {
        msg = body.error;
      }
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const data = (await res.json()) as Partial<LibraryPayload> | null;
  const libraryItems = Array.isArray(data?.libraryItems) ? data.libraryItems : [];

  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ libraryItems }));
  } catch {
    // ignore storage quota errors
  }

  return { libraryItems };
}

export async function saveLibrary(libraryItems: LibraryItemData[]): Promise<LibraryPayload> {
  const payload: LibraryPayload = { libraryItems };

  const res = await fetch("/api/library", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let msg = `Failed to save library (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) {
        msg = body.error;
      }
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }

  return payload;
}
