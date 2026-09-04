import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { useSetAppBarTitle } from '../../context/AppBarTitleContext';
import { useSetProductListAppBar } from '../../context/ProductListAppBarContext';
import { ProductListFilters } from '../../components/ProductListFilters';
import { ProductShopCardBody, ProductShopMedia } from '../../components/ProductShopMedia';
import {
  adminProductMeta,
  buildClonedProduct,
  groupDuplicateModelIds,
  nextProductSortOrder,
  productsWithModelId,
  suggestedCloneIds,
} from '../../lib/productAccess';
import {
  Ban, Copy, GripVertical, Info, Package, Pencil, Plus, Save, Trash2,
} from 'lucide-react';
import { CalcLabel, UploadField } from './productFormUi';
import { ProductSerialPoolField } from '../../components/ProductSerialPoolField';
import type { Product } from '../../types';
import {
  PRODUCT_CALC_TOOLTIPS,
  computeProductDerived,
  formatDerivedDisplay,
  parseProductNumber,
} from '../../lib/productCalculations';
import {
  buildSpecificationsFromFormRows,
  emptySpecFormRow,
  isProductActive,
  specFormRowsFromProduct,
  type SpecFormRow,
} from '../../lib/productSpecifications';
import {
  DEFAULT_PRODUCT_LIST_FILTERS,
  filterProductsForList,
  groupProductsByModelApproval,
  productModelApprovalOptions,
  productModelNoOptions,
  productSpecOptions,
  reorderIdsWithinVisible,
  type ProductListFilterState,
} from '../../lib/productListFilters';
import {
  deleteProductStorageFile,
  uploadModelApprovalDoc,
  uploadProductImage,
  type ProductFileMeta,
} from '../../lib/productApprovalUpload';

const INITIAL_STATE = {
  modelid: '',
  modelNo: '',
  yesoneSku: '',
  name: '',
  typeOfInstrument: 'Electronic',
  manufacturerBrandSeries: 'YESWEIGH',
  accuracyClass: 'III',
  unitOfMeasurement: 'kg' as 'kg' | 'g',
  supplyVoltage: '230 V AC',
  modelApprovalNo: '',
};

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

