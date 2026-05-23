import React, { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { PackagePlus, Trash2, Pencil } from 'lucide-react';

const INITIAL_STATE = {
  modelid: '',
  modelNo: '',
  name: '',
  typeOfInstrument: 'Electronic',
  manufacturerBrandSeries: 'YESWEIGH',
  accuracyClass: 'III',
  maximumCapacity: '',
  minimumCapacity: '',
  verificationScaleInterval: '',
  unitOfMeasurement: 'kg' as 'kg' | 'g',
  actualScaleInterval: '',
  noOfVerificationIntervals: '',
  maximumPermissibleError: '',
  supplyVoltage: '230 V AC',
  modelApprovalNo: ''
};

export const Products: React.FC = () => {
  const { products, addProduct, updateProduct, deleteProduct } = useAppContext();
  const [formData, setFormData] = useState(INITIAL_STATE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleEditClick = (product: any) => {
    setEditingId(product.id);
    setFormData({
      modelid: product.modelid || '',
      modelNo: product.modelNo || '',
      name: product.name || '',
      typeOfInstrument: product.typeOfInstrument || 'Electronic',
      manufacturerBrandSeries: product.manufacturerBrandSeries || 'YESWEIGH',
      accuracyClass: product.accuracyClass || 'III',
      maximumCapacity: product.maximumCapacity || '',
      minimumCapacity: product.minimumCapacity || '',
      verificationScaleInterval: product.verificationScaleInterval || '',
      unitOfMeasurement: product.unitOfMeasurement || 'kg',
      actualScaleInterval: product.actualScaleInterval || '',
      noOfVerificationIntervals: product.noOfVerificationIntervals || '',
      maximumPermissibleError: product.maximumPermissibleError || '',
      supplyVoltage: product.supplyVoltage || '230 V AC',
      modelApprovalNo: product.modelApprovalNo || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setFormData(INITIAL_STATE);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.modelid) {
      setError('Product Name and Model ID are required.');
      return;
    }
    
    // Check for unique modelid (exclude current product if editing)
    if (products.some(p => p.modelid === formData.modelid && p.id !== editingId)) {
      setError('Model ID must be unique. A product with this Model ID already exists.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const productData = {
        modelid: formData.modelid,
        modelNo: formData.modelNo,
        name: formData.name,
        typeOfInstrument: formData.typeOfInstrument,
        manufacturerBrandSeries: formData.manufacturerBrandSeries,
        accuracyClass: formData.accuracyClass,
        maximumCapacity: Number(formData.maximumCapacity) || 0,
        minimumCapacity: Number(formData.minimumCapacity) || 0,
        verificationScaleInterval: Number(formData.verificationScaleInterval) || 0,
        unitOfMeasurement: formData.unitOfMeasurement,
        actualScaleInterval: Number(formData.actualScaleInterval) || 0,
        noOfVerificationIntervals: Number(formData.noOfVerificationIntervals) || 0,
        maximumPermissibleError: Number(formData.maximumPermissibleError) || 0,
        supplyVoltage: formData.supplyVoltage,
        modelApprovalNo: formData.modelApprovalNo,
      };

      if (editingId) {
        await updateProduct(editingId, productData);
      } else {
        await addProduct(productData);
      }
      setFormData(INITIAL_STATE);
      setEditingId(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save product');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fade-in max-w-6xl mx-auto">
      <div className="panel glass mb-6">
        <div className="panel-header">
          <h2><PackagePlus className="inline-icon" /> {editingId ? 'Edit Product Model' : 'Add New Product Model'}</h2>
        </div>
        <div className="panel-body">
          {error && <div className="p-3 mb-4 text-sm text-red-500 bg-red-100 rounded border border-red-200">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-grid-3 mb-4">
              <div className="form-group mb-0">
                <label>Model ID (Unique) *</label>
                <input type="text" name="modelid" className="input-field" value={formData.modelid} onChange={handleChange} required />
              </div>
              <div className="form-group mb-0">
                <label>Model No</label>
                <input type="text" name="modelNo" className="input-field" value={formData.modelNo} onChange={handleChange} />
              </div>
              <div className="form-group mb-0">
                <label>Product Name *</label>
                <input type="text" name="name" className="input-field" value={formData.name} onChange={handleChange} required />
              </div>
              <div className="form-group mb-0">
                <label>Type of Instrument</label>
                <input type="text" name="typeOfInstrument" className="input-field" value={formData.typeOfInstrument} onChange={handleChange} readOnly />
              </div>
              <div className="form-group mb-0">
                <label>Manufacturer / Model / Brand / Series Designation</label>
                <input type="text" name="manufacturerBrandSeries" className="input-field" value={formData.manufacturerBrandSeries} onChange={handleChange} readOnly />
              </div>
              <div className="form-group mb-0">
                <label>Accuracy Class</label>
                <select name="accuracyClass" className="input-field" value={formData.accuracyClass} onChange={handleChange}>
                  <option value="III">III</option>
                </select>
              </div>
              <div className="form-group mb-0">
                <label>Maximum Capacity (Max) (kg)</label>
                <input type="number" step="any" name="maximumCapacity" className="input-field" value={formData.maximumCapacity} onChange={handleChange} />
              </div>
              <div className="form-group mb-0">
                <label>Minimum Capacity (Min) (g)</label>
                <input type="number" step="any" name="minimumCapacity" className="input-field" value={formData.minimumCapacity} onChange={handleChange} />
              </div>
              <div className="form-group mb-0">
                <label>Verification Scale Interval (e) (g)</label>
                <input type="number" step="any" name="verificationScaleInterval" className="input-field" value={formData.verificationScaleInterval} onChange={handleChange} />
              </div>
              <div className="form-group mb-0">
                <label>Unit of Measurement</label>
                <select name="unitOfMeasurement" className="input-field" value={formData.unitOfMeasurement} onChange={handleChange}>
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                </select>
              </div>
              <div className="form-group mb-0">
                <label>Actual Scale Interval (d)</label>
                <input type="number" step="any" name="actualScaleInterval" className="input-field" value={formData.actualScaleInterval} onChange={handleChange} />
              </div>
              <div className="form-group mb-0">
                <label>No. of Verification Intervals (n = Max / e)</label>
                <input type="number" step="any" name="noOfVerificationIntervals" className="input-field" value={formData.noOfVerificationIntervals} onChange={handleChange} />
              </div>
              <div className="form-group mb-0">
                <label>Maximum Permissible Error (MPE)</label>
                <input type="number" step="any" name="maximumPermissibleError" className="input-field" value={formData.maximumPermissibleError} onChange={handleChange} />
              </div>
              <div className="form-group mb-0">
                <label>Supply Voltage (if electronic)</label>
                <input type="text" name="supplyVoltage" className="input-field" value={formData.supplyVoltage} onChange={handleChange} readOnly />
              </div>
              <div className="form-group mb-0">
                <label>Model Approval No</label>
                <input type="text" name="modelApprovalNo" className="input-field" value={formData.modelApprovalNo} onChange={handleChange} />
              </div>
            </div>
            
            <div className="form-actions mt-6 pt-4 flex gap-3" style={{ borderTop: '1px solid var(--border-glass)' }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <span className="spinner-inline"></span> : editingId ? 'Update Product' : 'Save Product'}
              </button>
              {editingId && (
                <button type="button" className="btn btn-secondary" onClick={handleCancelEdit} disabled={submitting}>
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
                <th>Type</th>
                <th>Capacity (Max/Min)</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td className="font-medium text-mono">{p.modelid}</td>
                  <td className="text-mono">{p.modelNo || '—'}</td>
                  <td className="font-medium">{p.name}</td>
                  <td>{p.typeOfInstrument || '-'}</td>
                  <td>{p.maximumCapacity ? `${p.maximumCapacity} / ${p.minimumCapacity} ${p.unitOfMeasurement}` : '-'}</td>
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
                      onClick={() => deleteProduct(p.id)}
                      title="Delete"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-muted">No products configured yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
