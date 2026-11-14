export interface BoardSummary {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BoardData {
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

export interface Board extends BoardSummary {
  data: BoardData;
}

export interface CreateBoardPayload {
  title?: string;
  tags?: string[];
  data?: BoardData;
}

export interface UpdateBoardPayload {
  title?: string;
  tags?: string[];
  data?: BoardData;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) {
        msg = body.error;
      }
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export function listBoards(params?: {
  tag?: string;
  q?: string;
}): Promise<BoardSummary[]> {
  const search = new URLSearchParams();
  if (params?.tag) search.set("tag", params.tag);
  if (params?.q) search.set("q", params.q);
  const qs = search.toString();
  return request<BoardSummary[]>(`/api/boards${qs ? `?${qs}` : ""}`);
}

export function getBoard(id: string): Promise<Board> {
  return request<Board>(`/api/boards/${encodeURIComponent(id)}`);
}

export function createBoard(payload: CreateBoardPayload = {}): Promise<Board> {
  return request<Board>("/api/boards", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateBoard(
  id: string,
  payload: UpdateBoardPayload,
  options?: { keepalive?: boolean }
): Promise<Board> {
  return request<Board>(`/api/boards/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
    keepalive: options?.keepalive,
  });
}

export function deleteBoard(id: string): Promise<void> {
  return request<void>(`/api/boards/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
