import { detectCuts, keepRanges, buildCaptionWords, outputDuration } from "../src/lib/editing/cleanup";
import type { TranscriptWord } from "../src/lib/types";

// Build a synthetic transcript: lead silence, sentence 1 with a false start,
// sentence 2 said twice (first with a filler), a long pause, sentence 3, tail.
const script = `GPT-6 just launched and everyone is wrong about it. The model nobody is talking about matters more. Here is why that changes your workflow on Monday.`;
const words: TranscriptWord[] = [];
let t = 1.2;
function say(text: string, opts: { gapAfter?: number; wps?: number } = {}) {
  const wps = opts.wps ?? 2.6;
  for (const w of text.split(" ")) {
    const d = 1 / wps;
    words.push({ text: w, start: +t.toFixed(2), end: +(t + d * 0.85).toFixed(2) });
    t += d;
  }
  t += opts.gapAfter ?? 0.3;
}
say("GPT-6 just launched and", { gapAfter: 0.9 }); // false start
say("GPT-6 just launched and everyone is wrong about it.", { gapAfter: 0.8 });
say("The model um nobody is talking about matters more.", { gapAfter: 0.5 });
say("no wait", { gapAfter: 0.6 });
say("The model nobody is talking about matters more.", { gapAfter: 2.4 }); // long pause after
say("Here is why that changes your workflow on Monday.", { gapAfter: 0 });
const duration = t + 2.5;
const res = detectCuts(words, duration, script);
for (const c of res.cuts) console.log(c.reason.padEnd(12), c.start.toFixed(2), "->", c.end.toFixed(2), c.detail);
console.log("stats", res.stats);
const keeps = keepRanges(duration, res.cuts);
console.log("keeps", keeps.map((k) => `${k.start.toFixed(2)}-${k.end.toFixed(2)}`).join(", "), "out", outputDuration(keeps).toFixed(2), "of", duration.toFixed(2));
const caps = buildCaptionWords(words, keeps);
console.log("captions:", caps.map((c) => c.text).join(" "));
console.log(words.filter(w => w.end > 6.5 && w.end < 8).map(w => `${w.text}@${w.start}-${w.end}`).join(" "));
