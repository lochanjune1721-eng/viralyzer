import type { AspectId, CaptionStyleId, CaptionWord } from "@/lib/types";

// Generates ASS subtitle files. Captions are word-synced: each event shows a
// small group of words with the currently spoken word highlighted. The same
// generator also produces the kinetic-typography layer for the motion format.

export interface CaptionStylePreset {
  id: CaptionStyleId;
  name: string;
  description: string;
  font: string;
  fontSize: number; // relative to a 1080px-wide frame
  primary: string; // &HAABBGGRR
  active: string;
  outline: string;
  back: string;
  outlineWidth: number;
  shadow: number;
  borderStyle: 1 | 3; // 1 outline, 3 opaque box
  uppercase: boolean;
  activeScale: number; // percent
}

export const CAPTION_STYLES: CaptionStylePreset[] = [
  {
    id: "bold",
    name: "Bold",
    description: "Big white words, thick outline, yellow highlight",
    font: "Montserrat ExtraBold",
    fontSize: 78,
    primary: "&H00FFFFFF",
    active: "&H0000E5FF",
    outline: "&H00000000",
    back: "&H80000000",
    outlineWidth: 5,
    shadow: 2,
    borderStyle: 1,
    uppercase: true,
    activeScale: 112,
  },
  {
    id: "boxed",
    name: "Boxed",
    description: "Words on a dark pill, active word in accent colour",
    font: "Montserrat ExtraBold",
    fontSize: 64,
    primary: "&H00FFFFFF",
    active: "&H007A5CFF",
    outline: "&HA0000000",
    back: "&HA0000000",
    outlineWidth: 14,
    shadow: 0,
    borderStyle: 3,
    uppercase: false,
    activeScale: 100,
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Clean sentence-case captions with a soft shadow",
    font: "Montserrat SemiBold",
    fontSize: 58,
    primary: "&H00F5F5F5",
    active: "&H00FFFFFF",
    outline: "&H00000000",
    back: "&H60000000",
    outlineWidth: 2,
    shadow: 3,
    borderStyle: 1,
    uppercase: false,
    activeScale: 106,
  },
  {
    id: "neon",
    name: "Neon",
    description: "Electric green active word with a glow",
    font: "Montserrat ExtraBold",
    fontSize: 72,
    primary: "&H00FFFFFF",
    active: "&H0060FF39",
    outline: "&H00200A40",
    back: "&H80000000",
    outlineWidth: 4,
    shadow: 4,
    borderStyle: 1,
    uppercase: true,
    activeScale: 115,
  },
];

export function captionStyle(id: CaptionStyleId): CaptionStylePreset {
  return CAPTION_STYLES.find((s) => s.id === id) || CAPTION_STYLES[0];
}

export function frameSize(aspect: AspectId): { w: number; h: number } {
  switch (aspect) {
    case "1:1":
      return { w: 1080, h: 1080 };
    case "16:9":
      return { w: 1920, h: 1080 };
    default:
      return { w: 1080, h: 1920 };
  }
}

