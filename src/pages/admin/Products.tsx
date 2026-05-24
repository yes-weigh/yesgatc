import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { adminProductMeta } from '../../lib/productAccess';
import { PackagePlus, Trash2, Pencil, X, Image as ImageIcon, Plus, Save, ExternalLink, Info } from 'lucide-react';
import { getModalPortalRoot, lockModalHostScroll } from '../../lib/modalPortal';
import { CalcLabel, DefaultsStrip, UploadField } from './productFormUi';
import type { Product } from '../../types';
import {
  PRODUCT_CALC_TOOLTIPS,
  computeProductDerived,
  formatDerivedDisplay,
  parseProductNumber,
} from '../../lib/productCalculations';
import {
  deleteProductStorageFile,
  uploadModelApprovalDoc,
  uploadProductImage,
  type ProductFileMeta,
} from '../../lib/productApprovalUpload';

const INITIAL_STATE = {
  modelid: '',
  modelNo: '',
  name: '',
  typeOfInstrument: 'Electronic',
  manufacturerBrandSeries: 'YESWEIGH',
  accuracyClass: 'III',
  maximumCapacity: '',
  verificationScaleInterval: '',
  unitOfMeasurement: 'kg' as 'kg' | 'g',
  maximumPermissibleError: '',
  supplyVoltage: '230 V AC',
  modelApprovalNo: '',
};

