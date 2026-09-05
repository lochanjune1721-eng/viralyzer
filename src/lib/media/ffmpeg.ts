import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Resolves ffmpeg/ffprobe from FFMPEG_PATH, then PATH. Every render/transcode
// in the app goes through here.

let resolvedFfmpeg: string | null = null;
let resolvedFfprobe: string | null = null;

function which(bin: string): string | null {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, bin);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* continue */
    }
  }
  return null;
}

export function ffmpegPath(): string {
  if (resolvedFfmpeg) return resolvedFfmpeg;
  const candidates = [process.env.FFMPEG_PATH, which("ffmpeg")];
  for (const c of candidates) if (c && fs.existsSync(c)) return (resolvedFfmpeg = c);
  throw new Error("ffmpeg not found. Install ffmpeg or set FFMPEG_PATH.");
}

export function ffprobePath(): string {
  if (resolvedFfprobe) return resolvedFfprobe;
  const candidates = [process.env.FFPROBE_PATH, which("ffprobe")];
  for (const c of candidates) if (c && fs.existsSync(c)) return (resolvedFfprobe = c);
  // No ffprobe: fall back to parsing `ffmpeg -i` output.
  return (resolvedFfprobe = "");
}

export interface MediaInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  rotation: number;
}

export async function probe(file: string): Promise<MediaInfo> {
  const probeBin = ffprobePath();
  if (probeBin) {
    const out = await run(probeBin, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      file,
    ]);
    const json = JSON.parse(out.stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
        avg_frame_rate?: string;
        duration?: string;
        side_data_list?: Array<{ rotation?: number }>;
        tags?: { rotate?: string };
      }>;
    };
    const video = json.streams?.find((s) => s.codec_type === "video");
    const audio = json.streams?.find((s) => s.codec_type === "audio");
    const fpsStr = video?.avg_frame_rate && video.avg_frame_rate !== "0/0" ? video.avg_frame_rate : video?.r_frame_rate;
    const fps = fpsStr ? evalFraction(fpsStr) : 30;
    let rotation = 0;
    const sd = video?.side_data_list?.find((s) => typeof s.rotation === "number");
    if (sd?.rotation) rotation = sd.rotation;
    else if (video?.tags?.rotate) rotation = Number(video.tags.rotate) || 0;
    const duration = Number(json.format?.duration) || Number(video?.duration) || 0;
    return {
      duration,
      width: video?.width || 0,
      height: video?.height || 0,
      fps: fps || 30,
      hasAudio: !!audio,
      rotation,
    };
  }
  // Fallback: parse ffmpeg stderr
  const res = await run(ffmpegPath(), ["-i", file], { allowFailure: true });
  const text = res.stderr;
  const dur = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(text);
  const dim = /Video:.* (\d{2,5})x(\d{2,5})/.exec(text);
  const fpsM = /(\d+(?:\.\d+)?) fps/.exec(text);
  return {
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
    width: dim ? Number(dim[1]) : 0,
    height: dim ? Number(dim[2]) : 0,
    fps: fpsM ? Number(fpsM[1]) : 30,
    hasAudio: /Audio:/.test(text),
    rotation: 0,
  };
}

function evalFraction(s: string): number {
  const [a, b] = s.split("/").map(Number);
  if (!b) return a || 0;
  return a / b;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function run(
  bin: string,
  args: string[],
  opts: { allowFailure?: boolean; onProgress?: (seconds: number) => void; cwd?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      if (opts.onProgress) {
        // -progress pipe:1 emits key=value lines; out_time_us is microseconds.
        const m = /out_time_us=(\d+)/g;
        let match: RegExpExecArray | null;
        let last: number | null = null;
        while ((match = m.exec(s))) last = Number(match[1]) / 1e6;
        if (last == null) {
          const m2 = /out_time_ms=(\d+)/g;
          while ((match = m2.exec(s))) last = Number(match[1]) / 1e6;
        }
        if (last != null) opts.onProgress(last);
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !opts.allowFailure) {
        reject(new Error(`${path.basename(bin)} exited with ${code}: ${stderr.slice(-2000)}`));
      } else resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

/** Run ffmpeg with progress reporting relative to an expected output duration. */
export async function ffmpeg(
  args: string[],
  opts: { expectedDuration?: number; onProgress?: (fraction: number) => void } = {},
): Promise<RunResult> {
  const fullArgs = ["-hide_banner", "-y", "-nostats", "-progress", "pipe:1", ...args];
  return run(ffmpegPath(), fullArgs, {
    onProgress: (sec) => {
      if (opts.onProgress && opts.expectedDuration && opts.expectedDuration > 0) {
        opts.onProgress(Math.min(0.99, sec / opts.expectedDuration));
      }
    },
  });
}

/** Escape a value for use inside an ffmpeg filter option (e.g. subtitles=filename). */
export function escapeFilterPath(p: string): string {
  // Filter-graph level escaping: backslash, quote, colon, brackets, comma and semicolon.
  return p
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Normalize any browser/phone upload into a predictable H.264/AAC mp4 with
 * even dimensions, applied rotation metadata, 30fps and stereo audio.
 */
export async function normalizeVideo(
  input: string,
  output: string,
  opts: { maxHeight?: number; onProgress?: (f: number) => void; expectedDuration?: number } = {},
): Promise<void> {
  const maxH = opts.maxHeight || 1920;
  const info = await probe(input).catch(() => null);
  const vf = `scale='if(gt(iw,ih),min(iw,${maxH}),-2)':'if(gt(iw,ih),-2,min(ih,${maxH}))',scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30,format=yuv420p`;
  const args = ["-i", input, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart"];
  if (info && !info.hasAudio) {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-shortest", "-map", "0:v:0", "-map", "1:a:0");
  } else {
    args.push("-map", "0:v:0", "-map", "0:a:0?");
  }
  args.push("-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", output);
  await ffmpeg(args, { expectedDuration: opts.expectedDuration || info?.duration, onProgress: opts.onProgress });
}

/** Extract mono 16k wav for speech-to-text. */
export async function extractAudio(input: string, output: string): Promise<void> {
  await ffmpeg(["-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output]);
}