function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${secs.toFixed(2).padStart(5, "0")}`;
}

export function assEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");
}

export interface CaptionGroup {
  words: CaptionWord[];
  start: number;
  end: number;
}

/** Group words into caption lines of ~3-4 words that never span a long pause. */
export function groupWords(words: CaptionWord[], maxWords = 4, maxChars = 22): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (cur.length) groups.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (prev && (w.start - prev.end > 0.9 || cur.length >= maxWords || chars > maxChars || /[.!?]$/.test(prev.text))) flush();
    cur.push(w);
  }
  flush();
  return groups;
}

export interface CaptionLayout {
  /** vertical position of the caption baseline as a fraction of frame height */
  yFraction: number;
  marginLR: number;
}

export function buildCaptionAss(
  words: CaptionWord[],
  styleId: CaptionStyleId,
  aspect: AspectId,
  layout: CaptionLayout = { yFraction: 0.78, marginLR: 60 },
  extraEvents: string[] = [],
): string {
  const style = captionStyle(styleId);
  const { w, h } = frameSize(aspect);
  const scale = w / 1080;
  const fontSize = Math.round(style.fontSize * scale * (aspect === "16:9" ? 0.8 : 1));
  const marginV = Math.round(h - h * layout.yFraction);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${style.font},${fontSize},${style.primary},${style.active},${style.outline},${style.back},-1,0,0,0,100,100,0,0,${style.borderStyle},${Math.round(style.outlineWidth * scale)},${Math.round(style.shadow * scale)},2,${Math.round(layout.marginLR * scale)},${Math.round(layout.marginLR * scale)},${marginV},1
Style: Kinetic,Montserrat ExtraBold,${Math.round(110 * scale)},&H00FFFFFF,&H0000E5FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.round(6 * scale)},${Math.round(3 * scale)},5,${Math.round(60 * scale)},${Math.round(60 * scale)},0,1
Style: Lower,Montserrat SemiBold,${Math.round(40 * scale)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,1,${Math.round(70 * scale)},${Math.round(60 * scale)},${Math.round(h * 0.11)},1
Style: LowerTitle,Montserrat ExtraBold,${Math.round(54 * scale)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,1,${Math.round(70 * scale)},${Math.round(60 * scale)},${Math.round(h * 0.11 + 46 * scale)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events: string[] = [];
  const groups = groupWords(words);
  for (const g of groups) {
    for (let k = 0; k < g.words.length; k++) {
      const word = g.words[k];
      const start = word.start;
      const end = k + 1 < g.words.length ? g.words[k + 1].start : g.end + 0.15;
      if (end <= start) continue;
      const text = g.words
        .map((x, idx) => {
          const t = assEscape(style.uppercase ? x.text.toUpperCase() : x.text);
          if (idx === k) {
            return `{\\c${style.active}\\fscx${style.activeScale}\\fscy${style.activeScale}}${t}{\\r}`;
          }
          return t;
        })
        .join(" ");
      const pop = k === 0 ? `{\\fad(60,0)}` : "";
      events.push(`Dialogue: 1,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${pop}${text}`);
    }
  }
  return header + [...extraEvents, ...events].join("\n") + "\n";
}

/**
 * Kinetic typography + lower third events for the motion-design format.
 * Key phrases pop in at the centre when they are spoken; the lower third shows
 * the creator's name for the first seconds.
 */
export function motionEvents(
  words: CaptionWord[],
  keyPhrases: string[],
  aspect: AspectId,
  lowerThird: { name: string; subtitle: string } | null,
): string[] {
  const { w, h } = frameSize(aspect);
  const events: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const tokens = words.map((x) => norm(x.text));
  const used = new Set<number>();
  for (const phrase of keyPhrases) {
    const p = phrase.split(/\s+/).map(norm).filter(Boolean);
    if (!p.length) continue;
    for (let i = 0; i + p.length <= tokens.length; i++) {
      if (used.has(i)) continue;
      let ok = true;
      for (let k = 0; k < p.length; k++) if (tokens[i + k] !== p[k]) { ok = false; break; }
      if (!ok) continue;
      const start = words[i].start;
      const end = Math.max(words[i + p.length - 1].end + 0.6, start + 1.2);
      for (let k = 0; k < p.length; k++) used.add(i + k);
      const cx = Math.round(w / 2);
      const cy = Math.round(h * (aspect === "16:9" ? 0.42 : 0.36));
      const angle = ((i % 3) - 1) * 3; // -3, 0, 3 degrees for a playful tilt
      const text = assEscape(phrase.toUpperCase());
      events.push(
        `Dialogue: 2,${assTime(start)},${assTime(end)},Kinetic,,0,0,0,,{\\an5\\pos(${cx},${cy})\\frz${angle}\\fscx60\\fscy60\\alpha&H40&\\t(0,140,\\fscx100\\fscy100\\alpha&H00&)\\t(${Math.round((end - start) * 1000 - 200)},${Math.round((end - start) * 1000)},\\alpha&HFF&)\\bord${Math.round(8 * (w / 1080))}\\3c&H000000&\\c&H00E5FF&}${text}`,
      );
      break;
    }
  }
  if (lowerThird) {
    const start = 0.6;
    const end = Math.min(5.5, Math.max(3, (words[words.length - 1]?.end || 5) - 0.5));
    const s = w / 1080;
    const barX = Math.round(50 * s);
    const barY = Math.round(h * 0.89 - 130 * s);
    const barW = Math.round(Math.min(w - 100 * s, 640 * s));
    const barH = Math.round(150 * s);
    // accent bar + dark panel drawn with ASS vector commands
    events.push(
      `Dialogue: 0,${assTime(start)},${assTime(end)},Lower,,0,0,0,,{\\an7\\pos(${barX},${barY})\\fad(200,250)\\1c&H1A1A1A&\\1a&H30&\\bord0\\shad0\\p1}m 0 0 l ${barW} 0 l ${barW} ${barH} l 0 ${barH}{\\p0}`,
    );
    events.push(
      `Dialogue: 0,${assTime(start)},${assTime(end)},Lower,,0,0,0,,{\\an7\\pos(${barX},${barY})\\fad(200,250)\\1c&H00E5FF&\\bord0\\shad0\\p1}m 0 0 l ${Math.round(14 * s)} 0 l ${Math.round(14 * s)} ${barH} l 0 ${barH}{\\p0}`,
    );
    events.push(
      `Dialogue: 1,${assTime(start)},${assTime(end)},LowerTitle,,0,0,0,,{\\an7\\pos(${barX + Math.round(36 * s)},${barY + Math.round(22 * s)})\\fad(250,250)}${assEscape(lowerThird.name)}`,
    );
    events.push(
      `Dialogue: 1,${assTime(start)},${assTime(end)},Lower,,0,0,0,,{\\an7\\pos(${barX + Math.round(36 * s)},${barY + Math.round(88 * s)})\\fad(250,250)\\1c&HD0D0D0&}${assEscape(lowerThird.subtitle)}`,
    );
  }
  return events;
}