export const Products: React.FC = () => {
  const { products, addProduct, updateProduct, deleteProduct } = useAppContext();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [formData, setFormData] = useState(INITIAL_STATE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalDoc, setApprovalDoc] = useState<ProductFileMeta | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [productImage, setProductImage] = useState<ProductFileMeta | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUploadProgress, setImageUploadProgress] = useState(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const formBusy = submitting || uploadingDoc || uploadingImage;

  const canUploadFiles = formData.modelid.trim().length > 0;
  const canUploadApprovalDoc =
    canUploadFiles && formData.modelApprovalNo.trim().length > 0;

  const maxNum = parseProductNumber(formData.maximumCapacity);
  const eNum = parseProductNumber(formData.verificationScaleInterval);
  const hasScaleInputs =
    formData.maximumCapacity !== '' && formData.verificationScaleInterval !== '';

  const derived = useMemo(
    () => computeProductDerived(maxNum, eNum),
    [maxNum, eNum],
  );

  const derivedDisplay = {
    minimumCapacity: formatDerivedDisplay(derived.minimumCapacity, hasScaleInputs),
    actualScaleInterval: formatDerivedDisplay(derived.actualScaleInterval, hasScaleInputs),
    noOfVerificationIntervals: formatDerivedDisplay(
      derived.noOfVerificationIntervals,
      hasScaleInputs,
    ),
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleStartAdd = () => {
    setEditingId(null);
    setFormData(INITIAL_STATE);
    setApprovalDoc(null);
    setProductImage(null);
    setUploadProgress(0);
    setImageUploadProgress(0);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
    setShowForm(true);
  };

  const handleEditClick = (product: Product) => {
    setShowForm(true);
    setEditingId(product.id);
    setFormData({
      modelid: product.modelid || '',
      modelNo: product.modelNo || '',
      name: product.name || '',
      typeOfInstrument: product.typeOfInstrument || 'Electronic',
      manufacturerBrandSeries: product.manufacturerBrandSeries || 'YESWEIGH',
      accuracyClass: product.accuracyClass || 'III',
      maximumCapacity:
        product.maximumCapacity !== undefined && product.maximumCapacity !== null
          ? String(product.maximumCapacity)
          : '',
      verificationScaleInterval:
        product.verificationScaleInterval !== undefined &&
        product.verificationScaleInterval !== null
          ? String(product.verificationScaleInterval)
          : '',
      unitOfMeasurement: product.unitOfMeasurement || 'kg',
      maximumPermissibleError:
        product.maximumPermissibleError !== undefined && product.maximumPermissibleError !== null
          ? String(product.maximumPermissibleError)
          : '',
      supplyVoltage: product.supplyVoltage || '230 V AC',
      modelApprovalNo: product.modelApprovalNo || '',
    });
    if (product.modelApprovalDocUrl && product.modelApprovalDocPath) {
      setApprovalDoc({
        url: product.modelApprovalDocUrl,
        path: product.modelApprovalDocPath,
        name: product.modelApprovalDocName || 'Model approval document',
        contentType: product.modelApprovalDocContentType || 'application/pdf',
      });
    } else {
      setApprovalDoc(null);
    }
    if (product.productImageUrl && product.productImagePath) {
      setProductImage({
        url: product.productImageUrl,
        path: product.productImagePath,
        name: product.productImageName || 'Product image',
        contentType: product.productImageContentType || 'image/jpeg',
      });
    } else {
      setProductImage(null);
    }
    setUploadProgress(0);
    setImageUploadProgress(0);
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setShowForm(false);
    setFormData(INITIAL_STATE);
    setApprovalDoc(null);
    setProductImage(null);
    setUploadProgress(0);
    setImageUploadProgress(0);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handleOverlayClose = () => {
    if (formBusy) return;
    handleCancelEdit();
  };

  useEffect(() => {
    if (!showForm) return;
    return lockModalHostScroll();
  }, [showForm]);

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleOverlayClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm, formBusy]);

  const handleApprovalFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!canUploadApprovalDoc) {
      setError('Enter Model ID and Model Approval No before uploading.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setError(null);
    setUploadingDoc(true);
    setUploadProgress(0);

    try {
      const previousPath = approvalDoc?.path;
      const meta = await uploadModelApprovalDoc(
        formData.modelid,
        file,
        pct => setUploadProgress(pct),
      );
      setApprovalDoc(meta);
      if (previousPath && previousPath !== meta.path) {
        try {
          await deleteProductStorageFile(previousPath);
        } catch {
          /* ignore orphan cleanup failures */
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingDoc(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleProductImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!canUploadFiles) {
      setError('Enter Model ID before uploading a product image.');
      if (imageInputRef.current) imageInputRef.current.value = '';
      return;
    }

    setError(null);
    setUploadingImage(true);
    setImageUploadProgress(0);

    try {
      const previousPath = productImage?.path;
      const meta = await uploadProductImage(
        formData.modelid,
        file,
        pct => setImageUploadProgress(pct),
      );
      setProductImage(meta);
      if (previousPath && previousPath !== meta.path) {
        try {
          await deleteProductStorageFile(previousPath);
        } catch {
          /* ignore */
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleRemoveProductImage = async () => {
    if (!productImage) return;
    const ok = await confirm({
      title: 'Remove image?',
      message: 'Remove the product image?',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    setUploadingImage(true);
    try {
      await deleteProductStorageFile(productImage.path);
      setProductImage(null);
      setImageUploadProgress(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove image');
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    const label = product.name || product.modelid;
    const ok = await confirm({
      title: 'Delete product?',
      message: `Delete product "${label}" (Model ID: ${product.modelid})?\nThis cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    try {
      if (product.modelApprovalDocPath) {
        try {
          await deleteProductStorageFile(product.modelApprovalDocPath);
        } catch {
          /* storage cleanup is best-effort */
        }
      }
      if (product.productImagePath) {
        try {
          await deleteProductStorageFile(product.productImagePath);
        } catch {
          /* storage cleanup is best-effort */
        }
      }
      await deleteProduct(product.id);
      if (editingId === product.id) {
        handleCancelEdit();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete product');
    }
  };

  const handleRemoveApprovalDoc = async () => {
    if (!approvalDoc) return;
    const ok = await confirm({
      title: 'Remove document?',
      message: 'Remove the uploaded model approval document?',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    setUploadingDoc(true);
    try {
      await deleteProductStorageFile(approvalDoc.path);
      setApprovalDoc(null);
      setUploadProgress(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete document');
    } finally {
      setUploadingDoc(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.modelid) {
      setError('Product Name and Model ID are required.');
      return;
    }

    if (products.some(p => p.modelid === formData.modelid && p.id !== editingId)) {
      setError('Model ID must be unique. A product with this Model ID already exists.');
      return;
    }

    if (!hasScaleInputs) {
      setError('Maximum Capacity and Verification Scale Interval (e) are required.');
      return;
    }

    if (eNum <= 0) {
      setError('Verification Scale Interval (e) must be greater than zero.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const computed = computeProductDerived(maxNum, eNum);
      const productData = {
        modelid: formData.modelid,
        modelNo: formData.modelNo,
        name: formData.name,
        typeOfInstrument: formData.typeOfInstrument,
        manufacturerBrandSeries: formData.manufacturerBrandSeries,
        accuracyClass: formData.accuracyClass,
        maximumCapacity: maxNum,
        verificationScaleInterval: eNum,
        minimumCapacity: computed.minimumCapacity,
        actualScaleInterval: computed.actualScaleInterval,
        noOfVerificationIntervals: computed.noOfVerificationIntervals,
        unitOfMeasurement: formData.unitOfMeasurement,
        maximumPermissibleError: Number(formData.maximumPermissibleError) || 0,
        supplyVoltage: formData.supplyVoltage,
        modelApprovalNo: formData.modelApprovalNo,
        ...(approvalDoc
          ? {
              modelApprovalDocUrl: approvalDoc.url,
              modelApprovalDocPath: approvalDoc.path,
              modelApprovalDocName: approvalDoc.name,
              modelApprovalDocContentType: approvalDoc.contentType,
            }
          : {
              modelApprovalDocUrl: '',
              modelApprovalDocPath: '',
              modelApprovalDocName: '',
              modelApprovalDocContentType: '',
            }),
        ...(productImage
          ? {
              productImageUrl: productImage.url,
              productImagePath: productImage.path,
              productImageName: productImage.name,
              productImageContentType: productImage.contentType,
            }
          : {
              productImageUrl: '',
              productImagePath: '',
              productImageName: '',
              productImageContentType: '',
            }),
      };

      if (editingId) {
        const existing = products.find(p => p.id === editingId);
        await updateProduct(editingId, {
          ...productData,
          ...(existing?.managedByRole ? {} : user?.uid ? adminProductMeta(user.uid) : {}),
        });
      } else {
        await addProduct({
          ...productData,
          ...(user?.uid ? adminProductMeta(user.uid) : {}),
        });
      }
      setFormData(INITIAL_STATE);
      setEditingId(null);
      setShowForm(false);
      setApprovalDoc(null);
      setProductImage(null);
      setUploadProgress(0);
      setImageUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (imageInputRef.current) imageInputRef.current.value = '';
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save product');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fade-in max-w-6xl mx-auto">
      <div className="panel glass mb-6">
        <div className="panel-header justify-between">
          <h2>Configured Products</h2>
          <button
            type="button"
            className="btn btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
            onClick={handleStartAdd}
          >
            <Plus size={16} /> Add Product
          </button>
        </div>
        <div className="panel-body p-0 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="product-table-image-col">Image</th>
                <th>Model ID</th>
                <th>Model No</th>
                <th>Product Name</th>
                <th>Model Approval No</th>
                <th>Maximum Capacity</th>
                <th>View Approval</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td className="product-table-image-col">
                    {p.productImageUrl ? (
                      <a
                        href={p.productImageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View product image"
                      >
                        <img
                          src={p.productImageUrl}
                          alt={p.name}
                          className="product-table-thumb"
                        />
                      </a>
                    ) : (
                      <span className="product-table-thumb-placeholder" title="No image">
                        <ImageIcon size={18} />
                      </span>
                    )}
                  </td>
                  <td className="font-medium text-mono">{p.modelid}</td>
                  <td className="text-mono">{p.modelNo || '—'}</td>
                  <td className="font-medium">{p.name}</td>
                  <td className="text-mono text-sm">{p.modelApprovalNo || '—'}</td>
                  <td>
                    {p.maximumCapacity
                      ? `${p.maximumCapacity} ${p.unitOfMeasurement || 'kg'}`
                      : '—'}
                  </td>
                  <td>
                    {p.modelApprovalDocUrl ? (
                      <a
                        href={p.modelApprovalDocUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue flex items-center gap-1"
                      >
                        <ExternalLink size={14} /> View
                      </a>
                    ) : (
                      <span className="text-muted text-sm">—</span>
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-icon text-blue mr-2"
                      onClick={() => handleEditClick(p)}
                      title="Edit"
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon text-red"
                      onClick={() => handleDeleteProduct(p)}
                      title="Delete"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-6 text-muted">
                    No products configured yet. Click &quot;Add Product&quot; to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm &&
        createPortal(
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-form-title"
          onClick={handleOverlayClose}
        >
          <div
            ref={modalRef}
            className="modal-dialog product-modal product-modal--wide glass"
            onClick={e => e.stopPropagation()}
          >
            <div className="product-form-panel">
              <div className="product-form-topbar">
                <div className="product-form-topbar-text">
                  <h2 id="product-form-title">
                    <PackagePlus className="inline-icon" />
                    {editingId ? 'Edit Product' : 'Add New Product'}
                  </h2>
                  <p className="text-muted text-sm product-form-topbar-hint">
                    {editingId
                      ? 'Update model details, scale values, and attachments.'
                      : 'Fields marked * are required.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1 shrink-0"
                  onClick={handleCancelEdit}
                  disabled={formBusy}
                  aria-label="Close"
                >
                  <X size={15} /> Close
                </button>
              </div>

              <form onSubmit={handleSubmit} className="product-form">
                <div className="product-form-body">
                  {error && <div className="login-error product-form-alert">{error}</div>}
                  <div className="product-form-flat">
                    <div className="product-form-flat-row">
                      <div className="product-form-grid product-form-grid--basic">
                        <div className="form-group mb-0">
                          <label htmlFor="pf-modelid">Model ID *</label>
                          <input
                            id="pf-modelid"
                            type="text"
                            name="modelid"
                            className="input-field"
                            placeholder="e.g. SXX-001"
                            value={formData.modelid}
                            onChange={handleChange}
                            required
                            autoFocus={!editingId}
                          />
                        </div>
                        <div className="form-group mb-0">
                          <label htmlFor="pf-modelno">Model No</label>
                          <input
                            id="pf-modelno"
                            type="text"
                            name="modelNo"
                            className="input-field"
                            placeholder="Variant no."
                            value={formData.modelNo}
                            onChange={handleChange}
                          />
                        </div>
                        <div className="form-group mb-0 product-form-span-name">
                          <label htmlFor="pf-name">Product Name *</label>
                          <input
                            id="pf-name"
                            type="text"
                            name="name"
                            className="input-field"
                            placeholder="e.g. 30 kg Platform Scale"
                            value={formData.name}
                            onChange={handleChange}
                            required
                          />
                        </div>
                        <div className="form-group mb-0">
                          <label htmlFor="pf-unit">Unit</label>
                          <select
                            id="pf-unit"
                            name="unitOfMeasurement"
                            className="input-field"
                            value={formData.unitOfMeasurement}
                            onChange={handleChange}
                          >
                            <option value="kg">kg</option>
                            <option value="g">g</option>
                          </select>
                        </div>
                      </div>
                      <DefaultsStrip
                        items={[
                          { label: 'Type', value: formData.typeOfInstrument },
                          { label: 'Mfr', value: formData.manufacturerBrandSeries },
                          { label: 'Class', value: formData.accuracyClass },
                          { label: 'Supply', value: formData.supplyVoltage },
                        ]}
                      />
                    </div>

                    <div className="product-form-flat-row product-form-flat-row--scale">
                      <span
                        className="product-form-flat-row-title"
                        title="Hover field icons for formulas"
                      >
                        Scale <Info size={12} className="inline-icon-sm" />
                      </span>
                      <div className="product-form-grid product-form-grid--scale">
                        <div className="form-group mb-0">
                          <label htmlFor="pf-max">Max (kg) *</label>
                          <input
                            id="pf-max"
                            type="number"
                            step="any"
                            name="maximumCapacity"
                            className="input-field"
                            placeholder="30"
                            value={formData.maximumCapacity}
                            onChange={handleChange}
                            required
                          />
                        </div>
                        <div className="form-group mb-0">
                          <label htmlFor="pf-e">Interval e (g) *</label>
                          <input
                            id="pf-e"
                            type="number"
                            step="any"
                            name="verificationScaleInterval"
                            className="input-field"
                            placeholder="5"
                            value={formData.verificationScaleInterval}
                            onChange={handleChange}
                            required
                          />
                        </div>
                        <div className="form-group mb-0 calc-field">
                          <CalcLabel label="Min (g)" tooltip={PRODUCT_CALC_TOOLTIPS.minimumCapacity} />
                          <input
                            type="text"
                            className="input-field input-readonly"
                            value={derivedDisplay.minimumCapacity}
                            readOnly
                            tabIndex={-1}
                          />
                        </div>
                        <div className="form-group mb-0 calc-field">
                          <CalcLabel label="d" tooltip={PRODUCT_CALC_TOOLTIPS.actualScaleInterval} />
                          <input
                            type="text"
                            className="input-field input-readonly"
                            value={derivedDisplay.actualScaleInterval}
                            readOnly
                            tabIndex={-1}
                          />
                        </div>
                        <div className="form-group mb-0 calc-field">
                          <CalcLabel label="n" tooltip={PRODUCT_CALC_TOOLTIPS.noOfVerificationIntervals} />
                          <input
                            type="text"
                            className="input-field input-readonly"
                            value={derivedDisplay.noOfVerificationIntervals}
                            readOnly
                            tabIndex={-1}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="product-form-flat-row product-form-flat-row--bottom">
                      <div className="form-group mb-0">
                        <label htmlFor="pf-mpe">MPE</label>
                        <input
                          id="pf-mpe"
                          type="number"
                          step="any"
                          name="maximumPermissibleError"
                          className="input-field"
                          placeholder="Optional"
                          value={formData.maximumPermissibleError}
                          onChange={handleChange}
                        />
                      </div>
                      <div className="form-group mb-0">
                        <label htmlFor="pf-approval-no">Approval No</label>
                        <input
                          id="pf-approval-no"
                          type="text"
                          name="modelApprovalNo"
                          className="input-field"
                          placeholder="For doc upload"
                          value={formData.modelApprovalNo}
                          onChange={handleChange}
                        />
                      </div>
                      <UploadField
                        label="Image"
                        hint="Optional"
                        compact
                        variant="image"
                        disabledReason={
                          !canUploadFiles ? 'Set Model ID first.' : undefined
                        }
                        file={productImage}
                        uploading={uploadingImage}
                        progress={imageUploadProgress}
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        uploadLabel="Upload photo"
                        formats="Max 15 MB"
                        inputRef={imageInputRef}
                        onSelect={handleProductImageSelect}
                        onRemove={handleRemoveProductImage}
                        submitting={submitting}
                      />
                      <UploadField
                        label="Approval doc"
                        hint="PDF / image"
                        compact
                        variant="document"
                        disabledReason={
                          !canUploadApprovalDoc
                            ? 'Set Model ID & Approval No.'
                            : undefined
                        }
                        file={approvalDoc}
                        uploading={uploadingDoc}
                        progress={uploadProgress}
                        accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
                        uploadLabel="Upload document"
                        formats="Max 15 MB"
                        inputRef={fileInputRef}
                        onSelect={handleApprovalFileSelect}
                        onRemove={handleRemoveApprovalDoc}
                        submitting={submitting}
                      />
                    </div>
                  </div>
                </div>

                <div className="product-form-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCancelEdit}
                    disabled={formBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary flex items-center gap-2"
                    disabled={formBusy}
                  >
                    {submitting ? (
                      <span className="spinner-inline"></span>
                    ) : (
                      <>
                        <Save size={18} />
                        {editingId ? 'Update Product' : 'Save Product'}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        getModalPortalRoot(),
      )}
    </div>
  );
};
