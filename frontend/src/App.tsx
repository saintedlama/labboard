import { useCallback, useEffect, useState } from "react";
import { BoardEditor } from "./components/BoardEditor";
import { BoardsList } from "./components/BoardsList";

function parseRoute(pathname: string): { view: "list" } | { view: "board"; id: string } {
  const match = pathname.match(/^\/boards\/([^/]+)\/?$/);
  if (match && match[1]) {
    return { view: "board", id: decodeURIComponent(match[1]) };
  }
  return { view: "list" };
}

export function App() {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onLocationChange = () => {
      setRoute(parseRoute(window.location.pathname));
    };
    window.addEventListener("popstate", onLocationChange);
    window.addEventListener("hashchange", onLocationChange);
    return () => {
      window.removeEventListener("popstate", onLocationChange);
      window.removeEventListener("hashchange", onLocationChange);
    };
  }, []);

  const navigate = useCallback((path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
    setRoute(parseRoute(path));
  }, []);

  if (route.view === "board") {
    return (
      <BoardEditor
        boardId={route.id}
        onBack={() => navigate("/")}
      />
    );
  }

  return (
    <BoardsList
      onOpenBoard={(id) => navigate(`/boards/${encodeURIComponent(id)}`)}
    />
  );
}
