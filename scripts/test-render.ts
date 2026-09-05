import fs from "node:fs";
import path from "node:path";
process.env.STORAGE_DIR = process.env.STORAGE_DIR || "/tmp/vz-test-storage";
import { run, ffmpegPath, probe } from "../src/lib/media/ffmpeg";
import { projectDir, relPath, absPath } from "../src/lib/storage";
import { renderVideo } from "../src/lib/editing/render";
import { mockTranscript } from "../src/lib/editing/transcribe";
import { detectCuts, keepRanges, buildCaptionWords } from "../src/lib/editing/cleanup";
import type { Visual, FormatId, AspectId } from "../src/lib/types";

async function main() {
  const pid = "ptest";
  const dir = projectDir(pid, "edit");
  const src = path.join(dir, "source.mp4");
  // 12s synthetic talking-head stand-in: colour bars + a 440Hz tone with silence gaps
  await run(ffmpegPath(), [
    "-y", "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "12", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-pix_fmt", "yuv420p", src,
  ]);
  const imgDir = projectDir(pid, "visuals");
  const imgs: string[] = [];
  for (const [i, c] of ["red", "blue", "green"].entries()) {
    const p = path.join(imgDir, `img${i}.jpg`);
    await run(ffmpegPath(), ["-y", "-f", "lavfi", "-i", `color=c=${c}:size=800x500`, "-frames:v", "1", "-update", "1", p]);
    imgs.push(relPath(p));
  }
  const info = await probe(src);
  const script = "GPT-6 just launched and everyone is wrong about it. The model nobody is talking about matters more. Here is why that changes your workflow on Monday morning.";
  const transcript = mockTranscript(script, info.duration);
  const res = detectCuts(transcript.words, info.duration, script);
  res.cuts.push({ id: "manual", start: 4, end: 5.5, reason: "retake", enabled: true });
  const keeps = keepRanges(info.duration, res.cuts);
  const captions = buildCaptionWords(transcript.words, keeps);
  const total = captions[captions.length - 1].end;
  const visuals: Visual[] = imgs.map((f, i) => ({
    id: `v${i}`, start: (total / 3) * i, end: (total / 3) * (i + 1), query: "q", concept: "c", imageUrl: null, file: f,
  }));
  const combos: Array<[FormatId, AspectId]> = [["split", "9:16"], ["overlay", "9:16"], ["captions", "9:16"], ["motion", "9:16"], ["split", "16:9"], ["overlay", "1:1"]];
  for (const [format, aspect] of combos) {
    const t0 = Date.now();
    let lastP = 0;
    const out = await renderVideo({
      projectId: pid, sourceFile: relPath(src), sourceDuration: info.duration, cuts: res.cuts, captions,
      captionStyle: format === "motion" ? "neon" : format === "overlay" ? "boxed" : "bold", format, aspect, visuals,
      keyPhrases: ["GPT-6", "nobody is talking about", "Monday morning"],
      lowerThird: { name: "@creator", subtitle: "Tech creator" },
      onProgress: (f) => { lastP = f; },
    });
    const oi = await probe(absPath(out.file));
    console.log(format, aspect, "->", out.file, `${oi.width}x${oi.height}`, `${oi.duration.toFixed(2)}s (expected ${out.durationSec.toFixed(2)})`, `${((Date.now() - t0) / 1000).toFixed(1)}s`, "lastProgress", lastP.toFixed(2));
  }
  // Extract a frame from each for visual inspection
  const renders = fs.readdirSync(absPath("projects/ptest/renders")).filter((f) => f.endsWith(".mp4"));
  for (const r of renders) {
    const png = "/tmp/vz-test-storage/" + r.replace(".mp4", ".png");
    await run(ffmpegPath(), ["-y", "-ss", "2.5", "-i", absPath("projects/ptest/renders/" + r), "-frames:v", "1", "-update", "1", "-vf", "scale=360:-2", png]);
    console.log("frame", png);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
