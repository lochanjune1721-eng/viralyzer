// Pre-bundles the Remotion compositions so the first render does not have to.
// Used by the Dockerfile and Codespaces start script:
//   REMOTION_BUNDLE_DIR=./remotion-bundle npx tsx scripts/remotion-bundle.ts
import { ensureBundle, remotionCapability } from "../src/lib/editing/remotion/renderer";

async function main() {
  const dir = await ensureBundle((m) => console.log(m));
  console.log(`Remotion bundle ready: ${dir}`);
  const cap = remotionCapability();
  console.log(cap.ok ? `Headless browser: ${cap.browser}` : `Note: ${cap.reason} (renders fall back to FFmpeg until then)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
