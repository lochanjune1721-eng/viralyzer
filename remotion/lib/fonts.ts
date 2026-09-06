import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

let loaded: Promise<void> | null = null;

/** Montserrat is bundled under public/fonts so renders never depend on the network. */
export function ensureFonts(): Promise<void> {
  if (!loaded) {
    loaded = Promise.all([
      loadFont({ family: "Montserrat", url: staticFile("fonts/Montserrat-ExtraBold.ttf"), weight: "800" }),
      loadFont({ family: "Montserrat", url: staticFile("fonts/Montserrat-SemiBold.ttf"), weight: "600" }),
    ]).then(() => undefined);
  }
  return loaded;
}
