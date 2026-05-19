import React, { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { PackagePlus, Trash2 } from 'lucide-react';

export const Products: React.FC = () => {
  const { products, addProduct, deleteProduct } = useAppContext();

  const [name, setName] = useState('');
  const [ovFee, setOvFee] = useState('150');
  const [rvFee, setRvFee] = useState('295');
  const [submitting, setSubmitting] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    setSubmitting(true);
    try {
      await addProduct({ name, ovFee: Number(ovFee), rvFee: Number(rvFee) });
      setName('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fade-in max-w-4xl mx-auto">
      <div className="panel glass mb-6">
        <div className="panel-header">
          <h2><PackagePlus className="inline-icon" /> Add New Product</h2>
        </div>
        <div className="panel-body">
          <form className="form-grid" onSubmit={handleAdd}>
            <div className="form-group">
              <label>Product Name</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g., Smart Meter X4"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>OV Fee (₹)</label>
              <input
                type="number"
                className="input-field"
                value={ovFee}
                onChange={e => setOvFee(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>RV Fee (₹)</label>
              <input
                type="number"
                className="input-field"
                value={rvFee}
                onChange={e => setRvFee(e.target.value)}
                required
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <span className="spinner-inline"></span> : 'Save Product'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="panel glass">
        <div className="panel-header">
          <h2>Configured Products</h2>
        </div>
        <div className="panel-body p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Product Name</th>
                <th>OV Fee</th>
                <th>RV Fee</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td className="text-muted" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{p.id}</td>
                  <td className="font-medium">{p.name}</td>
                  <td>₹{p.ovFee}</td>
                  <td>₹{p.rvFee}</td>
                  <td className="text-right">
                    <button
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
                  <td colSpan={5} className="text-center py-6 text-muted">No products configured yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
