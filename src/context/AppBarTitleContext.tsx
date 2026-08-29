import { createContext, useContext } from 'react';

export const AppBarTitleContext = createContext<
  ((title: string | null) => void) | null
>(null);

export function useSetAppBarTitle() {
  return useContext(AppBarTitleContext);
}
