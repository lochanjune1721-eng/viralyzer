import React from "react";
import { Composition } from "remotion";
import { Edit } from "./Edit";
import { DEFAULT_BRAND, type EditCompositionProps } from "./props";

const defaultProps: EditCompositionProps = {
  template: "captions",
  videoSrc: "media/sample.mp4",
  durationSec: 5,
  fps: 30,
  width: 1080,
  height: 1920,
  facePosition: "bottom",
  faceFocusY: 0.3,
  captions: [],
  captionStyle: "bold",
  visuals: [],
  keyPhrases: [],
  cutPoints: [],
  lowerThird: null,
  effects: { punchIn: true, broll: true, titles: true, progressBar: false, kenBurns: true },
  brand: DEFAULT_BRAND,
};

export const Root: React.FC = () => (
  <Composition
    id="Edit"
    component={Edit}
    durationInFrames={150}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, Math.ceil(props.durationSec * props.fps)),
      fps: props.fps,
      width: props.width,
      height: props.height,
    })}
  />
);
