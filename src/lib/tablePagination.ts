export const VERIFICATION_TABLE_PAGE_SIZE = 30;

export function getTotalPages(totalItems: number, pageSize: number): number {
  if (totalItems <= 0) return 1;
  return Math.ceil(totalItems / pageSize);
}

export function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 1;
  return Math.min(Math.max(1, page), totalPages);
}

export function paginateItems<T>(items: T[], page: number, pageSize: number): T[] {
  const totalPages = getTotalPages(items.length, pageSize);
  const safePage = clampPage(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function paginationRange(
  page: number,
  totalItems: number,
  pageSize: number,
): { start: number; end: number; totalPages: number; safePage: number } {
  const totalPages = getTotalPages(totalItems, pageSize);
  const safePage = clampPage(page, totalPages);
  if (totalItems === 0) {
    return { start: 0, end: 0, totalPages, safePage };
  }
  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, totalItems);
  return { start, end, totalPages, safePage };
}
