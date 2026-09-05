"use client";

import { useState } from "react";
import { Button, cx } from "@/components/ui";
import type { CaptionWord } from "@/lib/types";

export function CaptionsEditor({ captions, keyPhrases, showKeyPhrases, onSave }: { captions: CaptionWord[]; keyPhrases: string[]; showKeyPhrases: boolean; onSave: (captions: CaptionWord[], keyPhrases: string[]) => Promise<void> }) {
  const [words, setWords] = useState(captions);
  const [phrases, setPhrases] = useState(keyPhrases.join(", "));
  const [editing, setEditing] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-sync local edits when the server sends new captions / phrases.
  const [prevCaptions, setPrevCaptions] = useState(captions);
  const [prevPhrases, setPrevPhrases] = useState(keyPhrases);
  if (captions !== prevCaptions) {
    setPrevCaptions(captions);
    setWords(captions);
    setDirty(false);
  }
  if (keyPhrases !== prevPhrases) {
    setPrevPhrases(keyPhrases);
    setPhrases(keyPhrases.join(", "));
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">
          Captions <span className="text-muted">· click a word to fix it</span>
        </div>
        <Button
          size="sm"
          variant={dirty ? "primary" : "ghost"}
          disabled={!dirty}
          loading={saving}
          onClick={async () => {
            setSaving(true);
            await onSave(words, phrases.split(",").map((p) => p.trim()).filter(Boolean));
            setSaving(false);
            setDirty(false);
          }}
        >
          Save captions
        </Button>
      </div>
      <div className="scrollbar-thin max-h-56 overflow-y-auto rounded-xl border border-border bg-surface-2 p-3 text-sm leading-7">
        {words.length === 0 && <span className="text-muted">No transcript yet.</span>}
        {words.map((w, i) =>
          editing === i ? (
            <input
              key={i}
              autoFocus
              defaultValue={w.text}
              className="mx-0.5 w-24 rounded border border-accent bg-surface px-1 text-sm outline-none"
              onBlur={(e) => {
                const text = e.target.value.trim();
                if (text && text !== w.text) {
                  setWords((ws) => ws.map((x, k) => (k === i ? { ...x, text } : x)));
                  setDirty(true);
                }
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <button key={i} className={cx("rounded px-0.5 hover:bg-accent/15", w.text !== captions[i]?.text && "bg-accent/15")} onClick={() => setEditing(i)} title={`${w.start.toFixed(2)}s`}>
              {w.text}
            </button>
          ),
        )}
      </div>
      {showKeyPhrases && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-muted">Key phrases for kinetic typography (comma-separated, copied from the transcript)</div>
          <input
            value={phrases}
            onChange={(e) => {
              setPhrases(e.target.value);
              setDirty(true);
            }}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
      )}
    </div>
  );
}
