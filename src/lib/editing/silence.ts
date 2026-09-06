import { ffmpegPath, run } from "@/lib/media/ffmpeg";
import { newId } from "@/lib/ids";
import type { EditCut } from "@/lib/types";

// Audio-domain silence detection. Complements the transcript-based pause
// detection so dead air is cut even when transcription is weak or mocked.

export interface Silence {
  start: number;
  end: number;
}

export async function detectSilences(file: string, opts: { noiseDb?: number; minSec?: number } = {}): Promise<Silence[]> {
  const noise = opts.noiseDb ?? -35;
  const minSec = opts.minSec ?? 0.55;
  const res = await run(ffmpegPath(), ["-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=noise=${noise}dB:d=${minSec}`, "-f", "null", "-"], { allowFailure: true });
  const out: Silence[] = [];
  let start: number | null = null;
  const re = /silence_(start|end): ([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(res.stderr))) {
    const t = Number(m[2]);
    if (m[1] === "start") start = t;
    else if (start != null) {
      out.push({ start, end: t });
      start = null;
    }
  }
  return out;
}

/**
 * Turn silences into cuts that do not overlap existing cuts. Leaves `keep`
 * seconds of air on each side so speech never feels clipped.
 */
export function silenceCuts(silences: Silence[], existing: EditCut[], duration: number, keep = 0.18): EditCut[] {
  const cuts: EditCut[] = [];
  for (const s of silences) {
    let ranges: Array<[number, number]> = [[s.start + keep, s.end - keep]];
    for (const c of existing) {
      const next: Array<[number, number]> = [];
      for (const [a, b] of ranges) {
        if (c.end <= a || c.start >= b) next.push([a, b]);
        else {
          if (c.start > a) next.push([a, c.start]);
          if (c.end < b) next.push([c.end, b]);
        }
      }
      ranges = next;
    }
    for (const [a, b] of ranges) {
      if (b - a < 0.25) continue;
      cuts.push({
        id: newId("c"),
        start: +Math.max(0, a).toFixed(3),
        end: +Math.min(duration, b).toFixed(3),
        reason: "pause",
        enabled: true,
        detail: `${(s.end - s.start).toFixed(1)}s silence (audio)`,
      });
    }
  }
  return cuts;
}
