"use client";

// Teleprompter settings, persisted per browser so the prompter is ready the
// moment it opens, with or without a project.

export type PrompterMode = "scroll" | "ticker-rtl" | "ticker-ltr" | "words";
export type PrompterPosition = "top" | "middle" | "bottom";

export interface PrompterSettings {
  mode: PrompterMode;
  speed: number; // 1..100, mapped per mode
  fontSize: number; // px
  y: number; // top of the prompter box as a fraction of the frame height (0..0.8)
  height: number; // fraction of the frame height (0.15..0.9)
  align: "left" | "center";
  mirrorH: boolean; // mirror text for teleprompter glass
  flipV: boolean;
  opacity: number; // backdrop opacity 0..1
  color: "white" | "yellow" | "green";
  wordsPerChunk: number; // words mode
  countdown: number; // seconds before recording starts
  camera: boolean;
  voice: boolean;
  guide: boolean; // reading guide line
  chunkBreaks: boolean; // extra spacing between sentences in scroll mode
}

export const DEFAULT_SETTINGS: PrompterSettings = {
  mode: "scroll",
  speed: 30,
  fontSize: 28,
  y: 0,
  height: 0.46,
  align: "center",
  mirrorH: false,
  flipV: false,
  opacity: 0.7,
  color: "white",
  wordsPerChunk: 3,
  countdown: 3,
  camera: true,
  voice: false,
  guide: true,
  chunkBreaks: false,
};

const KEY = "vz.prompter.v1";

export function loadSettings(): PrompterSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<PrompterSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: PrompterSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function positionToY(p: PrompterPosition, height: number): number {
  if (p === "top") return 0;
  if (p === "middle") return Math.max(0, 0.5 - height / 2);
  return Math.max(0, 1 - height - 0.14);
}

/** Map the 1..100 speed slider to the unit each mode needs. */
export function speedFor(mode: PrompterMode, speed: number): number {
  switch (mode) {
    case "scroll":
      return 10 + speed * 1.5; // px per second (11.5 .. 160)
    case "ticker-rtl":
    case "ticker-ltr":
      return 40 + speed * 4; // px per second (44 .. 440)
    case "words":
      return 60 + speed * 3; // words per minute (63 .. 360)
  }
}

export const MODE_LABELS: Record<PrompterMode, { name: string; hint: string }> = {
  scroll: { name: "Scroll up", hint: "Classic prompter, text rolls upward" },
  "ticker-rtl": { name: "Ticker ←", hint: "One line moving right to left" },
  "ticker-ltr": { name: "Ticker →", hint: "One line moving left to right" },
  words: { name: "Word by word", hint: "A few big words at a time" },
};

export const COLOR_HEX: Record<PrompterSettings["color"], string> = {
  white: "#ffffff",
  yellow: "#ffe16a",
  green: "#7dffb0",
};
