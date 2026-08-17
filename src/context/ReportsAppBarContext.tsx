import { createContext, useContext } from 'react';

export type ReportsAppBarChrome = {
  title: string;
  period: string;
  onShare?: () => void;
  sharing?: boolean;
};

export const ReportsAppBarContext = createContext<
  ((chrome: ReportsAppBarChrome | null) => void) | null
>(null);

export function useSetReportsAppBar() {
  return useContext(ReportsAppBarContext);
}
