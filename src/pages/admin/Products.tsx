import React, { useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { PackagePlus, Trash2, Pencil, Info, Upload, FileText, ExternalLink, X, Image as ImageIcon } from 'lucide-react';
import type { Product } from '../../types';
import {
  PRODUCT_CALC_TOOLTIPS,
  computeProductDerived,
  formatDerivedDisplay,
  parseProductNumber,
} from '../../lib/productCalculations';
import {
  deleteProductStorageFile,
  isPdfContentType,
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

const CalcLabel: React.FC<{ label: string; tooltip: string }> = ({ label, tooltip }) => (
  <label className="calc-field-label">
    <span>{label}</span>
    <span className="calc-field-hint" title={tooltip} aria-label={tooltip}>
      <Info size={14} />
    </span>
  </label>
);

export const Products: React.FC = () => {
  const { products, addProduct, updateProduct, deleteProduct } = useAppContext();
  const [formData, setFormData] = useState(INITIAL_STATE);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const handleEditClick = (product: Product) => {
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setFormData(INITIAL_STATE);
    setApprovalDoc(null);
    setProductImage(null);
    setUploadProgress(0);
    setImageUploadProgress(0);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

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
    if (!confirm('Remove the product image?')) return;

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
    if (
      !confirm(
        `Delete product "${label}" (Model ID: ${product.modelid})?\nThis cannot be undone.`,
      )
    ) {
      return;
    }

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
    if (!confirm('Remove the uploaded model approval document?')) return;

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
        await updateProduct(editingId, productData);
      } else {
        await addProduct(productData);
      }
      setFormData(INITIAL_STATE);
      setEditingId(null);
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
        <div className="panel-header">
          <h2>
            <PackagePlus className="inline-icon" />{' '}
            {editingId ? 'Edit Product Model' : 'Add New Product Model'}
          </h2>
        </div>
        <div className="panel-body">
          {error && (
            <div className="p-3 mb-4 text-sm text-red-500 bg-red-100 rounded border border-red-200">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="form-grid-3 mb-4">
              <div className="form-group mb-0">
                <label>Model ID (Unique) *</label>
                <input
                  type="text"
                  name="modelid"
                  className="input-field"
                  value={formData.modelid}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="form-group mb-0">
                <label>Model No</label>
                <input
                  type="text"
                  name="modelNo"
                  className="input-field"
                  value={formData.modelNo}
                  onChange={handleChange}
                />
              </div>
              <div className="form-group mb-0">
                <label>Product Name *</label>
                <input
                  type="text"
                  name="name"
                  className="input-field"
                  value={formData.name}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="form-group mb-0">
                <label>Type of Instrument</label>
                <input
                  type="text"
                  name="typeOfInstrument"
                  className="input-field"
                  value={formData.typeOfInstrument}
                  onChange={handleChange}
                  readOnly
                />
              </div>
              <div className="form-group mb-0">
                <label>Manufacturer / Model / Brand / Series Designation</label>
                <input
                  type="text"
                  name="manufacturerBrandSeries"
                  className="input-field"
                  value={formData.manufacturerBrandSeries}
                  onChange={handleChange}
                  readOnly
                />
              </div>
              <div className="form-group mb-0">
                <label>Accuracy Class</label>
                <select
                  name="accuracyClass"
                  className="input-field"
                  value={formData.accuracyClass}
                  onChange={handleChange}
                >
                  <option value="III">III</option>
                </select>
              </div>
              <div className="form-group mb-0">
                <label>Unit of Measurement</label>
                <select
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

            <div className="model-approval-upload product-image-upload mt-4">
              <label className="block text-sm font-medium text-muted mb-2">
                Product Image <span className="text-muted font-normal">(optional)</span>
              </label>

              {!canUploadFiles ? (
                <p className="text-muted text-sm">
                  Enter <strong>Model ID</strong> to enable image upload.
                </p>
              ) : (
                <>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="sr-only"
                    onChange={handleProductImageSelect}
                    disabled={uploadingImage || submitting}
                  />

                  {!productImage && !uploadingImage && (
                    <button
                      type="button"
                      className="upload-box w-full"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={submitting}
                    >
                      <ImageIcon size={28} className="text-muted mb-2 mx-auto" />
                      <span className="text-sm">Click to upload product image</span>
                      <span className="text-xs text-muted block mt-1">JPEG, PNG, WebP, GIF · Max 15 MB</span>
                    </button>
                  )}

                  {uploadingImage && (
                    <div className="approval-upload-progress">
                      <span className="spinner-inline"></span>
                      <span className="text-sm text-muted">Uploading image… {imageUploadProgress}%</span>
                      <div className="approval-progress-bar">
                        <div
                          className="approval-progress-fill"
                          style={{ width: `${imageUploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {productImage && !uploadingImage && (
                    <div className="approval-doc-card">
                      <div className="approval-doc-preview">
                        <img
                          src={productImage.url}
                          alt="Product"
                          className="approval-doc-thumb approval-doc-thumb-lg"
                        />
                        <div className="approval-doc-meta">
                          <p className="font-medium text-sm truncate">{productImage.name}</p>
                          <p className="text-xs text-muted">Product image</p>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <a
                          href={productImage.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary text-sm py-1 px-2 flex items-center gap-1"
                        >
                          <ExternalLink size={14} /> View
                        </a>
                        <button
                          type="button"
                          className="btn btn-secondary text-sm py-1 px-2"
                          onClick={() => imageInputRef.current?.click()}
                          disabled={submitting}
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary text-sm py-1 px-2 flex items-center gap-1 text-red"
                          onClick={handleRemoveProductImage}
                          disabled={submitting}
                        >
                          <X size={14} /> Remove
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="product-scale-sections">
              <div className="product-scale-section product-scale-section--manual">
                <h3 className="product-scale-section-title">Manual entry</h3>
                <div className="form-grid-2">
                  <div className="form-group mb-0">
                    <label>Maximum Capacity (Max) (kg) *</label>
                    <input
                      type="number"
                      step="any"
                      name="maximumCapacity"
                      className="input-field"
                      value={formData.maximumCapacity}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <div className="form-group mb-0">
                    <label>Verification Scale Interval (e) (g) *</label>
                    <input
                      type="number"
                      step="any"
                      name="verificationScaleInterval"
                      className="input-field"
                      value={formData.verificationScaleInterval}
                      onChange={handleChange}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="product-scale-section product-scale-section--auto">
                <h3 className="product-scale-section-title">Auto-calculated</h3>
                <p className="product-scale-section-hint text-muted text-sm">
                  Hover the <Info size={12} className="inline-icon-sm" /> icon on each field to see the formula.
                </p>
                <div className="form-grid-3">
                  <div className="form-group mb-0 calc-field">
                    <CalcLabel
                      label="Minimum Capacity (Min) (g)"
                      tooltip={PRODUCT_CALC_TOOLTIPS.minimumCapacity}
                    />
                    <input
                      type="text"
                      className="input-field input-readonly"
                      value={derivedDisplay.minimumCapacity}
                      readOnly
                      tabIndex={-1}
                      title={PRODUCT_CALC_TOOLTIPS.minimumCapacity}
                    />
                  </div>
                  <div className="form-group mb-0 calc-field">
                    <CalcLabel
                      label="Actual Scale Interval (d)"
                      tooltip={PRODUCT_CALC_TOOLTIPS.actualScaleInterval}
                    />
                    <input
                      type="text"
                      className="input-field input-readonly"
                      value={derivedDisplay.actualScaleInterval}
                      readOnly
                      tabIndex={-1}
                      title={PRODUCT_CALC_TOOLTIPS.actualScaleInterval}
                    />
                  </div>
                  <div className="form-group mb-0 calc-field">
                    <CalcLabel
                      label="No. of Verification Intervals (n)"
                      tooltip={PRODUCT_CALC_TOOLTIPS.noOfVerificationIntervals}
                    />
                    <input
                      type="text"
                      className="input-field input-readonly"
                      value={derivedDisplay.noOfVerificationIntervals}
                      readOnly
                      tabIndex={-1}
                      title={PRODUCT_CALC_TOOLTIPS.noOfVerificationIntervals}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="form-grid-3 mt-4">
              <div className="form-group mb-0">
                <label>Maximum Permissible Error (MPE)</label>
                <input
                  type="number"
                  step="any"
                  name="maximumPermissibleError"
                  className="input-field"
                  value={formData.maximumPermissibleError}
                  onChange={handleChange}
                />
              </div>
              <div className="form-group mb-0">
                <label>Supply Voltage (if electronic)</label>
                <input
                  type="text"
                  name="supplyVoltage"
                  className="input-field"
                  value={formData.supplyVoltage}
                  onChange={handleChange}
                  readOnly
                />
              </div>
              <div className="form-group mb-0">
                <label>Model Approval No</label>
                <input
                  type="text"
                  name="modelApprovalNo"
                  className="input-field"
                  value={formData.modelApprovalNo}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className="model-approval-upload mt-4">
              <label className="block text-sm font-medium text-muted mb-2">
                Model Approval Document (PDF or image)
              </label>

              {!canUploadApprovalDoc ? (
                <p className="text-muted text-sm">
                  Enter <strong>Model ID</strong> and <strong>Model Approval No</strong> to enable upload.
                </p>
              ) : (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
                    className="sr-only"
                    onChange={handleApprovalFileSelect}
                    disabled={uploadingDoc || uploadingImage || submitting}
                  />

                  {!approvalDoc && !uploadingDoc && (
                    <button
                      type="button"
                      className="upload-box w-full"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={submitting}
                    >
                      <Upload size={28} className="text-muted mb-2 mx-auto" />
                      <span className="text-sm">Click to upload PDF or image</span>
                      <span className="text-xs text-muted block mt-1">Max 15 MB</span>
                    </button>
                  )}

                  {uploadingDoc && (
                    <div className="approval-upload-progress">
                      <span className="spinner-inline"></span>
                      <span className="text-sm text-muted">Uploading… {uploadProgress}%</span>
                      <div className="approval-progress-bar">
                        <div
                          className="approval-progress-fill"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {approvalDoc && !uploadingDoc && (
                    <div className="approval-doc-card">
                      <div className="approval-doc-preview">
                        {isPdfContentType(approvalDoc.contentType) ? (
                          <FileText size={32} className="text-red" />
                        ) : (
                          <img
                            src={approvalDoc.url}
                            alt="Model approval preview"
                            className="approval-doc-thumb"
                          />
                        )}
                        <div className="approval-doc-meta">
                          <p className="font-medium text-sm truncate">{approvalDoc.name}</p>
                          <p className="text-xs text-muted">
                            {isPdfContentType(approvalDoc.contentType) ? 'PDF document' : 'Image'}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <a
                          href={approvalDoc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary text-sm py-1 px-2 flex items-center gap-1"
                        >
                          <ExternalLink size={14} /> View
                        </a>
                        <button
                          type="button"
                          className="btn btn-secondary text-sm py-1 px-2"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={submitting}
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary text-sm py-1 px-2 flex items-center gap-1 text-red"
                          onClick={handleRemoveApprovalDoc}
                          disabled={submitting}
                        >
                          <X size={14} /> Remove
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div
              className="form-actions mt-6 pt-4 flex gap-3"
              style={{ borderTop: '1px solid var(--border-glass)' }}
            >
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? (
                  <span className="spinner-inline"></span>
                ) : editingId ? (
                  'Update Product'
                ) : (
                  'Save Product'
                )}
              </button>
              {editingId && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCancelEdit}
                  disabled={submitting}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <div className="panel glass">
        <div className="panel-header">
          <h2>Configured Products</h2>
        </div>
        <div className="panel-body p-0 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
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
                  <td colSpan={7} className="text-center py-6 text-muted">
                    No products configured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
