import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Info } from 'lucide-react';
import { InlineFormPanel } from './InlineFormPanel';
import { ListViewBackBar } from './ListViewBackBar';
import { ProductSerialBankOverlay } from './ProductSerialBankOverlay';
import { useSetAppBarTitle } from '../context/AppBarTitleContext';
import { CalcLabel, UploadField } from '../pages/admin/productFormUi';
import { PasTag } from './ProductShopMedia';
import {
  computeProductDerived,
  formatDerivedDisplay,
  parseProductNumber,
  PRODUCT_CALC_TOOLTIPS,
} from '../lib/productCalculations';
import { specFormRowsFromProduct, type SpecFormRow } from '../lib/productSpecifications';
import type { ProductFileMeta } from '../lib/productApprovalUpload';
import type { Product } from '../types';

function derivedForRow(row: SpecFormRow) {
  const maxNum = parseProductNumber(row.maximumCapacity);
  const eNum = parseProductNumber(row.verificationScaleInterval);
  const hasInputs = row.maximumCapacity !== '' && row.verificationScaleInterval !== '';
  const derived = computeProductDerived(maxNum, eNum);
  return {
    minimumCapacity: formatDerivedDisplay(derived.minimumCapacity, hasInputs),
    actualScaleInterval: formatDerivedDisplay(derived.actualScaleInterval, hasInputs),
    noOfVerificationIntervals: formatDerivedDisplay(
      derived.noOfVerificationIntervals,
      hasInputs,
    ),
  };
}

function fileFromProductImage(product: Product): ProductFileMeta | null {
  if (!product.productImageUrl && !product.productImagePath) return null;
  return {
    url: product.productImageUrl || '',
    path: product.productImagePath || '',
    name: product.productImageName || 'Product image',
    contentType: product.productImageContentType || 'image/jpeg',
  };
}

function fileFromApprovalDoc(product: Product): ProductFileMeta | null {
  if (!product.modelApprovalDocUrl && !product.modelApprovalDocPath) return null;
  return {
    url: product.modelApprovalDocUrl || '',
    path: product.modelApprovalDocPath || '',
    name: product.modelApprovalDocName || 'Model approval document',
    contentType: product.modelApprovalDocContentType || 'application/pdf',
  };
}

const noopChange = () => undefined;

