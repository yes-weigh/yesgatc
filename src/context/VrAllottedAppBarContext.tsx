import { createContext, useContext } from 'react';

export type VrAllottedAppBarChrome = {
  onAllot: () => void;
  allotOpen?: boolean;
};

export const VrAllottedAppBarContext = createContext<
  ((chrome: VrAllottedAppBarChrome | null) => void) | null
>(null);

export function useSetVrAllottedAppBar() {
  return useContext(VrAllottedAppBarContext);
}