export const Products: React.FC = () => {
  const { products, addProduct, updateProduct, reorderProducts } = useAppContext();
  const { user } = useAuth();
  const confirm = useConfirm();
  const setAppBarTitle = useSetAppBarTitle();
  const setProductListAppBar = useSetProductListAppBar();
  const [formData, setFormData] = useState(INITIAL_STATE);
  const [specRows, setSpecRows] = useState<SpecFormRow[]>([emptySpecFormRow()]);
  const [productActive, setProductActive] = useState(true);
  const [pasPreAllotted, setPasPreAllotted] = useState(false);
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
  const [formEditable, setFormEditable] = useState(false);
  const [baselineJson, setBaselineJson] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [listFilters, setListFilters] = useState<ProductListFilterState>(
    DEFAULT_PRODUCT_LIST_FILTERS,
  );
  const [cloneSource, setCloneSource] = useState<Product | null>(null);
  const [cloneDraft, setCloneDraft] = useState({ modelid: '', modelNo: '' });
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);

  const formBusy = submitting || uploadingDoc || uploadingImage || reordering;

  const filteredProducts = useMemo(
    () => filterProductsForList(products, listFilters),
    [products, listFilters],
  );

  const productGroups = useMemo(
    () =>
      listFilters.approvalLayout === 'group'
        ? groupProductsByModelApproval(filteredProducts)
        : null,
    [filteredProducts, listFilters.approvalLayout],
  );

  const approvalOptions = useMemo(() => productModelApprovalOptions(products), [products]);
  const modelNoOptions = useMemo(() => productModelNoOptions(products), [products]);
  const specOptions = useMemo(() => productSpecOptions(products), [products]);

  const hasModelId = formData.modelid.trim().length > 0;
  const canUploadFiles = hasModelId;
  const canUploadApprovalDoc =
    hasModelId && formData.modelApprovalNo.trim().length > 0;
  const modelIdTaken = useMemo(
    () => productsWithModelId(products, formData.modelid, editingId),
    [products, formData.modelid, editingId],
  );
  const duplicateModelIds = useMemo(() => groupDuplicateModelIds(products), [products]);
  const cloneModelIdTaken = useMemo(
    () => (cloneSource ? productsWithModelId(products, cloneDraft.modelid) : []),
    [cloneSource, cloneDraft.modelid, products],
  );

  const fileKey = (file: ProductFileMeta | null) =>
    file ? `${file.path || ''}|${file.url || ''}|${file.name || ''}` : '';

  const captureBaseline = (
    data: typeof INITIAL_STATE,
    specs: SpecFormRow[],
    active: boolean,
    approval: ProductFileMeta | null,
    image: ProductFileMeta | null,
    pas = false,
  ) => {
    setBaselineJson(
      JSON.stringify({
        formData: data,
        specRows: specs,
        productActive: active,
        pasPreAllotted: pas,
        approval: fileKey(approval),
        image: fileKey(image),
      }),
    );
  };

  const isDirty = useMemo(() => {
    if (!baselineJson) return false;
    return (
      JSON.stringify({
        formData,
        specRows,
        productActive,
        pasPreAllotted,
        approval: fileKey(approvalDoc),
        image: fileKey(productImage),
      }) !== baselineJson
    );
  }, [baselineJson, formData, specRows, productActive, pasPreAllotted, approvalDoc, productImage]);

  const showSave = formEditable && isDirty;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (!formEditable) return;
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSpecChange = (
    localId: string,
    field: keyof Omit<SpecFormRow, 'localId'>,
    value: string,
  ) => {
    if (!formEditable) return;
    setSpecRows(prev =>
      prev.map(row => (row.localId === localId ? { ...row, [field]: value } : row)),
    );
  };

  const handleAddSpec = () => {
    if (!formEditable) return;
    setSpecRows(prev => [...prev, emptySpecFormRow()]);
  };

  const handleRemoveSpec = (localId: string) => {
    if (!formEditable || specRows.length <= 1) return;
    setSpecRows(prev => prev.filter(row => row.localId !== localId));
  };

  const handleStartAdd = () => {
    const initialSpecs = [emptySpecFormRow()];
    setEditingId(null);
    setFormData(INITIAL_STATE);
    setSpecRows(initialSpecs);
    setProductActive(true);
    setPasPreAllotted(false);
    setApprovalDoc(null);
    setProductImage(null);
    setUploadProgress(0);
    setImageUploadProgress(0);
    setError(null);
    setFormEditable(true);
    captureBaseline(INITIAL_STATE, initialSpecs, true, null, null, false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
    setShowForm(true);
  };

  const handleEditClick = (product: Product) => {
    const nextForm = {
      modelid: product.modelid || '',
      modelNo: product.modelNo || '',
      yesoneSku: product.yesoneSku || '',
      name: product.name || '',
      typeOfInstrument: product.typeOfInstrument || 'Electronic',
      manufacturerBrandSeries: product.manufacturerBrandSeries || 'YESWEIGH',
      accuracyClass: product.accuracyClass || 'III',
      unitOfMeasurement: (product.unitOfMeasurement || 'kg') as 'kg' | 'g',
      supplyVoltage: product.supplyVoltage || '230 V AC',
      modelApprovalNo: product.modelApprovalNo || '',
    };
    const nextSpecs = specFormRowsFromProduct(product);
    const nextActive = isProductActive(product);
    const nextApproval =
      product.modelApprovalDocUrl && product.modelApprovalDocPath
        ? {
            url: product.modelApprovalDocUrl,
            path: product.modelApprovalDocPath,
            name: product.modelApprovalDocName || 'Model approval document',
            contentType: product.modelApprovalDocContentType || 'application/pdf',
          }
        : null;
    const nextImage =
      product.productImageUrl && product.productImagePath
        ? {
            url: product.productImageUrl,
            path: product.productImagePath,
            name: product.productImageName || 'Product image',
            contentType: product.productImageContentType || 'image/jpeg',
          }
        : null;
    const nextPas = Boolean(product.pasPreAllotted);
    setShowForm(true);
    setEditingId(product.id);
    setFormData(nextForm);
    setSpecRows(nextSpecs);
    setProductActive(nextActive);
    setPasPreAllotted(nextPas);
    setApprovalDoc(nextApproval);
    setProductImage(nextImage);
    setUploadProgress(0);
    setImageUploadProgress(0);
    setError(null);
    setFormEditable(false);
    captureBaseline(nextForm, nextSpecs, nextActive, nextApproval, nextImage, nextPas);
  };

  const handleCloneClick = (product: Product) => {
    setShowForm(false);
    setEditingId(null);
    setFormEditable(false);
    setCloneSource(product);
    setCloneDraft(suggestedCloneIds(product));
    setCloneError(null);
  };

  const handleCancelClone = () => {
    setCloneSource(null);
    setCloneDraft({ modelid: '', modelNo: '' });
    setCloneError(null);
    setCloning(false);
  };

  const handleCloneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneSource || cloning) return;
    const modelid = cloneDraft.modelid.trim();
    const modelNo = cloneDraft.modelNo.trim();
    if (!modelid) {
      setCloneError('Model ID is required.');
      return;
    }
    const taken = productsWithModelId(products, modelid);
    if (taken.length > 0) {
      setCloneError(
        `Model ID must be unique. Already used by ${taken.map(p => p.name || p.modelid).join(', ')}.`,
      );
      return;
    }
    setCloneError(null);
    setCloning(true);
    try {
      await addProduct(
        buildClonedProduct(
          cloneSource,
          modelid,
          modelNo,
          nextProductSortOrder(products),
          user?.uid,
        ),
      );
      handleCancelClone();
    } catch (err: unknown) {
      setCloneError(err instanceof Error ? err.message : 'Failed to clone product');
    } finally {
      setCloning(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setShowForm(false);
    setFormData(INITIAL_STATE);
    setSpecRows([emptySpecFormRow()]);
    setProductActive(true);
    setPasPreAllotted(false);
    setApprovalDoc(null);
    setProductImage(null);
    setUploadProgress(0);
    setImageUploadProgress(0);
    setError(null);
    setFormEditable(false);
    setBaselineJson('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handleEnableEdit = () => {
    setFormEditable(true);
  };

  const handleToggleActive = async (product: Product) => {
    const currentlyActive = isProductActive(product);
    const ok = await confirm({
      title: currentlyActive ? 'Deactivate product?' : 'Reactivate product?',
      message: currentlyActive
        ? 'Hide this product from OV/RV pickers (duplicate or obsolete).'
        : 'Show this product again in OV/RV pickers.',
      confirmLabel: currentlyActive ? 'Deactivate' : 'Reactivate',
      destructive: currentlyActive,
    });
    if (!ok) return;
    try {
      await updateProduct(product.id, { active: !currentlyActive });
      if (editingId === product.id) {
        setProductActive(!currentlyActive);
        setBaselineJson(prev => {
          if (!prev) return prev;
          try {
            const parsed = JSON.parse(prev) as { productActive?: boolean };
            return JSON.stringify({ ...parsed, productActive: !currentlyActive });
          } catch {
            return prev;
          }
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update product status');
    }
  };

  const handleDeactivateFromForm = async () => {
    if (!editingId) return;
    const product = products.find(p => p.id === editingId);
    if (!product) return;
    await handleToggleActive(product);
  };

  const handleReorderDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId || reordering) {
      setDragId(null);
      setDropTargetId(null);
      return;
    }
    const allIds = products.map(p => p.id);
    const visibleIds = filteredProducts.map(p => p.id);
    const next = reorderIdsWithinVisible(allIds, visibleIds, dragId, targetId);
    setDragId(null);
    setDropTargetId(null);
    if (!next) return;
    setReordering(true);
    try {
      await reorderProducts(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reorder products');
    } finally {
      setReordering(false);
    }
  };

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !formBusy) handleCancelEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm, formBusy]);

  useEffect(() => {
    if (!setAppBarTitle) return;
    if (showForm && !editingId) {
      setAppBarTitle('+ Product');
      return () => setAppBarTitle(null);
    }
    if (showForm && editingId) {
      setAppBarTitle(formEditable ? 'Edit Product' : formData.name.trim() || 'Product');
      return () => setAppBarTitle(null);
    }
    setAppBarTitle(null);
    return () => setAppBarTitle(null);
  }, [setAppBarTitle, showForm, editingId, formEditable, formData.name]);

  useEffect(() => {
    if (!setProductListAppBar) return;
    if (showForm) {
      setProductListAppBar(null);
      return () => setProductListAppBar(null);
    }
    setProductListAppBar({ onAdd: handleStartAdd });
    return () => setProductListAppBar(null);
  }, [setProductListAppBar, showForm]);

  const handleApprovalFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!formEditable) return;
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
    if (!formEditable) return;
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
    if (!formEditable || !productImage) return;
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

  const handleRemoveApprovalDoc = async () => {
    if (!formEditable || !approvalDoc) return;
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
    if (!formEditable || !isDirty) return;
    if (!formData.name.trim() || !formData.modelid.trim()) {
      setError('Product Name and Model ID are required.');
      return;
    }

    const taken = productsWithModelId(products, formData.modelid, editingId);
    if (taken.length > 0) {
      setError(
        `Model ID must be unique. Already used by ${taken.map(p => p.name || p.modelid).join(', ')}.`,
      );
      return;
    }

    const built = buildSpecificationsFromFormRows(specRows);
    if (!built) {
      setError('Each specification needs Max and e greater than zero.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const { specifications, primary } = built;
      const productData = {
        modelid: formData.modelid.trim(),
        modelNo: formData.modelNo,
        yesoneSku: formData.yesoneSku.trim(),
        pasPreAllotted,
        name: formData.name,
        typeOfInstrument: formData.typeOfInstrument || 'Electronic',
        manufacturerBrandSeries: formData.manufacturerBrandSeries || 'YESWEIGH',
        accuracyClass: formData.accuracyClass || 'III',
        maximumCapacity: primary.maximumCapacity,
        verificationScaleInterval: primary.verificationScaleInterval,
        minimumCapacity: primary.minimumCapacity,
        actualScaleInterval: primary.actualScaleInterval,
        noOfVerificationIntervals: primary.noOfVerificationIntervals,
        unitOfMeasurement: formData.unitOfMeasurement,
        maximumPermissibleError: primary.maximumPermissibleError,
        specifications,
        active: productActive,
        supplyVoltage: formData.supplyVoltage || '230 V AC',
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
          sortOrder: nextProductSortOrder(products),
          ...(user?.uid ? adminProductMeta(user.uid) : {}),
        });
      }
      setFormData(INITIAL_STATE);
      setSpecRows([emptySpecFormRow()]);
      setProductActive(true);
      setPasPreAllotted(false);
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
    <div className={`fade-in${showForm ? ' product-edit-page' : ' max-w-6xl mx-auto'}`}>
      {showForm && (
        <InlineFormPanel
          id="product-form"
          plain
          className="inline-form-panel--wide inline-form-panel--product-edit"
        >
          <div className="product-form-panel">
            <ListViewBackBar
              onBack={handleCancelEdit}
              disabled={formBusy}
              trailing={
                editingId && !formEditable ? (
                  <div className="product-form-view-actions">
                    <button
                      type="button"
                      className={`product-form-edit-toggle${productActive ? '' : ' product-form-edit-toggle--inactive'}`}
                      onClick={handleDeactivateFromForm}
                      aria-label={productActive ? 'Deactivate product' : 'Reactivate product'}
                      title={productActive ? 'Deactivate' : 'Reactivate'}
                    >
                      <Ban size={18} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className="product-form-edit-toggle"
                      onClick={handleEnableEdit}
                      aria-label="Edit product"
                      title="Edit"
                    >
                      <Pencil size={18} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className="product-form-edit-toggle"
                      onClick={() => {
                        const current = products.find(p => p.id === editingId);
                        if (current) handleCloneClick(current);
                      }}
                      aria-label="Clone product"
                      title="Clone"
                    >
                      <Copy size={18} strokeWidth={2} />
                    </button>
                  </div>
                ) : null
              }
            />
            {error ? (
              <div className="product-form-topbar">
                <p className="rc-form-topbar-error" role="alert">{error}</p>
              </div>
            ) : null}

            <form
              onSubmit={handleSubmit}
              className="product-form product-form--admin-edit"
              aria-label={editingId ? 'Edit product' : 'Add product'}
            >
              <div className="product-form-body">
                <div className="product-form-flat product-form-flat--admin">
                  <section className="product-edit-section" aria-label="Identity">
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
                          autoFocus={!editingId && formEditable}
                          readOnly={!formEditable}
                          aria-invalid={modelIdTaken.length > 0}
                        />
                        {modelIdTaken.length > 0 ? (
                          <p className="rc-form-topbar-error" role="alert">
                            Model ID must be unique. Already used by{' '}
                            {modelIdTaken.map(p => p.name || p.modelid).join(', ')}.
                          </p>
                        ) : null}
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
                          readOnly={!formEditable}
                        />
                      </div>
                      <div className="form-group mb-0 product-form-span-sku">
                        <label htmlFor="pf-yesone-sku">Yesone SKU</label>
                        <input
                          id="pf-yesone-sku"
                          type="text"
                          name="yesoneSku"
                          className="input-field"
                          placeholder="Yesone SKU"
                          value={formData.yesoneSku}
                          onChange={handleChange}
                          readOnly={!formEditable}
                        />
                      </div>
                      <ProductSerialPoolField
                        pas={pasPreAllotted}
                        disabled={!formEditable}
                        onChange={setPasPreAllotted}
                      />
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
                          readOnly={!formEditable}
                        />
                      </div>
                      <div className="product-form-unit-approval">
                        <div className="form-group mb-0 product-form-span-unit">
                          <label htmlFor="pf-unit">Unit</label>
                          <select
                            id="pf-unit"
                            name="unitOfMeasurement"
                            className="input-field"
                            value={formData.unitOfMeasurement}
                            onChange={handleChange}
                            disabled={!formEditable}
                          >
                            <option value="kg">kg</option>
                            <option value="g">g</option>
                          </select>
                        </div>
                        <div className="form-group mb-0 product-form-span-approval">
                          <label htmlFor="pf-approval-no">Approval No</label>
                          <input
                            id="pf-approval-no"
                            type="text"
                            name="modelApprovalNo"
                            className="input-field"
                            placeholder="For doc upload"
                            value={formData.modelApprovalNo}
                            onChange={handleChange}
                            readOnly={!formEditable}
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
                      {formEditable ? (
                        <button
                          type="button"
                          className="product-spec-add-btn"
                          onClick={handleAddSpec}
                          aria-label="Add specification"
                          title="Add specification"
                        >
                          <Plus size={18} strokeWidth={2.25} />
                        </button>
                      ) : null}
                    </div>
                    <div className="product-spec-rows">
                      {specRows.map((row, index) => {
                        const derived = derivedForRow(row);
                        return (
                          <div key={row.localId} className="product-spec-row">
                            {specRows.length > 1 ? (
                              <div className="product-spec-row-head">
                                <span className="product-spec-row-label">Spec {index + 1}</span>
                                {formEditable ? (
                                  <button
                                    type="button"
                                    className="product-spec-remove-btn"
                                    onClick={() => handleRemoveSpec(row.localId)}
                                    aria-label={`Remove specification ${index + 1}`}
                                    title="Remove"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                            <div className="product-form-grid product-form-grid--scale">
                              <div className="form-group mb-0 product-form-scale-field--blue">
                                <label htmlFor={`pf-max-${row.localId}`}>Max</label>
                                <input
                                  id={`pf-max-${row.localId}`}
                                  type="number"
                                  step="any"
                                  className="input-field"
                                  placeholder="30"
                                  value={row.maximumCapacity}
                                  onChange={e =>
                                    handleSpecChange(row.localId, 'maximumCapacity', e.target.value)
                                  }
                                  required
                                  inputMode="decimal"
                                  readOnly={!formEditable}
                                />
                              </div>
                              <div className="form-group mb-0 product-form-scale-field--blue">
                                <label htmlFor={`pf-e-${row.localId}`}>e</label>
                                <input
                                  id={`pf-e-${row.localId}`}
                                  type="number"
                                  step="any"
                                  className="input-field"
                                  placeholder="5"
                                  value={row.verificationScaleInterval}
                                  onChange={e =>
                                    handleSpecChange(
                                      row.localId,
                                      'verificationScaleInterval',
                                      e.target.value,
                                    )
                                  }
                                  required
                                  inputMode="decimal"
                                  readOnly={!formEditable}
                                />
                              </div>
                              <div className="form-group mb-0 product-form-scale-field--blue">
                                <label htmlFor={`pf-mpe-${row.localId}`}>MPE</label>
                                <input
                                  id={`pf-mpe-${row.localId}`}
                                  type="number"
                                  step="any"
                                  className="input-field"
                                  placeholder="—"
                                  value={row.maximumPermissibleError}
                                  onChange={e =>
                                    handleSpecChange(
                                      row.localId,
                                      'maximumPermissibleError',
                                      e.target.value,
                                    )
                                  }
                                  inputMode="decimal"
                                  readOnly={!formEditable}
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
                        readOnly={!formEditable}
                        disabledReason={
                          formEditable && !canUploadFiles
                            ? 'Set Model ID first.'
                            : undefined
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
                        submitting={submitting || !formEditable}
                      />
                      <UploadField
                        label="Approval doc"
                        hint="PDF / image"
                        compact
                        iconActions
                        variant="document"
                        readOnly={!formEditable}
                        disabledReason={
                          formEditable && !canUploadApprovalDoc
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
                        submitting={submitting || !formEditable}
                      />
                    </div>
                  </section>
                </div>
              </div>

              <div className="product-form-footer product-form-footer--admin-edit">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCancelEdit}
                  disabled={formBusy}
                >
                  {formEditable && isDirty ? 'Cancel' : 'Close'}
                </button>
                {editingId ? (
                  <button
                    type="button"
                    className={`btn ${productActive ? 'btn-danger' : 'btn-secondary'}`}
                    onClick={handleDeactivateFromForm}
                    disabled={formBusy}
                  >
                    <Ban size={16} aria-hidden />
                    {productActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                ) : null}
                {showSave ? (
                  <button
                    type="submit"
                    className="btn btn-primary flex items-center gap-2"
                    disabled={formBusy || modelIdTaken.length > 0}
                  >
                    {submitting ? (
                      <span className="spinner-inline"></span>
                    ) : (
                      <>
                        <Save size={18} />
                        {editingId ? 'Update' : 'Save'}
                      </>
                    )}
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </InlineFormPanel>
      )}

      {!showForm && (
        <div className="rc-list-page rc-list-page--product-shop">
          {cloneSource ? (
            <form className="product-clone-bar" onSubmit={handleCloneSubmit}>
              <p className="product-clone-bar-title mb-0">
                Clone {cloneSource.name || 'product'}
              </p>
              <div className="product-clone-bar-fields">
                <label className="product-clone-bar-field">
                  <span>Model ID *</span>
                  <input
                    type="text"
                    className="input-field"
                    value={cloneDraft.modelid}
                    onChange={e => setCloneDraft(prev => ({ ...prev, modelid: e.target.value }))}
                    autoFocus
                    required
                    aria-invalid={cloneModelIdTaken.length > 0}
                  />
                </label>
                <label className="product-clone-bar-field">
                  <span>Model No</span>
                  <input
                    type="text"
                    className="input-field"
                    value={cloneDraft.modelNo}
                    onChange={e => setCloneDraft(prev => ({ ...prev, modelNo: e.target.value }))}
                  />
                </label>
              </div>
              {cloneError ? (
                <p className="rc-form-topbar-error mb-0" role="alert">
                  {cloneError}
                </p>
              ) : cloneModelIdTaken.length > 0 ? (
                <p className="rc-form-topbar-error mb-0" role="alert">
                  Model ID must be unique. Already used by{' '}
                  {cloneModelIdTaken.map(p => p.name || p.modelid).join(', ')}.
                </p>
              ) : null}
              <div className="product-clone-bar-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCancelClone}
                  disabled={cloning}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={cloning || cloneModelIdTaken.length > 0}>
                  {cloning ? 'Cloning…' : 'Create clone'}
                </button>
              </div>
            </form>
          ) : null}
          {duplicateModelIds.length > 0 ? (
            <div className="product-modelid-dup" role="alert">
              {duplicateModelIds.map(group => (
                <p key={group.modelid} className="rc-form-topbar-error mb-0">
                  Duplicate Model ID {group.modelid} ×{group.items.length}
                  {' — '}
                  {group.items.map(p => p.name || p.id).join(', ')}
                </p>
              ))}
            </div>
          ) : null}
          <ProductListFilters
            value={listFilters}
            onChange={setListFilters}
            modelApprovalOptions={approvalOptions}
            modelNoOptions={modelNoOptions}
            specOptions={specOptions}
          />
          {products.length === 0 ? (
            <div className="rc-vehicles-empty">
              <span className="rc-list-summary-icon rc-list-summary-icon--lg" aria-hidden>
                <Package size={24} strokeWidth={1.85} />
              </span>
              <p>No products configured yet.</p>
              <p className="text-muted text-sm mb-0">Tap + to add a product.</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="rc-vehicles-empty">
              <span className="rc-list-summary-icon rc-list-summary-icon--lg" aria-hidden>
                <Package size={24} strokeWidth={1.85} />
              </span>
              <p>No products match these filters.</p>
              <p className="text-muted text-sm mb-0">Reset filters to see more.</p>
            </div>
          ) : productGroups ? (
            <div className="product-approval-groups">
              {productGroups.map(group => (
                <section key={group.key} className="product-approval-group">
                  <h2 className="product-approval-group-title">{group.label}</h2>
                  <ul className="product-catalogue-list product-catalogue-list--shop rc-product-shop-grid">
                    {group.products.map(p => renderProductCard(p))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <ul className="product-catalogue-list product-catalogue-list--shop rc-product-shop-grid">
              {filteredProducts.map(p => renderProductCard(p))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  function renderProductCard(p: Product) {
    const displayName = (p.name || '—').trim();
    const active = isProductActive(p);
    const isDragging = dragId === p.id;
    const isDropTarget = dropTargetId === p.id && dragId !== p.id;
    return (
      <li
        key={p.id}
        className={`rc-product-shop-item${active ? '' : ' rc-product-shop-item--inactive'}${isDragging ? ' rc-product-shop-item--dragging' : ''}${isDropTarget ? ' rc-product-shop-item--drop-target' : ''}`}
        draggable={!formBusy}
        onDragStart={e => {
          setDragId(p.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', p.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropTargetId(null);
        }}
        onDragOver={e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (dropTargetId !== p.id) setDropTargetId(p.id);
        }}
        onDragLeave={() => {
          if (dropTargetId === p.id) setDropTargetId(null);
        }}
        onDrop={e => {
          e.preventDefault();
          void handleReorderDrop(p.id);
        }}
      >
        <button
          type="button"
          className="rc-product-shop-drag"
          aria-label={`Drag to reorder ${displayName}`}
          title="Drag to reorder"
          tabIndex={-1}
          onClick={e => e.preventDefault()}
        >
          <GripVertical size={16} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="product-shop-card"
          onClick={() => handleEditClick(p)}
          aria-label={`Edit ${displayName}`}
        >
          <ProductShopMedia product={p} inactive={!active} />
          <ProductShopCardBody product={p} name={displayName} />
        </button>
        <div className="rc-product-shop-actions">
          <button
            type="button"
            className="rc-product-shop-edit"
            onClick={() => handleCloneClick(p)}
            title="Clone product"
            aria-label={`Clone ${displayName}`}
          >
            <Copy size={15} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="rc-product-shop-edit"
            onClick={() => handleEditClick(p)}
            title="Edit product"
            aria-label={`Edit ${displayName}`}
          >
            <Pencil size={15} strokeWidth={2} />
          </button>
        </div>
      </li>
    );
  }
};
