import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Brand, KeyPhraseProp } from "../props";

/** Big kinetic title that lands when a key phrase is spoken. */
export const KineticTitle: React.FC<{ phrase: KeyPhraseProp; index: number; brand: Brand; scale: number; yFraction: number }> = ({ phrase, index, brand, scale, yFraction }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (t < phrase.start || t > phrase.end) return null;
  const local = frame - Math.round(phrase.start * fps);
  const total = Math.round((phrase.end - phrase.start) * fps);
  const enter = spring({ frame: local, fps, config: { damping: 14, stiffness: 180, mass: 0.6 } });
  const exit = interpolate(local, [total - 6, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tilt = ((index % 3) - 1) * 3;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: `${yFraction * 100}%`,
        transform: `translate(-50%, -50%) rotate(${tilt}deg) scale(${interpolate(enter, [0, 1], [0.6, 1])})`,
        opacity: Math.min(enter, exit),
        background: brand.accent,
        color: "#fff",
        fontFamily: "Montserrat, Arial, sans-serif",
        fontWeight: 800,
        fontSize: 96 * scale,
        lineHeight: 1.05,
        textTransform: "uppercase",
        padding: `${18 * scale}px ${40 * scale}px`,
        borderRadius: 22 * scale,
        boxShadow: `0 ${24 * scale}px ${50 * scale}px rgba(0,0,0,.45)`,
        maxWidth: "88%",
        textAlign: "center",
      }}
    >
      {phrase.text}
    </div>
  );
};

export const LowerThird: React.FC<{ name: string; subtitle: string; start: number; end: number; brand: Brand; scale: number; yFraction: number }> = ({ name, subtitle, start, end, brand, scale, yFraction }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (t < start || t > end) return null;
  const local = frame - Math.round(start * fps);
  const total = Math.round((end - start) * fps);
  const enter = spring({ frame: local, fps, config: { damping: 20, stiffness: 160 } });
  const exit = interpolate(local, [total - 10, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: 50 * scale,
        top: `${yFraction * 100}%`,
        transform: `translateX(${interpolate(enter, [0, 1], [-80, 0])}px)`,
        opacity: Math.min(enter, exit),
        display: "flex",
        alignItems: "stretch",
        background: "rgba(16,16,20,.82)",
        borderRadius: 16 * scale,
        overflow: "hidden",
        fontFamily: "Montserrat, Arial, sans-serif",
        color: "#fff",
        maxWidth: "80%",
      }}
    >
      <div style={{ width: 12 * scale, background: brand.accent }} />
      <div style={{ padding: `${16 * scale}px ${28 * scale}px` }}>
        <div style={{ fontWeight: 800, fontSize: 52 * scale, lineHeight: 1.1 }}>{name}</div>
        <div style={{ fontWeight: 600, fontSize: 34 * scale, opacity: 0.85, marginTop: 4 * scale }}>{subtitle}</div>
      </div>
    </div>
  );
};

export const ProgressBar: React.FC<{ brand: Brand; scale: number }> = ({ brand, scale }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 10 * scale, background: "rgba(255,255,255,.15)" }}>
      <div style={{ width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`, height: "100%", background: brand.accent }} />
    </div>
  );
};
