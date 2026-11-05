import { openUrl } from "@tauri-apps/plugin-opener";
import { Cat, RefreshCw, X } from "./icons";
import { useCallback, useEffect, useState } from "react";

/** Subreddits to pick from; meme-api.com serves a random post from one. */
const SUBREDDITS = ["memes", "ProgrammerHumor", "wholesomememes", "dogmemes"];

interface Meme {
  title: string;
  url: string;
  postLink: string;
  subreddit: string;
}

async function randomMeme(): Promise<Meme> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const subreddit = SUBREDDITS[Math.floor(Math.random() * SUBREDDITS.length)];
    const response = await fetch(`https://meme-api.com/gimme/${subreddit}`);
    if (!response.ok) continue;
    const meme = await response.json();
    if (meme.url && !meme.nsfw && !meme.spoiler) return meme;
  }
  throw new Error("No meme found");
}

/** A round button in the corner that shows a random meme. */
export function MemeButton() {
  const [open, setOpen] = useState(false);
  const [meme, setMeme] = useState<Meme | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [imageLoaded, setImageLoaded] = useState(false);

  const load = useCallback(() => {
    setState("loading");
    setImageLoaded(false);
    randomMeme()
      .then((m) => {
        setMeme(m);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="meme-button"
        title="Random meme"
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        <Cat size={19} />
      </button>
      {open && (
        <div className="meme-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="meme-card">
            <div className="meme-head">
              <span className="meme-title">{state === "ready" && meme ? meme.title : "Random meme"}</span>
              <button type="button" className="icon-button" title="Close (Esc)" onClick={() => setOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <div className="meme-body">
              {state === "error" && <span className="meme-status">Could not load a meme. Check the connection and try again.</span>}
              {(state === "loading" || (state === "ready" && !imageLoaded)) && <span className="meme-status">Fetching a meme…</span>}
              {state === "ready" && meme && (
                <img
                  key={meme.url}
                  src={meme.url}
                  alt={meme.title}
                  className={imageLoaded ? "" : "loading"}
                  onLoad={() => setImageLoaded(true)}
                  onError={() => setState("error")}
                />
              )}
            </div>
            <div className="meme-foot">
              {state === "ready" && meme && (
                <button type="button" className="meme-source" onClick={() => void openUrl(meme.postLink)}>
                  r/{meme.subreddit}
                </button>
              )}
              <span className="spacer" />
              <button type="button" className="button primary" onClick={load} disabled={state === "loading"}>
                <RefreshCw size={13} /> Another one
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
