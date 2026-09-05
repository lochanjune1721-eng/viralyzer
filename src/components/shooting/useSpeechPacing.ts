"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Voice-paced teleprompter: uses the Web Speech API (where available) to track
// which script word was last spoken so the prompter can follow the speaker.

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function speechPacingSupported(): boolean {
  return !!getRecognitionCtor();
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function useSpeechPacing(scriptWords: string[], enabled: boolean) {
  const [wordIndex, setWordIndex] = useState(0);
  const idxRef = useRef(0);
  const recRef = useRef<Recognition | null>(null);
  const tokens = useRef<string[]>([]);
  useEffect(() => {
    tokens.current = scriptWords.map(norm);
  }, [scriptWords]);

  const reset = useCallback(() => {
    idxRef.current = 0;
    setWordIndex(0);
  }, []);

  useEffect(() => {
    if (!enabled) {
      recRef.current?.stop();
      recRef.current = null;
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    let stopped = false;
    rec.onresult = (e) => {
      let spoken = "";
      for (let i = e.resultIndex; i < e.results.length; i++) spoken += " " + e.results[i][0].transcript;
      const heard = spoken.split(/\s+/).map(norm).filter(Boolean).slice(-6);
      if (!heard.length) return;
      const toks = tokens.current;
      const from = idxRef.current;
      const to = Math.min(toks.length, from + 30);
      // Find the furthest script position (within the window) that matches the
      // most recent heard words, preferring two-word agreement.
      let best = -1;
      for (let i = from; i < to; i++) {
        const last = heard[heard.length - 1];
        const prev = heard[heard.length - 2];
        if (toks[i] === last && (prev === undefined || toks[i - 1] === prev || i === from)) best = i;
        else if (toks[i] === last && best < 0) best = i;
      }
      if (best >= 0 && best + 1 > idxRef.current) {
        idxRef.current = best + 1;
        setWordIndex(best + 1);
      }
    };
    rec.onend = () => {
      if (!stopped) {
        try {
          rec.start();
        } catch {
          /* ignore */
        }
      }
    };
    rec.onerror = () => {};
    try {
      rec.start();
    } catch {
      /* ignore */
    }
    recRef.current = rec;
    return () => {
      stopped = true;
      rec.stop();
    };
  }, [enabled]);

  return { wordIndex, reset };
}
