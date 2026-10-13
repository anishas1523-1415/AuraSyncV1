import { registerRoot, Composition } from "remotion";
import { Promo, PROMO_FRAMES, FPS } from "./Promo";

function Root() {
  return (
    <>
      <Composition id="AuraSynqPromo" component={Promo} width={1080} height={1920} fps={FPS} durationInFrames={PROMO_FRAMES} />
    </>
  );
}

registerRoot(Root);
