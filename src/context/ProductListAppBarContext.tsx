import { createContext, useContext } from 'react';

export type ProductListAppBarChrome = {
  onAdd: () => void;
};

export const ProductListAppBarContext = createContext<
  ((chrome: ProductListAppBarChrome | null) => void) | null
>(null);

export function useSetProductListAppBar() {
  return useContext(ProductListAppBarContext);
}
