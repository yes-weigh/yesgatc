import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { FilterIcon } from './FilterIcon';
import {
  DEFAULT_PRODUCT_LIST_FILTERS,
  isProductListFilterActive,
  type ProductApprovalLayout,
  type ProductListFilterState,
  type ProductSpecFilterOption,
  type ProductStatusFilter,
} from '../lib/productListFilters';

type ProductListFiltersProps = {
  value: ProductListFilterState;
  onChange: (next: ProductListFilterState) => void;
  modelApprovalOptions: string[];
  modelNoOptions: string[];
  specOptions: ProductSpecFilterOption[];
};

export const ProductListFilters: React.FC<ProductListFiltersProps> = ({
  value,
  onChange,
  modelApprovalOptions,
  modelNoOptions,
  specOptions,
}) => {
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const filterRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<{ mobile: HTMLElement | null; desktop: HTMLElement | null }>({
    mobile: null,
    desktop: null,
  });

  const filterActive = isProductListFilterActive(value);

  useLayoutEffect(() => {
    setSlots({
      mobile: document.getElementById('product-filter-slot-mobile'),
      desktop: document.getElementById('product-filter-slot-desktop'),
    });
  }, []);

  useEffect(() => {
    if (!filterOpen) return;
    setDraft(value);
  }, [filterOpen, value]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target;
      if (filterRef.current?.contains(target as Node)) return;
      if (target instanceof HTMLElement && (target.tagName === 'OPTION' || target.closest('select'))) {
        return;
      }
      setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [filterOpen]);

  const patchDraft = <K extends keyof ProductListFilterState>(
    key: K,
    next: ProductListFilterState[K],
  ) => {
    setDraft(prev => ({ ...prev, [key]: next }));
  };

  const filterControl = (
    <div className="verification-app-filter product-list-filter" ref={filterRef}>
      <button
        type="button"
        className={`verification-app-filter__btn${filterOpen || filterActive ? ' verification-app-filter__btn--on' : ''}`}
        aria-label="Filter products"
        aria-expanded={filterOpen}
        onClick={() => setFilterOpen(open => !open)}
      >
        <FilterIcon size={18} />
      </button>
      {filterOpen ? (
        <div className="verification-app-filter__pop" role="dialog" aria-label="Product filters">
          <div className="verification-app-filter__head">
            <p className="verification-app-filter__title">Filters</p>
            <button
              type="button"
              className="verification-app-filter__close"
              onClick={() => setFilterOpen(false)}
              aria-label="Close filters"
            >
              <X size={16} strokeWidth={2.2} aria-hidden />
            </button>
          </div>

          <div className="verification-app-filter__body">
            <label className="verification-app-filter__label" htmlFor="product-filter-approval">
              Model approval
            </label>
            <div className="verification-app-filter__select-wrap">
              <select
                id="product-filter-approval"
                className="verification-app-filter__select"
                value={draft.modelApproval}
                onChange={e => patchDraft('modelApproval', e.target.value)}
              >
                <option value="all">All</option>
                {modelApprovalOptions.map(opt => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <label className="verification-app-filter__label" htmlFor="product-filter-approval-layout">
              Approval view
            </label>
            <div className="verification-app-filter__select-wrap">
              <select
                id="product-filter-approval-layout"
                className="verification-app-filter__select"
                value={draft.approvalLayout}
                onChange={e =>
                  patchDraft('approvalLayout', e.target.value as ProductApprovalLayout)
                }
              >
                <option value="list">List</option>
                <option value="group">Group</option>
              </select>
            </div>

            <label className="verification-app-filter__label" htmlFor="product-filter-spec">
              Spec
            </label>
            <div className="verification-app-filter__select-wrap">
              <select
                id="product-filter-spec"
                className="verification-app-filter__select"
                value={draft.spec}
                onChange={e => patchDraft('spec', e.target.value)}
              >
                <option value="all">All</option>
                {specOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="verification-app-filter__label" htmlFor="product-filter-modelno">
              Model number
            </label>
            <div className="verification-app-filter__select-wrap">
              <select
                id="product-filter-modelno"
                className="verification-app-filter__select"
                value={draft.modelNo}
                onChange={e => patchDraft('modelNo', e.target.value)}
              >
                <option value="all">All</option>
                {modelNoOptions.map(opt => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <label className="verification-app-filter__label" htmlFor="product-filter-status">
              Status
            </label>
            <div className="verification-app-filter__select-wrap">
              <select
                id="product-filter-status"
                className="verification-app-filter__select"
                value={draft.status}
                onChange={e => patchDraft('status', e.target.value as ProductStatusFilter)}
              >
                <option value="active">Active</option>
                <option value="inactive">Deactive</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>

          <div className="verification-app-filter__foot">
            <button
              type="button"
              className="verification-app-filter__clear"
              onClick={() => {
                onChange(DEFAULT_PRODUCT_LIST_FILTERS);
                setDraft(DEFAULT_PRODUCT_LIST_FILTERS);
                setFilterOpen(false);
              }}
            >
              Reset
            </button>
            <button
              type="button"
              className="verification-app-filter__apply"
              onClick={() => {
                onChange(draft);
                setFilterOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );

  const slot = slots.mobile ?? slots.desktop;
  if (slot) return createPortal(filterControl, slot);
  return null;
};
