// Props for the Remotion compositions. Plain types only: this file is shared
// with the server (type-only import) and must not import app code.

export type TemplateId = "split" | "overlay" | "captions" | "motion";
export type CaptionStyleId = "bold" | "boxed" | "minimal" | "neon";

export interface CaptionWordProp {
  text: string;
  start: number; // seconds on the output timeline
  end: number;
}

export interface VisualProp {
  src: string; // path relative to the bundle root, resolved with staticFile()
  start: number;
  end: number;
  concept?: string;
}

export interface KeyPhraseProp {
  text: string;
  start: number;
  end: number;
}

export interface Brand {
  accent: string;
  highlight: string;
  text: string;
  bg: string;
}

export type EditCompositionProps = {
  template: TemplateId;
  videoSrc: string; // relative to bundle root
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  facePosition: "top" | "bottom";
  faceFocusY: number; // 0..1 vertical anchor when the face is cover-cropped
  captions: CaptionWordProp[];
  captionStyle: CaptionStyleId;
  visuals: VisualProp[];
  keyPhrases: KeyPhraseProp[];
  cutPoints: number[]; // output-time starts of kept ranges (excluding 0)
  lowerThird: { name: string; subtitle: string; start: number; end: number } | null;
  effects: { punchIn: boolean; broll: boolean; titles: boolean; progressBar: boolean; kenBurns: boolean };
  brand: Brand;
};

export const DEFAULT_BRAND: Brand = { accent: "#ff5a3c", highlight: "#ffe16a", text: "#ffffff", bg: "#0f0f12" };
