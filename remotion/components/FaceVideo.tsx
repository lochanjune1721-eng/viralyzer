import React from "react";
import { AbsoluteFill, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * The creator's footage, cover-fitted into its box, with an optional
 * "punch-in": the scale alternates 1.0 / 1.08 at every cut so jump cuts read
 * as intentional camera moves.
 */
export const FaceVideo: React.FC<{
  src: string;
  focusY: number;
  cutPoints: number[];
  punchIn: boolean;
  muted?: boolean;
}> = ({ src, focusY, cutPoints, punchIn, muted = true }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  let scale = 1;
  if (punchIn && cutPoints.length) {
    let segment = 0;
    let segStart = 0;
    for (const c of cutPoints) {
      if (t >= c) {
        segment += 1;
        segStart = c;
      }
    }
    const target = segment % 2 === 1 ? 1.08 : 1;
    const from = segment % 2 === 1 ? 1 : 1.08;
    const p = spring({ frame: frame - Math.round(segStart * fps), fps, config: { damping: 200, stiffness: 120 } });
    scale = segment === 0 ? 1 : interpolate(p, [0, 1], [from, target]);
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <OffthreadVideo
        src={staticFile(src)}
        muted={muted}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: `50% ${Math.round(focusY * 100)}%`,
          transform: `scale(${scale})`,
          transformOrigin: `50% ${Math.round(focusY * 100)}%`,
        }}
      />
    </AbsoluteFill>
  );
};
