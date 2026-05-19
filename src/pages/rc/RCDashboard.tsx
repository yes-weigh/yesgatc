import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { PlusCircle, Clock, Check, Users, Zap, ClipboardList } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import type { FirestoreUserDoc, WorkflowMode } from '../../types';

interface VCTOption {
  uid: string;
  username: string;
  email: string;
  workflowMode: WorkflowMode;
}

export const RCDashboard: React.FC = () => {
  const { jobs, createJob, updateJob, addCertificate, products } = useAppContext();
  const { user } = useAuth();

  const [customer,    setCustomer]   = useState('');
  const [product,     setProduct]    = useState('');
  const [serial,      setSerial]     = useState('');
  const [jobType,     setJobType]    = useState<'OV' | 'RV'>('OV');
  const [assignedTo,  setAssignedTo] = useState('');
  const [vctOptions,  setVctOptions] = useState<VCTOption[]>([]);
  const [loadingVCTs, setLoadingVCTs] = useState(true);
  const [submitting,  setSubmitting] = useState(false);

  const pendingJobs = jobs.filter(j => j.status === 'pending_review');

  // Derived: mode of the currently selected VCT
  const selectedVCT = vctOptions.find(v => v.uid === assignedTo) ?? null;
  const inheritedMode: WorkflowMode = selectedVCT?.workflowMode ?? 'auto';

  // Load VCT technicians under this RC Admin's centre
  useEffect(() => {
    if (!user?.uid) return;
    const fetchVCTs = async () => {
      setLoadingVCTs(true);
      const q = query(
        collection(db, 'users'),
        where('role', '==', 'vct'),
        where('rcId', '==', user.uid),
      );
      const snap = await getDocs(q);
      const list: VCTOption[] = snap.docs.map(d => {
        const data = d.data() as FirestoreUserDoc;
        return {
          uid: d.id,
          username: data.username || data.email,
          email: data.email,
          workflowMode: data.workflowMode ?? 'auto',
        };
      });
      setVctOptions(list);
      if (list.length > 0) setAssignedTo(list[0].uid);
      setLoadingVCTs(false);
    };
    fetchVCTs();
  }, [user?.uid]);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer || !product || !serial) return;
    if (!assignedTo) {
      alert('Please add a VCT Technician to your centre first.');
      return;
    }
    setSubmitting(true);
    try {
      await createJob({
        customer,
        product,
        serial,
        jobType,
        status: 'assigned',
        assignedTo,
        technicalData: null,
        photos: [],
        paymentStatus: jobType === 'RV' ? 'pending' : 'not_required',
        rcWorkflowMode: inheritedMode,   // ← auto-inherited from VCT's attribute
        rcApproved: false,
        createdAt: new Date().toISOString(),
        createdByUid: user?.uid,
      });
      setCustomer(''); setProduct(''); setSerial('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (jobId: string) => {
    await updateJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      rcApproved: true,
      paymentStatus: 'paid',
    });
    await addCertificate({ jobId, issuedAt: new Date().toISOString() });
  };

  return (
    <div className="fade-in grid-2">
      <div className="col-stack">
        {/* Create Job */}
        <div className="panel glass">
          <div className="panel-header">
            <h2><PlusCircle className="inline-icon" /> Create Job</h2>
          </div>
          <div className="panel-body">
            <form onSubmit={handleCreateJob} className="form-col">

              {/* VCT assignment + inherited mode */}
              <div className="form-group">
                <label><Users size={14} className="inline-icon-sm" /> Assign to Technician</label>
                {loadingVCTs ? (
                  <div className="text-muted text-sm py-2">
                    <span className="spinner-inline"></span> Loading technicians…
                  </div>
                ) : vctOptions.length === 0 ? (
                  <div className="rc-empty-hint">
                    No VCT Technicians yet — add them via "My Technicians".
                  </div>
                ) : (
                  <select
                    className="input-field"
                    value={assignedTo}
                    onChange={e => setAssignedTo(e.target.value)}
                    required
                  >
                    {vctOptions.map(v => (
                      <option key={v.uid} value={v.uid}>
                        {v.username} ({v.email})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Show the auto-resolved mode as a read-only indicator */}
              {selectedVCT && (
                <div className="inherited-mode-banner">
                  <span className="text-muted" style={{ fontSize: '0.82rem' }}>Job mode for this technician:</span>
                  <span className={`mode-badge ${inheritedMode === 'auto' ? 'mode-auto' : 'mode-manual'}`}>
                    {inheritedMode === 'auto'
                      ? <><Zap size={12} /> Auto-approve</>
                      : <><ClipboardList size={12} /> Manual review</>}
                  </span>
                </div>
              )}

              <div className="form-group">
                <label>Customer Name</label>
                <input type="text" className="input-field" value={customer}
                  onChange={e => setCustomer(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Product</label>
                <select className="input-field" value={product}
                  onChange={e => setProduct(e.target.value)} required>
                  <option value="">Select Product…</option>
                  {products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Serial Number</label>
                <input type="text" className="input-field" value={serial}
                  onChange={e => setSerial(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Job Type</label>
                <select className="input-field" value={jobType}
                  onChange={e => setJobType(e.target.value as 'OV' | 'RV')}>
                  <option value="OV">OV</option>
                  <option value="RV">RV</option>
                </select>
              </div>

              <button
                type="submit"
                className="btn btn-primary mt-2"
                disabled={submitting || vctOptions.length === 0}
              >
                {submitting
                  ? <span className="spinner-inline"></span>
                  : 'Create & Assign Job'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Pending Approvals */}
      <div className="panel glass">
        <div className="panel-header">
          <h2><Clock className="inline-icon text-orange" /> Pending Approvals</h2>
          {pendingJobs.length > 0 && <span className="badge-count">{pendingJobs.length}</span>}
        </div>
        <div className="panel-body p-0">
          <ul className="list-group">
            {pendingJobs.map(job => {
              const assignedVCT = vctOptions.find(v => v.uid === job.assignedTo);
              return (
                <li key={job.id} className="list-item p-4 border-b">
                  <div className="flex justify-between items-start mb-1">
                    <div>
                      <h4 className="font-bold" style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>
                        {job.id.slice(0, 20)}…
                        <span className="text-muted ml-2 font-normal">{job.jobType}</span>
                      </h4>
                      <p className="text-sm mt-1">{job.customer} • {job.product}</p>
                      {assignedVCT && (
                        <p className="text-xs text-muted mt-1">
                          Tech: {assignedVCT.username}
                        </p>
                      )}
                    </div>
                    <button className="btn-approve" onClick={() => handleApprove(job.id)} title="Approve & Issue Certificate">
                      <Check size={18} />
                    </button>
                  </div>
                </li>
              );
            })}
            {pendingJobs.length === 0 && (
              <li className="p-6 text-center text-muted">No jobs pending review.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};