export const ProductViewPanel: React.FC<{
  product: Product;
  onClose: () => void;
}> = ({ product, onClose }) => {
  const setAppBarTitle = useSetAppBarTitle();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const specRows = useMemo(() => specFormRowsFromProduct(product), [product]);
  const productImage = fileFromProductImage(product);
  const approvalDoc = fileFromApprovalDoc(product);
  const [serialOpen, setSerialOpen] = useState(false);

  useEffect(() => {
    if (!setAppBarTitle) return;
    setAppBarTitle(product.name.trim() || 'Product');
    return () => setAppBarTitle(null);
  }, [setAppBarTitle, product.name]);

  return (
    <InlineFormPanel
      id="rc-product-detail"
      plain
      className="inline-form-panel--wide inline-form-panel--product-edit"
    >
      <div className="product-form-panel">
        <ListViewBackBar
          onBack={onClose}
          trailing={
            <div className="product-form-view-actions">
              <button
                type="button"
                className="product-form-edit-toggle"
                onClick={() => setSerialOpen(true)}
                aria-label="View serials"
                title="View serials"
              >
                <Eye size={18} strokeWidth={2} />
              </button>
            </div>
          }
        />
        <form
          className="product-form product-form--admin-edit"
          aria-label="Product details"
          onSubmit={e => e.preventDefault()}
        >
          <div className="product-form-body">
            <div className="product-form-flat product-form-flat--admin">
              <section className="product-edit-section" aria-label="Identity">
                <div className="product-form-grid product-form-grid--basic">
                  <div className="form-group mb-0">
                    <label htmlFor="rc-pf-modelid">Model ID *</label>
                    <input
                      id="rc-pf-modelid"
                      type="text"
                      className="input-field"
                      value={product.modelid || ''}
                      readOnly
                    />
                  </div>
                  <div className="form-group mb-0">
                    <label htmlFor="rc-pf-modelno">Model No</label>
                    <input
                      id="rc-pf-modelno"
                      type="text"
                      className="input-field"
                      value={product.modelNo || ''}
                      readOnly
                    />
                  </div>
                  <div className="form-group mb-0 product-form-span-sku">
                    <label htmlFor="rc-pf-yesone-sku">Yesone SKU</label>
                    <input
                      id="rc-pf-yesone-sku"
                      type="text"
                      className="input-field"
                      value={product.yesoneSku || ''}
                      readOnly
                    />
                  </div>
                  {product.pasPreAllotted ? (
                    <div className="form-group mb-0 product-form-span-pas">
                      <PasTag />
                    </div>
                  ) : null}
                  <div className="form-group mb-0 product-form-span-name">
                    <label htmlFor="rc-pf-name">Product Name *</label>
                    <input
                      id="rc-pf-name"
                      type="text"
                      className="input-field"
                      value={product.name || ''}
                      readOnly
                    />
                  </div>
                  <div className="product-form-unit-approval">
                    <div className="form-group mb-0 product-form-span-unit">
                      <label htmlFor="rc-pf-unit">Unit</label>
                      <select
                        id="rc-pf-unit"
                        className="input-field"
                        value={product.unitOfMeasurement || 'kg'}
                        disabled
                      >
                        <option value="kg">kg</option>
                        <option value="g">g</option>
                      </select>
                    </div>
                    <div className="form-group mb-0 product-form-span-approval">
                      <label htmlFor="rc-pf-approval-no">Approval No</label>
                      <input
                        id="rc-pf-approval-no"
                        type="text"
                        className="input-field"
                        value={product.modelApprovalNo || ''}
                        readOnly
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="product-edit-section" aria-label="Specifications">
                <div className="product-form-flat-row-title product-spec-section-head">
                  <span>
                    Specifications <Info size={12} className="inline-icon-sm" aria-hidden />
                  </span>
                </div>
                <div className="product-spec-rows">
                  {specRows.map((row, index) => {
                    const derived = derivedForRow(row);
                    return (
                      <div key={row.localId} className="product-spec-row">
                        {specRows.length > 1 ? (
                          <div className="product-spec-row-head">
                            <span className="product-spec-row-label">Spec {index + 1}</span>
                          </div>
                        ) : null}
                        <div className="product-form-grid product-form-grid--scale">
                          <div className="form-group mb-0 product-form-scale-field--blue">
                            <label htmlFor={`rc-pf-max-${row.localId}`}>Max</label>
                            <input
                              id={`rc-pf-max-${row.localId}`}
                              type="text"
                              className="input-field"
                              value={row.maximumCapacity}
                              readOnly
                            />
                          </div>
                          <div className="form-group mb-0 product-form-scale-field--blue">
                            <label htmlFor={`rc-pf-e-${row.localId}`}>e</label>
                            <input
                              id={`rc-pf-e-${row.localId}`}
                              type="text"
                              className="input-field"
                              value={row.verificationScaleInterval}
                              readOnly
                            />
                          </div>
                          <div className="form-group mb-0 product-form-scale-field--blue">
                            <label htmlFor={`rc-pf-mpe-${row.localId}`}>MPE</label>
                            <input
                              id={`rc-pf-mpe-${row.localId}`}
                              type="text"
                              className="input-field"
                              value={row.maximumPermissibleError}
                              readOnly
                            />
                          </div>
                          <div className="form-group mb-0 calc-field product-form-scale-field--green">
                            <CalcLabel label="Min" tooltip={PRODUCT_CALC_TOOLTIPS.minimumCapacity} />
                            <input
                              type="text"
                              className="input-field input-readonly"
                              value={derived.minimumCapacity}
                              readOnly
                              tabIndex={-1}
                            />
                          </div>
                          <div className="form-group mb-0 calc-field product-form-scale-field--green">
                            <CalcLabel label="d" tooltip={PRODUCT_CALC_TOOLTIPS.actualScaleInterval} />
                            <input
                              type="text"
                              className="input-field input-readonly"
                              value={derived.actualScaleInterval}
                              readOnly
                              tabIndex={-1}
                            />
                          </div>
                          <div className="form-group mb-0 calc-field product-form-scale-field--green">
                            <CalcLabel
                              label="n"
                              tooltip={PRODUCT_CALC_TOOLTIPS.noOfVerificationIntervals}
                            />
                            <input
                              type="text"
                              className="input-field input-readonly"
                              value={derived.noOfVerificationIntervals}
                              readOnly
                              tabIndex={-1}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="product-edit-section" aria-label="Files">
                <div className="product-form-grid product-form-grid--files">
                  <UploadField
                    label="Image"
                    hint="Optional"
                    compact
                    iconActions
                    variant="image"
                    readOnly
                    file={productImage}
                    uploading={false}
                    progress={0}
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    uploadLabel="Upload photo"
                    formats="Max 15 MB"
                    inputRef={imageInputRef}
                    onSelect={noopChange}
                    onRemove={noopChange}
                    submitting
                  />
                  <UploadField
                    label="Approval doc"
                    hint="PDF / image"
                    compact
                    iconActions
                    variant="document"
                    readOnly
                    file={approvalDoc}
                    uploading={false}
                    progress={0}
                    accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
                    uploadLabel="Upload document"
                    formats="Max 15 MB"
                    inputRef={fileInputRef}
                    onSelect={noopChange}
                    onRemove={noopChange}
                    submitting
                  />
                </div>
              </section>
            </div>
          </div>

          <div className="product-form-footer product-form-footer--admin-edit">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </form>
      </div>
      {serialOpen ? (
        <ProductSerialBankOverlay product={product} onClose={() => setSerialOpen(false)} />
      ) : null}
    </InlineFormPanel>
  );
};
