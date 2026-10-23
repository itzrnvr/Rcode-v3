import { useMemo, useRef, useState } from "react";
import { GlobeIcon, RefreshIcon } from "../common/Icons";

function BrowserPane() {
  const isEmbeddedApp = new URLSearchParams(window.location.search).has("embedded");
  const reloadKeyRef = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);
  const url = useMemo(() => {
    // The preview entry shares the top frame's Electron bridge, so the embedded
    const url = new URL("preview.html", window.location.href);
    url.searchParams.set("embedded", "1");
    return url.href;
  }, []);

  const reload = () => {
    reloadKeyRef.current += 1;
    setReloadKey(reloadKeyRef.current);
  };

  if (isEmbeddedApp) {
    return (
      <div className="browser-pane-unsupported">
        Browser preview is unavailable inside the embedded preview.
      </div>
    );
  }

  return (
    <div className="browser-pane">
      <div className="browser-pane-bar">
        <GlobeIcon size={14} className="shrink-0 text-[var(--color-foreground-subtlest)]" />
        <span className="browser-pane-url">{url}</span>
        <button
          className="sp-iconbtn"
          aria-label="Reload preview"
          onClick={reload}
          title="Reload preview"
          type="button"
        >
          <RefreshIcon size={14} />
        </button>
      </div>
      <div className="browser-pane-frame">
        <iframe
          key={reloadKey}
          src={url}
          title="Rcode dev preview"
        />
      </div>
    </div>
  );
}

export { BrowserPane };



