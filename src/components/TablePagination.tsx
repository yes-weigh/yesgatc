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
    <div className={`table-pagination${placement === 'top' ? ' table-pagination--top' : ''}`}>
      <span className="table-pagination-summary text-muted text-sm">
        {totalItems <= pageSize
          ? `${totalItems} row${totalItems !== 1 ? 's' : ''}`
          : `Showing ${start}–${end} of ${totalItems}`}
      </span>
      {totalPages > 1 && (
        <div className="table-pagination-controls">
          <button
            type="button"
            className="btn btn-secondary btn-sm table-pagination-btn"
            onClick={() => onPageChange(safePage - 1)}
            disabled={safePage <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
            Prev
          </button>
          <span className="table-pagination-page text-sm">
            Page {safePage} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm table-pagination-btn"
            onClick={() => onPageChange(safePage + 1)}
            disabled={safePage >= totalPages}
            aria-label="Next page"
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
};
