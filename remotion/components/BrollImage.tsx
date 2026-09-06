import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { VisualProp } from "../props";

/** B-roll image that springs in, drifts slowly (Ken Burns) and fades out. */
export const BrollImage: React.FC<{
  visual: VisualProp;
  kenBurns: boolean;
  card?: boolean; // overlay style: rounded card with border and shadow
  brandAccent?: string;
}> = ({ visual, kenBurns, card, brandAccent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const local = frame - Math.round(visual.start * fps);
  const total = Math.max(1, Math.round((visual.end - visual.start) * fps));
  if (t < visual.start || t > visual.end) return null;
  const enter = spring({ frame: local, fps, config: { damping: 18, stiffness: 140, mass: 0.7 } });
  const exit = interpolate(local, [total - 8, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const drift = kenBurns ? interpolate(local, [0, total], [1, 1.07], { extrapolateRight: "clamp" }) : 1;
  const opacity = Math.min(enter, exit);
  if (card) {
    return (
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: "34%",
          width: "64%",
          aspectRatio: "16 / 10",
          transform: `translate(-50%, ${interpolate(enter, [0, 1], [60, 0])}px) scale(${interpolate(enter, [0, 1], [0.9, 1])})`,
          opacity,
          borderRadius: 24,
          overflow: "hidden",
          border: `6px solid ${brandAccent || "#fff"}`,
          boxShadow: "0 30px 60px rgba(0,0,0,.45)",
          background: "#111",
        }}
      >
        <Img src={staticFile(visual.src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${drift})` }} />
      </div>
    );
  }
  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
      <Img src={staticFile(visual.src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${drift * interpolate(enter, [0, 1], [1.06, 1])})` }} />
    </AbsoluteFill>
  );
};
