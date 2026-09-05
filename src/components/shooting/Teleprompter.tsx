"use client";

import {
  Camera,
  CameraOff,
  Circle,
  Keyboard,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Square,
  SwitchCamera,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx, formatTime } from "@/components/ui";
import { speechPacingSupported, useSpeechPacing } from "./useSpeechPacing";
import {
  COLOR_HEX,
  DEFAULT_SETTINGS,
  MODE_LABELS,
  loadSettings,
  positionToY,
  saveSettings,
  speedFor,
  type PrompterMode,
  type PrompterPosition,
  type PrompterSettings,
} from "./prompterSettings";

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationSec: number;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) || "";
}

export function Teleprompter({
  script,
  onRecorded,
  uploading,
  className,
}: {
  script: string;
  onRecorded: (r: RecordingResult) => void;
  uploading?: boolean;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const offsetRef = useRef(0); // scroll: px scrolled; ticker: px translated
  const targetRef = useRef<number | null>(null);
  const chunkClockRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const dragRef = useRef<{ kind: "move" | "resize"; startY: number; startVal: number } | null>(null);

  const [settings, setSettings] = useState<PrompterSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [camError, setCamError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [chunk, setChunk] = useState(0);
  const chunkRef = useRef(0);
  const [progress, setProgress] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const words = useMemo(() => script.split(/\s+/).filter(Boolean), [script]);
  const { wordIndex, reset: resetVoice } = useSpeechPacing(words, settings.voice && (recording || playing));

  // ---- settings persistence ----
  useEffect(() => {
    setSettings(loadSettings());
  }, []);
  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
  }, [settings]);
  const update = (patch: Partial<PrompterSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const setPlayingBoth = useCallback((v: boolean) => {
    playingRef.current = v;
    setPlaying(v);
  }, []);

  // ---- camera ----
  const startCamera = useCallback(async () => {
    setCamError(null);
    setReady(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (!settingsRef.current.camera) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setReady(true);
    } catch (err) {
      setCamError(err instanceof Error ? err.message : "Camera unavailable. Allow camera and microphone access (HTTPS required on phones).");
    }
  }, [facing]);

  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [startCamera, settings.camera]);

  // ---- restart ----
  const restart = useCallback(() => {
    offsetRef.current = 0;
    targetRef.current = null;
    chunkClockRef.current = 0;
    chunkRef.current = 0;
    setChunk(0);
    setProgress(0);
    resetVoice();
    const box = boxRef.current;
    if (settingsRef.current.mode === "ticker-rtl" && box) offsetRef.current = box.clientWidth;
    if (settingsRef.current.mode === "ticker-ltr" && textRef.current) offsetRef.current = -textRef.current.scrollWidth;
  }, [resetVoice]);

  useEffect(() => {
    restart();
  }, [settings.mode, script, restart]);

  // ---- animation loop ----
  useEffect(() => {
    const step = (ts: number) => {
      const dt = lastTsRef.current ? Math.min(0.1, (ts - lastTsRef.current) / 1000) : 0;
      lastTsRef.current = ts;
      const s = settingsRef.current;
      const el = textRef.current;
      const box = boxRef.current;
      if (el && box) {
        const rate = speedFor(s.mode, s.speed);
        if (s.mode === "scroll") {
          const max = Math.max(0, el.scrollHeight - box.clientHeight * 0.35);
          if (s.voice && targetRef.current != null) offsetRef.current += (targetRef.current - offsetRef.current) * Math.min(1, dt * 4);
          else if (playingRef.current) offsetRef.current += rate * dt;
          offsetRef.current = Math.max(0, Math.min(max, offsetRef.current));
          el.style.transform = `translateY(${-offsetRef.current}px)`;
          setProgress(max > 0 ? offsetRef.current / max : 0);
          if (playingRef.current && offsetRef.current >= max && max > 0) setPlayingBoth(false);
        } else if (s.mode === "ticker-rtl" || s.mode === "ticker-ltr") {
          const w = el.scrollWidth;
          const bw = box.clientWidth;
          const dir = s.mode === "ticker-rtl" ? -1 : 1;
          if (s.voice && targetRef.current != null) offsetRef.current += (targetRef.current - offsetRef.current) * Math.min(1, dt * 4);
          else if (playingRef.current) offsetRef.current += dir * rate * dt;
          const min = -w;
          const max = bw;
          offsetRef.current = Math.max(min, Math.min(max, offsetRef.current));
          el.style.transform = `translateX(${offsetRef.current}px)`;
          const done = s.mode === "ticker-rtl" ? (bw - offsetRef.current) / (bw + w) : (offsetRef.current + w) / (bw + w);
          setProgress(Math.max(0, Math.min(1, done)));
          if (playingRef.current && (offsetRef.current <= min || offsetRef.current >= max)) setPlayingBoth(false);
        } else if (s.mode === "words") {
          const total = Math.max(1, Math.ceil(words.length / s.wordsPerChunk));
          if (!s.voice && playingRef.current) {
            chunkClockRef.current += dt * 1000;
            const perChunk = (s.wordsPerChunk * 60000) / rate;
            if (chunkClockRef.current >= perChunk) {
              chunkClockRef.current = 0;
              if (chunkRef.current < total - 1) {
                chunkRef.current += 1;
                setChunk(chunkRef.current);
              } else setPlayingBoth(false);
            }
          }
          setProgress(total > 1 ? chunkRef.current / (total - 1) : 1);
        }
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = 0;
    };
  }, [words.length, setPlayingBoth]);

  // voice pacing: aim at the last spoken word
  useEffect(() => {
    if (!settings.voice) {
      targetRef.current = null;
      return;
    }
    const idx = Math.min(words.length - 1, Math.max(0, wordIndex - 1));
    const span = wordRefs.current[idx];
    const box = boxRef.current;
    if (settings.mode === "words") {
      const c = Math.floor(idx / settings.wordsPerChunk);
      chunkRef.current = c;
      setChunk(c);
    } else if (span && box) {
      targetRef.current = settings.mode === "scroll" ? Math.max(0, span.offsetTop - box.clientHeight * 0.3) : box.clientWidth / 2 - span.offsetLeft - span.offsetWidth / 2;
    }
  }, [wordIndex, settings.voice, settings.mode, settings.wordsPerChunk, words.length]);

  // ---- recording ----
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((Date.now() - startedAtRef.current) / 1000), 250);
    return () => clearInterval(t);
  }, [recording]);

  const beginRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
    } catch {
      rec = new MediaRecorder(stream);
    }
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      const durationSec = (Date.now() - startedAtRef.current) / 1000;
      setRecording(false);
      setPlayingBoth(false);
      if (blob.size > 0) onRecorded({ blob, mimeType: type, durationSec });
    };
    recorderRef.current = rec;
    startedAtRef.current = Date.now();
    setElapsed(0);
    rec.start(1000);
    setRecording(true);
    restart();
    setPlayingBoth(true);
  }, [onRecorded, restart, setPlayingBoth]);

  const startRecording = useCallback(() => {
    const n = settingsRef.current.countdown;
    if (n <= 0) return beginRecording();
    setCountdown(n);
    let left = n;
    const t = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(t);
        setCountdown(null);
        beginRecording();
      } else setCountdown(left);
    }, 1000);
  }, [beginRecording]);

  const stopRecording = () => recorderRef.current?.stop();

  // ---- fullscreen ----
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlayingBoth(!playingRef.current);
      } else if (e.key === "ArrowUp" || e.key === "+" || e.key === "=") update({ speed: Math.min(100, settingsRef.current.speed + 5) });
      else if (e.key === "ArrowDown" || e.key === "-") update({ speed: Math.max(1, settingsRef.current.speed - 5) });
      else if (e.key === "ArrowRight" && settingsRef.current.mode === "words") {
        chunkRef.current = Math.min(Math.ceil(words.length / settingsRef.current.wordsPerChunk) - 1, chunkRef.current + 1);
        setChunk(chunkRef.current);
      } else if (e.key === "ArrowLeft" && settingsRef.current.mode === "words") {
        chunkRef.current = Math.max(0, chunkRef.current - 1);
        setChunk(chunkRef.current);
      } else if (e.key.toLowerCase() === "r") restart();
      else if (e.key.toLowerCase() === "m") update({ mirrorH: !settingsRef.current.mirrorH });
      else if (e.key.toLowerCase() === "f") toggleFullscreen();
      else if (e.key === "Escape") setShowSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restart, words.length]);

  // ---- drag to place / resize the prompter box ----
  const startDrag = (kind: "move" | "resize", e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { kind, startY: e.clientY, startVal: kind === "move" ? settingsRef.current.y : settingsRef.current.height };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const root = rootRef.current;
    if (!d || !root) return;
    const frac = (e.clientY - d.startY) / root.clientHeight;
    if (d.kind === "move") update({ y: Math.max(0, Math.min(1 - settingsRef.current.height, d.startVal + frac)) });
    else update({ height: Math.max(0.15, Math.min(0.9 - settingsRef.current.y, d.startVal + frac)) });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const activeIdx = settings.voice ? wordIndex : -1;
  const color = COLOR_HEX[settings.color];
  const textStyle: React.CSSProperties = {
    fontSize: settings.fontSize,
    color,
    textShadow: "0 1px 4px rgba(0,0,0,.85)",
    textAlign: settings.align,
    transform: undefined,
  };
  const mirrorClass = cx(settings.mirrorH && "scale-x-[-1]", settings.flipV && "scale-y-[-1]");
  const mobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const chunkWords = words.slice(chunk * settings.wordsPerChunk, (chunk + 1) * settings.wordsPerChunk);

  return (
    <div
      ref={rootRef}
      className={cx("relative mx-auto w-full overflow-hidden bg-black select-none", fullscreen ? "h-screen max-w-none rounded-none" : "max-w-[440px] rounded-2xl", className)}
      style={fullscreen ? undefined : { aspectRatio: "9 / 16", maxHeight: "calc(100dvh - 13rem)" }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {settings.camera ? (
        <video ref={videoRef} autoPlay muted playsInline className={cx("absolute inset-0 h-full w-full object-cover", facing === "user" && "scale-x-[-1]")} />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-[#161522] via-[#0f0e14] to-black" />
      )}
      {camError && settings.camera && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white">
          <div>{camError}</div>
          <div className="flex gap-2">
            <button className="rounded-lg bg-white/15 px-3 py-1.5" onClick={startCamera}>
              Try again
            </button>
            <button className="rounded-lg bg-white/15 px-3 py-1.5" onClick={() => update({ camera: false })}>
              Use prompter only
            </button>
          </div>
        </div>
      )}

      {/* progress */}
      <div className="absolute inset-x-0 top-0 z-20 h-1 bg-white/10">
        <div className="h-full bg-[#ffe16a] transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
      </div>

      {/* Prompter box: draggable, resizable */}
      <div
        ref={boxRef}
        className="absolute inset-x-0 z-10 overflow-hidden"
        style={{ top: `${settings.y * 100}%`, height: `${settings.height * 100}%`, background: `rgba(0,0,0,${settings.opacity})` }}
      >
        <div
          className="absolute inset-x-0 top-0 z-20 flex h-5 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          onPointerDown={(e) => startDrag("move", e)}
          title="Drag to move the prompter"
        >
          <span className="h-1 w-10 rounded-full bg-white/50" />
        </div>
        {settings.guide && settings.mode === "scroll" && <div className="pointer-events-none absolute inset-x-3 top-[30%] z-10 h-px bg-white/30" />}
        {settings.mode === "scroll" && (
          <div ref={textRef} className={cx("px-5 pt-[30%] pb-[70%] font-semibold leading-snug will-change-transform", mirrorClass)} style={textStyle}>
            {words.map((w, i) => (
              <span
                key={i}
                ref={(el) => {
                  wordRefs.current[i] = el;
                }}
                className={cx("inline-block", i < activeIdx ? "opacity-45" : i === activeIdx ? "text-[#ffe16a]" : "")}
              >
                {w}
                {settings.chunkBreaks && /[.!?]$/.test(w) ? <span className="block h-3" /> : " "}
              </span>
            ))}
          </div>
        )}
        {(settings.mode === "ticker-rtl" || settings.mode === "ticker-ltr") && (
          <div className="absolute inset-y-0 left-0 flex items-center">
            <div ref={textRef} className={cx("whitespace-nowrap px-2 font-semibold will-change-transform", mirrorClass)} style={{ ...textStyle, fontSize: settings.fontSize * 1.15 }}>
              {words.map((w, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    wordRefs.current[i] = el;
                  }}
                  className={cx("inline-block", i < activeIdx ? "opacity-45" : i === activeIdx ? "text-[#ffe16a]" : "")}
                >
                  {w}&nbsp;
                </span>
              ))}
            </div>
            {settings.guide && <div className="pointer-events-none absolute inset-y-2 left-1/2 w-px bg-white/30" />}
          </div>
        )}
        {settings.mode === "words" && (
          <div ref={textRef} className={cx("flex h-full items-center justify-center px-4 text-center font-extrabold leading-tight", mirrorClass)} style={{ ...textStyle, fontSize: settings.fontSize * 1.6, textAlign: "center" }}>
            <span key={chunk} className="fade-up">
              {chunkWords.join(" ")}
            </span>
            {words.length > 0 && (
              <span className="absolute bottom-6 right-3 text-[11px] font-normal text-white/60">
                {chunk + 1}/{Math.ceil(words.length / settings.wordsPerChunk)}
              </span>
            )}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 z-20 flex h-4 cursor-ns-resize touch-none items-end justify-center" onPointerDown={(e) => startDrag("resize", e)} title="Drag to resize">
          <span className="mb-1 h-1 w-8 rounded-full bg-white/35" />
        </div>
      </div>

      {/* Status */}
      <div className="absolute left-3 top-3 z-20 flex items-center gap-2 text-xs text-white">
        {recording && (
          <span className="flex items-center gap-1.5 rounded-full bg-red-600/90 px-2 py-0.5 font-medium">
            <Circle className="h-2.5 w-2.5 animate-pulse fill-current" /> REC {formatTime(elapsed)}
          </span>
        )}
        {uploading && <span className="rounded-full bg-white/20 px-2 py-0.5">Uploading…</span>}
        {settings.voice && <span className="rounded-full bg-white/20 px-2 py-0.5">🎙 voice-paced</span>}
      </div>
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1">
        <IconBtn label="Shortcuts" onClick={() => setShowKeys((v) => !v)} small>
          <Keyboard className="h-4 w-4" />
        </IconBtn>
        <IconBtn label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen} small>
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </IconBtn>
      </div>

      {countdown != null && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
          <div key={countdown} className="fade-up text-8xl font-black text-white drop-shadow-lg">
            {countdown}
          </div>
        </div>
      )}

      {showKeys && (
        <div className="absolute inset-x-3 top-12 z-30 rounded-xl bg-black/85 p-3 text-xs text-white backdrop-blur">
          <div className="mb-1 flex items-center justify-between font-medium">
            Keyboard shortcuts
            <button onClick={() => setShowKeys(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-white/80">
            <span>Space</span><span>play / pause</span>
            <span>↑ / ↓</span><span>speed</span>
            <span>← / →</span><span>previous / next words</span>
            <span>R</span><span>restart</span>
            <span>M</span><span>mirror</span>
            <span>F</span><span>fullscreen</span>
          </div>
        </div>
      )}

      {/* Settings sheet */}
      {showSettings && (
        <div className="scrollbar-thin absolute inset-x-2 bottom-24 z-30 max-h-[62%] space-y-3 overflow-y-auto rounded-xl bg-black/85 p-3 text-xs text-white backdrop-blur">
          <div className="flex items-center justify-between font-medium">
            Prompter settings
            <button onClick={() => setShowSettings(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <Row label="Text comes">
            {(Object.keys(MODE_LABELS) as PrompterMode[]).map((m) => (
              <Pill key={m} active={settings.mode === m} onClick={() => update({ mode: m })} title={MODE_LABELS[m].hint}>
                {MODE_LABELS[m].name}
              </Pill>
            ))}
          </Row>
          <Row label="Speed">
            <button className="rounded-md bg-white/15 p-1" onClick={() => update({ speed: Math.max(1, settings.speed - 5) })} aria-label="Slower">
              <Minus className="h-3.5 w-3.5" />
            </button>
            <input type="range" min={1} max={100} value={settings.speed} onChange={(e) => update({ speed: Number(e.target.value) })} className="flex-1" />
            <button className="rounded-md bg-white/15 p-1" onClick={() => update({ speed: Math.min(100, settings.speed + 5) })} aria-label="Faster">
              <Plus className="h-3.5 w-3.5" />
            </button>
            <span className="w-14 text-right tabular-nums text-white/70">
              {settings.mode === "words" ? `${Math.round(speedFor("words", settings.speed))} wpm` : `${settings.speed}%`}
            </span>
          </Row>
          <Row label="Text size">
            <input type="range" min={14} max={64} value={settings.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} className="flex-1" />
            <span className="w-10 text-right text-white/70">{settings.fontSize}px</span>
          </Row>
          <Row label="Position">
            {(["top", "middle", "bottom"] as PrompterPosition[]).map((p) => (
              <Pill key={p} active={Math.abs(settings.y - positionToY(p, settings.height)) < 0.02} onClick={() => update({ y: positionToY(p, settings.height) })}>
                {p}
              </Pill>
            ))}
            <span className="text-white/60">or drag the bar</span>
          </Row>
          <Row label="Box height">
            <input type="range" min={15} max={90} value={Math.round(settings.height * 100)} onChange={(e) => update({ height: Math.min(1 - settings.y, Number(e.target.value) / 100) })} className="flex-1" />
            <span className="w-10 text-right text-white/70">{Math.round(settings.height * 100)}%</span>
          </Row>
          <Row label="Backdrop">
            <input type="range" min={0} max={100} value={Math.round(settings.opacity * 100)} onChange={(e) => update({ opacity: Number(e.target.value) / 100 })} className="flex-1" />
            <span className="w-10 text-right text-white/70">{Math.round(settings.opacity * 100)}%</span>
          </Row>
          <Row label="Style">
            <Pill active={settings.align === "center"} onClick={() => update({ align: "center" })}>centered</Pill>
            <Pill active={settings.align === "left"} onClick={() => update({ align: "left" })}>left</Pill>
            {(["white", "yellow", "green"] as const).map((c) => (
              <button key={c} onClick={() => update({ color: c })} className={cx("h-5 w-5 rounded-full border-2", settings.color === c ? "border-white" : "border-transparent")} style={{ background: COLOR_HEX[c] }} aria-label={c} />
            ))}
            <Pill active={settings.mirrorH} onClick={() => update({ mirrorH: !settings.mirrorH })}>mirror</Pill>
            <Pill active={settings.flipV} onClick={() => update({ flipV: !settings.flipV })}>flip</Pill>
            <Pill active={settings.guide} onClick={() => update({ guide: !settings.guide })}>guide line</Pill>
            {settings.mode === "scroll" && (
              <Pill active={settings.chunkBreaks} onClick={() => update({ chunkBreaks: !settings.chunkBreaks })}>space after sentences</Pill>
            )}
          </Row>
          {settings.mode === "words" && (
            <Row label="Words at once">
              {[1, 2, 3, 4, 5].map((n) => (
                <Pill key={n} active={settings.wordsPerChunk === n} onClick={() => update({ wordsPerChunk: n })}>
                  {n}
                </Pill>
              ))}
            </Row>
          )}
          <Row label="Countdown">
            {[0, 3, 5].map((n) => (
              <Pill key={n} active={settings.countdown === n} onClick={() => update({ countdown: n })}>
                {n ? `${n}s` : "off"}
              </Pill>
            ))}
          </Row>
          <Row label="Reading">
            <Pill active={settings.voice} onClick={() => update({ voice: !settings.voice })} disabled={!speechPacingSupported()} title={speechPacingSupported() ? "Scroll follows your voice" : "Speech recognition is not supported in this browser"}>
              🎙 voice-paced
            </Pill>
            <Pill active={settings.camera} onClick={() => update({ camera: !settings.camera })}>
              {settings.camera ? "camera on" : "prompter only"}
            </Pill>
          </Row>
          <button className="text-white/60 underline" onClick={() => setSettings({ ...DEFAULT_SETTINGS, camera: settings.camera })}>
            Reset to defaults
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between bg-gradient-to-t from-black/85 to-transparent px-4 pb-4 pt-10 text-white">
        <div className="flex items-center gap-1">
          <IconBtn label="Restart" onClick={restart}>
            <RotateCcw className="h-5 w-5" />
          </IconBtn>
          <IconBtn label={playing ? "Pause prompter" : "Play prompter"} onClick={() => setPlayingBoth(!playing)} active={playing}>
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </IconBtn>
          <div className="ml-1 hidden items-center gap-1 sm:flex">
            <IconBtn label="Slower" onClick={() => update({ speed: Math.max(1, settings.speed - 5) })} small>
              <Minus className="h-4 w-4" />
            </IconBtn>
            <span className="w-8 text-center text-[11px] tabular-nums text-white/80">{settings.speed}</span>
            <IconBtn label="Faster" onClick={() => update({ speed: Math.min(100, settings.speed + 5) })} small>
              <Plus className="h-4 w-4" />
            </IconBtn>
          </div>
        </div>
        <button
          aria-label={recording ? "Stop recording" : "Start recording"}
          disabled={(!ready && settings.camera) || !settings.camera || uploading || countdown != null}
          title={settings.camera ? undefined : "Turn the camera on to record"}
          onClick={recording ? stopRecording : startRecording}
          className={cx(
            "flex h-16 w-16 items-center justify-center rounded-full border-4 border-white transition-transform active:scale-95 disabled:opacity-40",
            recording ? "bg-red-600" : "bg-red-500/90",
          )}
        >
          {recording ? <Square className="h-6 w-6 fill-white" /> : <Circle className="h-7 w-7 fill-white" />}
        </button>
        <div className="flex items-center gap-1">
          <IconBtn label="Prompter settings" onClick={() => setShowSettings((v) => !v)} active={showSettings}>
            <Settings2 className="h-5 w-5" />
          </IconBtn>
          {settings.camera ? (
            <IconBtn label="Flip camera" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} disabled={recording || !mobile} title={mobile ? "Flip camera" : "Camera flip is for phones"}>
              <SwitchCamera className="h-5 w-5" />
            </IconBtn>
          ) : (
            <IconBtn label="Turn camera on" onClick={() => update({ camera: true })}>
              <Camera className="h-5 w-5" />
            </IconBtn>
          )}
          {settings.camera && (
            <IconBtn label="Prompter only" onClick={() => update({ camera: false })} small disabled={recording}>
              <CameraOff className="h-4 w-4" />
            </IconBtn>
          )}
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, label, onClick, active, disabled, small, title }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean; disabled?: boolean; small?: boolean; title?: string }) {
  return (
    <button aria-label={label} title={title || label} onClick={onClick} disabled={disabled} className={cx("rounded-full transition-colors disabled:opacity-40", small ? "p-2" : "p-2.5", active ? "bg-white text-black" : "bg-white/15 text-white hover:bg-white/25")}>
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-white/60">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Pill({ children, active, onClick, disabled, title }: { children: React.ReactNode; active?: boolean; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} className={cx("rounded-lg px-2 py-1 transition-colors disabled:opacity-40", active ? "bg-white text-black" : "bg-white/15 hover:bg-white/25")}>
      {children}
    </button>
  );
}
