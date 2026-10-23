// True once the component is running in the browser, false during server
// rendering and hydration. Lets client-only UI render after mount without
// setting state inside an effect.

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function useIsClient(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
