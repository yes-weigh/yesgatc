import { createContext, useContext } from 'react';

export type RcListAppBarChrome = {
  onRegister: () => void;
};

export const RcListAppBarContext = createContext<
  ((chrome: RcListAppBarChrome | null) => void) | null
>(null);

export function useSetRcListAppBar() {
  return useContext(RcListAppBarContext);
}
