import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { paginationRange } from '../lib/tablePagination';

interface TablePaginationProps {
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  placement?: 'top' | 'bottom';
}

export const TablePagination: React.FC<TablePaginationProps> = ({
  page,
  totalItems,
  pageSize,
  onPageChange,
  placement = 'bottom',
}) => {
  const { start, end, totalPages, safePage } = paginationRange(page, totalItems, pageSize);

  if (totalItems === 0) {
    return null;
  }

  return (
    <nav
      className={`table-pagination${placement === 'top' ? ' table-pagination--top' : ''}`}
      aria-label="Pagination"
    >
      <span className="table-pagination-summary">
        {totalItems <= pageSize
          ? `${totalItems} row${totalItems !== 1 ? 's' : ''}`
          : `${start}–${end} of ${totalItems}`}
      </span>
      {totalPages > 1 ? (
        <div className="table-pagination-controls">
          <button
            type="button"
            className="table-pagination-btn"
            onClick={() => onPageChange(safePage - 1)}
            disabled={safePage <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} strokeWidth={2.2} aria-hidden />
          </button>
          <span className="table-pagination-page">
            {safePage}
            <span className="table-pagination-page__sep">/</span>
            {totalPages}
          </span>
          <button
            type="button"
            className="table-pagination-btn"
            onClick={() => onPageChange(safePage + 1)}
            disabled={safePage >= totalPages}
            aria-label="Next page"
          >
            <ChevronRight size={16} strokeWidth={2.2} aria-hidden />
          </button>
        </div>
      ) : null}
    </nav>
  );
};
