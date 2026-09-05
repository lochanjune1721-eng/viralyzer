"use client";

import { Circle, FlipHorizontal2, Mic, MicOff, Pause, Play, RotateCcw, Square, SwitchCamera, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx, formatTime } from "@/components/ui";
import { speechPacingSupported, useSpeechPacing } from "./useSpeechPacing";

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

export function Teleprompter({ script, onRecorded, uploading }: { script: string; onRecorded: (r: RecordingResult) => void; uploading: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const offsetRef = useRef(0);
  const targetRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);

  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [camError, setCamError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const [speed, setSpeed] = useState(38); // px per second
  const [fontSize, setFontSize] = useState(26);
  const [mirrorText, setMirrorText] = useState(false);
  const [voice, setVoice] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const words = useMemo(() => script.split(/\s+/).filter(Boolean), [script]);
  const { wordIndex, reset: resetVoice } = useSpeechPacing(words, voice && (recording || scrolling));
  const mobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ---- camera ----
  const startCamera = useCallback(async () => {
    setCamError(null);
    setReady(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
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
  }, [startCamera]);

  // ---- teleprompter scroll loop ----
  useEffect(() => {
    const step = (ts: number) => {
      const dt = lastTsRef.current ? (ts - lastTsRef.current) / 1000 : 0;
      lastTsRef.current = ts;
      const el = textRef.current;
      const box = scrollRef.current;
      if (el && box) {
        const max = Math.max(0, el.scrollHeight - box.clientHeight * 0.4);
        if (voice && targetRef.current != null) {
          // ease toward the spoken word
          offsetRef.current += (targetRef.current - offsetRef.current) * Math.min(1, dt * 4);
        } else if (scrolling) {
          offsetRef.current += speed * dt;
        }
        offsetRef.current = Math.max(0, Math.min(max, offsetRef.current));
        el.style.transform = `translateY(${-offsetRef.current}px)`;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = 0;
    };
  }, [scrolling, speed, voice]);

  // voice pacing: aim the prompter at the last spoken word
  useEffect(() => {
    if (!voice) {
      targetRef.current = null;
      return;
    }
    const idx = Math.min(words.length - 1, Math.max(0, wordIndex - 1));
    const span = wordRefs.current[idx];
    const box = scrollRef.current;
    if (span && box) targetRef.current = Math.max(0, span.offsetTop - box.clientHeight * 0.3);
  }, [wordIndex, voice, words.length]);

  const restart = () => {
    offsetRef.current = 0;
    targetRef.current = null;
    resetVoice();
  };

  // ---- recording ----
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((Date.now() - startedAtRef.current) / 1000), 250);
    return () => clearInterval(t);
  }, [recording]);

  function startRecording() {
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
      setScrolling(false);
      if (blob.size > 0) onRecorded({ blob, mimeType: type, durationSec });
    };
    recorderRef.current = rec;
    startedAtRef.current = Date.now();
    setElapsed(0);
    rec.start(1000);
    setRecording(true);
    restart();
    setScrolling(true);
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  const activeIdx = voice ? wordIndex : -1;

  return (
    <div className="relative mx-auto w-full max-w-[440px] overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: "9 / 16", maxHeight: "calc(100dvh - 13rem)" }}>
      <video ref={videoRef} autoPlay muted playsInline className={cx("absolute inset-0 h-full w-full object-cover", facing === "user" && "scale-x-[-1]")} />
      {camError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white">
          <div>{camError}</div>
          <button className="rounded-lg bg-white/15 px-3 py-1.5" onClick={startCamera}>
            Try again
          </button>
        </div>
      )}

      {/* Teleprompter overlay, positioned near the lens so eye contact reads naturally */}
      <div ref={scrollRef} className="absolute inset-x-0 top-0 h-[46%] overflow-hidden bg-gradient-to-b from-black/80 via-black/60 to-transparent">
        <div className="pointer-events-none absolute inset-x-0 top-[30%] h-px bg-white/20" />
        <div ref={textRef} className={cx("px-5 pt-[30%] pb-[60%] text-center font-semibold leading-snug text-white", mirrorText && "scale-x-[-1]")} style={{ fontSize, textShadow: "0 1px 4px rgba(0,0,0,.8)" }}>
          {words.map((w, i) => (
            <span
              key={i}
              ref={(el) => {
                wordRefs.current[i] = el;
              }}
              className={cx("inline-block", i < activeIdx ? "text-white/45" : i === activeIdx ? "text-[#ffe16a]" : "")}
            >
              {w}&nbsp;
            </span>
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="absolute left-3 top-3 flex items-center gap-2 text-xs text-white">
        {recording && (
          <span className="flex items-center gap-1.5 rounded-full bg-red-600/90 px-2 py-0.5 font-medium">
            <Circle className="h-2.5 w-2.5 animate-pulse fill-current" /> REC {formatTime(elapsed)}
          </span>
        )}
        {uploading && <span className="rounded-full bg-white/20 px-2 py-0.5">Uploading…</span>}
      </div>

      {/* Settings sheet */}
      {showSettings && (
        <div className="absolute inset-x-3 bottom-24 space-y-3 rounded-xl bg-black/75 p-3 text-xs text-white backdrop-blur">
          <label className="flex items-center gap-3">
            <span className="w-16">Speed</span>
            <input type="range" min={10} max={120} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="flex-1" />
          </label>
          <label className="flex items-center gap-3">
            <span className="w-16">Text size</span>
            <input type="range" min={16} max={44} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="flex-1" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className={cx("flex items-center gap-1 rounded-lg px-2 py-1", mirrorText ? "bg-white text-black" : "bg-white/15")} onClick={() => setMirrorText((v) => !v)}>
              <FlipHorizontal2 className="h-3.5 w-3.5" /> Mirror text
            </button>
            <button
              className={cx("flex items-center gap-1 rounded-lg px-2 py-1", voice ? "bg-white text-black" : "bg-white/15", !speechPacingSupported() && "opacity-40")}
              disabled={!speechPacingSupported()}
              onClick={() => setVoice((v) => !v)}
              title={speechPacingSupported() ? "Scroll follows your voice" : "Speech recognition not supported in this browser"}
            >
              {voice ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />} Voice-paced
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-8 text-white">
        <div className="flex items-center gap-1">
          <IconBtn label="Restart" onClick={restart}>
            <RotateCcw className="h-5 w-5" />
          </IconBtn>
          <IconBtn label={scrolling ? "Pause scroll" : "Play scroll"} onClick={() => setScrolling((v) => !v)}>
            {scrolling ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </IconBtn>
        </div>
        <button
          aria-label={recording ? "Stop recording" : "Start recording"}
          disabled={!ready || uploading}
          onClick={recording ? stopRecording : startRecording}
          className={cx(
            "flex h-16 w-16 items-center justify-center rounded-full border-4 border-white transition-transform active:scale-95 disabled:opacity-40",
            recording ? "bg-red-600" : "bg-red-500/90",
          )}
        >
          {recording ? <Square className="h-6 w-6 fill-white" /> : <Circle className="h-7 w-7 fill-white" />}
        </button>
        <div className="flex items-center gap-1">
          <IconBtn label="Text settings" onClick={() => setShowSettings((v) => !v)} active={showSettings}>
            <Type className="h-5 w-5" />
          </IconBtn>
          <IconBtn label="Flip camera" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} disabled={recording || (!mobile && false)}>
            <SwitchCamera className="h-5 w-5" />
          </IconBtn>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, label, onClick, active, disabled }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} disabled={disabled} className={cx("rounded-full p-2.5 transition-colors disabled:opacity-40", active ? "bg-white text-black" : "bg-white/15 hover:bg-white/25")}>
      {children}
    </button>
  );
}
