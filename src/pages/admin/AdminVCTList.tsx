import React, { useState, useEffect, useCallback } from 'react';
import { collection, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useConfirm } from '../../context/ConfirmContext';
import { Users, Building2, RefreshCw, Trash2, Zap, ClipboardList } from 'lucide-react';
import type { FirestoreUserDoc } from '../../types';

interface VCTRecord extends FirestoreUserDoc {
  uid: string;
  rcCenterName: string;
}

export const AdminVCTList: React.FC = () => {
  const confirm = useConfirm();
  const [vctList, setVctList] = useState<VCTRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVCTs = useCallback(async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, 'users'));
    const allUsers = snap.docs.map(d => ({ uid: d.id, ...(d.data() as FirestoreUserDoc) }));

    const rcByUid = new Map<string, string>();
    allUsers
      .filter(u => u.role === 'rc_admin')
      .forEach(rc => {
        rcByUid.set(rc.uid, rc.companyName || rc.username || '—');
      });

    const vcts: VCTRecord[] = allUsers
      .filter(u => u.role === 'vct')
      .map(v => ({
        ...v,
        rcCenterName: (v.rcId && rcByUid.get(v.rcId)) || '—',
      }));

    vcts.sort((a, b) => a.rcCenterName.localeCompare(b.rcCenterName) || (a.username || '').localeCompare(b.username || ''));
    setVctList(vcts);
    setLoading(false);
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => fetchVCTs());
  }, [fetchVCTs]);

  const handleDelete = async (uid: string, name: string) => {
    const ok = await confirm({
      title: 'Remove technician?',
      message: `Remove VCT technician "${name}"?\nThey will lose access immediately.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    try {
      await deleteDoc(doc(db, 'users', uid));
      await fetchVCTs();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove technician.');
    }
  };

  return (
    <div className="fade-in page-content">
      <div className="stats-grid mb-6">
        <div className="stat-card glass">
          <div className="stat-icon text-green"><Users /></div>
          <div className="stat-content">
            <h3>VCT Technicians</h3>
            <p className="stat-value">{vctList.length}</p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-blue"><Building2 /></div>
          <div className="stat-content">
            <h3>Regional centers represented</h3>
            <p className="stat-value">
              {new Set(vctList.map(v => v.rcId).filter(Boolean)).size}
            </p>
          </div>
        </div>
      </div>

      <div className="panel glass panel--table mb-6">
        <div className="panel-header justify-between">
          <div>
            <h2>
              <Users className="inline-icon" /> VCT Technicians
            </h2>
            <p className="text-muted text-sm mt-1">
              All verification technicians across regional centers. Managed by each RC admin.
            </p>
          </div>
          <button className="btn-icon" onClick={fetchVCTs} title="Refresh" type="button">
            <RefreshCw size={18} />
          </button>
        </div>
        <div className="panel-body p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <span className="spinner-inline large"></span>
            </div>
          ) : (
            <div className="table-scroll-wrap">
              <table className="data-table data-table--vct">
                <thead>
                  <tr>
                    <th className="vct-col-name">Name</th>
                    <th className="vct-col-rc">Regional Center</th>
                    <th className="vct-col-phone">Phone</th>
                    <th className="vct-col-mode">Job Mode</th>
                    <th className="vct-col-created">Created</th>
                    <th className="text-right vct-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vctList.map(v => (
                    <tr key={v.uid}>
                      <td className="vct-col-name font-medium table-cell-truncate" title={v.username}>
                        {v.username || '—'}
                      </td>
                      <td className="vct-col-rc table-cell-truncate" title={v.rcCenterName}>
                        {v.rcCenterName}
                      </td>
                      <td className="vct-col-phone text-sm">{v.phone || '—'}</td>
                      <td className="vct-col-mode">
                        <span
                          className={`mode-badge ${v.workflowMode === 'auto' ? 'mode-auto' : 'mode-manual'}`}
                        >
                          {v.workflowMode === 'auto' ? (
                            <>
                              <Zap size={12} /> Auto
                            </>
                          ) : (
                            <>
                              <ClipboardList size={12} /> Manual
                            </>
                          )}
                        </span>
                      </td>
                      <td className="vct-col-created text-muted text-sm">
                        {v.createdAt ? new Date(v.createdAt).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td className="vct-col-actions text-right">
                        <button
                          type="button"
                          className="btn-icon text-red"
                          onClick={() => handleDelete(v.uid, v.username || v.aadhar)}
                          title="Remove"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {vctList.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-muted">
                        No VCT technicians registered yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
