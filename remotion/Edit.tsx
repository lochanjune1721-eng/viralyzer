import React, { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, useVideoConfig } from "remotion";
import type { EditCompositionProps } from "./props";
import { FaceVideo } from "./components/FaceVideo";
import { BrollImage } from "./components/BrollImage";
import { CaptionsLayer } from "./components/CaptionsLayer";
import { KineticTitle, LowerThird, ProgressBar } from "./components/Motion";
import { ensureFonts } from "./lib/fonts";

/** One composition, four templates. Everything is driven by props from the server. */
export const Edit: React.FC<EditCompositionProps> = (p) => {
  const { width, height } = useVideoConfig();
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    ensureFonts().finally(() => continueRender(handle));
  }, [handle]);
  const scale = width / 1080;
  const landscape = width > height;
  const visuals = p.effects.broll ? p.visuals : [];

  if (p.template === "split") {
    const faceBottom = p.facePosition === "bottom";
    const half: React.CSSProperties = landscape ? { width: "50%", height: "100%" } : { width: "100%", height: "50%" };
    const facePos: React.CSSProperties = landscape ? { left: faceBottom ? "50%" : 0, top: 0 } : { top: faceBottom ? "50%" : 0, left: 0 };
    const imgPos: React.CSSProperties = landscape ? { left: faceBottom ? 0 : "50%", top: 0 } : { top: faceBottom ? 0 : "50%", left: 0 };
    // captions sit on the face half, near the divider
    const captionY = landscape ? 0.9 : faceBottom ? 0.9 : 0.47;
    return (
      <AbsoluteFill style={{ background: p.brand.bg }}>
        <div style={{ position: "absolute", ...half, ...imgPos, overflow: "hidden", background: "#15151a" }}>
          {visuals.map((v, i) => (
            <BrollImage key={i} visual={v} kenBurns={p.effects.kenBurns} />
          ))}
        </div>
        <div style={{ position: "absolute", ...half, ...facePos, overflow: "hidden" }}>
          <FaceVideo src={p.videoSrc} focusY={p.faceFocusY} cutPoints={p.cutPoints} punchIn={p.effects.punchIn} />
        </div>
        <div
          style={
            landscape
              ? { position: "absolute", left: "50%", top: 0, bottom: 0, width: 6 * scale, transform: "translateX(-50%)", background: "#fff", opacity: 0.9 }
              : { position: "absolute", top: "50%", left: 0, right: 0, height: 6 * scale, transform: "translateY(-50%)", background: "#fff", opacity: 0.9 }
          }
        />
        <CaptionsLayer captions={p.captions} style={p.captionStyle} yFraction={captionY} brand={p.brand} scale={scale * (landscape ? 0.8 : 0.92)} />
        {p.effects.progressBar && <ProgressBar brand={p.brand} scale={scale} />}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ background: p.brand.bg }}>
      <FaceVideo src={p.videoSrc} focusY={p.faceFocusY} cutPoints={p.cutPoints} punchIn={p.effects.punchIn} />
      {p.template === "overlay" && visuals.map((v, i) => <BrollImage key={i} visual={v} kenBurns={p.effects.kenBurns} card brandAccent="#fff" />)}
      {p.template === "motion" && p.effects.titles && p.keyPhrases.map((k, i) => <KineticTitle key={i} phrase={k} index={i} brand={p.brand} scale={scale} yFraction={landscape ? 0.4 : 0.34} />)}
      {p.lowerThird && (p.template === "motion" || p.template === "captions") && (
        <LowerThird {...p.lowerThird} brand={p.brand} scale={scale} yFraction={landscape ? 0.78 : 0.86} />
      )}
      <CaptionsLayer captions={p.captions} style={p.captionStyle} yFraction={landscape ? 0.9 : p.template === "overlay" ? 0.82 : 0.76} brand={p.brand} scale={scale * (landscape ? 0.8 : 1)} />
      {(p.template === "motion" || p.effects.progressBar) && <ProgressBar brand={p.brand} scale={scale} />}
    </AbsoluteFill>
  );
};
