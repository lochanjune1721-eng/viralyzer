import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionStyleId, CaptionWordProp, Brand } from "../props";
import { activeGroup, activeWordIndex, groupWords } from "../lib/timing";

/** Word-synced captions: the current group is shown, the spoken word pops. */
export const CaptionsLayer: React.FC<{
  captions: CaptionWordProp[];
  style: CaptionStyleId;
  yFraction: number; // baseline position as a fraction of the height
  brand: Brand;
  scale: number; // 1 at 1080px wide
}> = ({ captions, style, yFraction, brand, scale }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const groups = React.useMemo(() => groupWords(captions), [captions]);
  const group = activeGroup(groups, t);
  if (!group) return null;
  const idx = activeWordIndex(group, t);
  const wordFrame = frame - Math.round(group.words[idx].start * fps);
  const pop = spring({ frame: wordFrame, fps, config: { damping: 12, stiffness: 260, mass: 0.5 } });
  const enter = interpolate(frame - Math.round(group.start * fps), [0, 4], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });

  const base: React.CSSProperties = {
    fontFamily: "Montserrat, Arial, sans-serif",
    fontWeight: 800,
    fontSize: 78 * scale,
    lineHeight: 1.15,
    textAlign: "center",
    color: brand.text,
    letterSpacing: 0.5,
  };
  const preset = presets(style, brand, scale);
  const upper = style === "bold" || style === "neon";
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: `${yFraction * 100}%`,
        transform: "translateY(-100%)",
        padding: `0 ${60 * scale}px`,
        display: "flex",
        justifyContent: "center",
        opacity: enter,
      }}
    >
      <div style={{ ...base, ...preset.box, maxWidth: width - 120 * scale }}>
        {group.words.map((w, i) => {
          const active = i === idx;
          const s = active ? interpolate(pop, [0, 1], [0.85, preset.activeScale]) : 1;
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                margin: `0 ${9 * scale}px`,
                transform: `scale(${s})`,
                color: active ? preset.activeColor : brand.text,
                ...preset.text,
                ...(active ? preset.activeText : {}),
              }}
            >
              {upper ? w.text.toUpperCase() : w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

function presets(style: CaptionStyleId, brand: Brand, scale: number): { box: React.CSSProperties; text: React.CSSProperties; activeText: React.CSSProperties; activeColor: string; activeScale: number } {
  const stroke = (px: number, color: string): React.CSSProperties => ({
    WebkitTextStroke: `${px * scale}px ${color}`,
    paintOrder: "stroke fill",
    textShadow: `0 ${3 * scale}px ${8 * scale}px rgba(0,0,0,.6)`,
  });
  switch (style) {
    case "boxed":
      return {
        box: { background: "rgba(10,10,14,.82)", borderRadius: 18 * scale, padding: `${14 * scale}px ${26 * scale}px`, fontSize: 64 * scale },
        text: {},
        activeText: {},
        activeColor: "#c4a7ff",
        activeScale: 1.04,
      };
    case "minimal":
      return {
        box: { fontWeight: 600, fontSize: 58 * scale, textShadow: `0 ${2 * scale}px ${10 * scale}px rgba(0,0,0,.85)` },
        text: {},
        activeText: { fontWeight: 800 },
        activeColor: "#ffffff",
        activeScale: 1.06,
      };
    case "neon":
      return {
        box: {},
        text: stroke(4, "#200a40"),
        activeText: { textShadow: `0 0 ${18 * scale}px #39ff60, 0 0 ${36 * scale}px #39ff60` },
        activeColor: "#39ff60",
        activeScale: 1.15,
      };
    default:
      return {
        box: {},
        text: stroke(6, "#000"),
        activeText: {},
        activeColor: brand.highlight,
        activeScale: 1.12,
      };
  }
}
