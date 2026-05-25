import React, { useState, useMemo, useEffect } from 'react';
import { deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { fetchRcVctUsers } from '../../lib/rcVctMembers';
import { ClipboardList, Search, Filter, Trash2, CheckCircle2, Clock, PlayCircle, Plus, X, Zap, Users } from 'lucide-react';
import { formatTechnicianLabel } from '../../lib/contactFields';
import { isVctOperational } from '../../lib/vctApproval';
import type { WorkflowMode } from '../../types';

interface VCTOption {
  uid: string;
  username: string;
  phone?: string;
  email?: string;
  workflowMode: WorkflowMode;
}

export const RCJobQueue: React.FC = () => {
  const { user } = useAuth();
  const { jobs, createJob, products } = useAppContext();
  const confirm = useConfirm();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [vctOptions, setVctOptions] = useState<VCTOption[]>([]);
  const [loadingVCTs, setLoadingVCTs] = useState(true);

  // Form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [customer, setCustomer] = useState('');
  const [product, setProduct] = useState('');
  const [serial, setSerial] = useState('');
  const [jobType, setJobType] = useState<'OV' | 'RV'>('OV');
  const [assignedTo, setAssignedTo] = useState('');

  // Derived: mode of the currently selected VCT
  const selectedVCT = vctOptions.find(v => v.uid === assignedTo) ?? null;
  const inheritedMode: WorkflowMode = selectedVCT?.workflowMode ?? 'auto';

  useEffect(() => {
    if (!user?.uid) return;
    const fetchVCTs = async () => {
      setLoadingVCTs(true);
      const records = await fetchRcVctUsers(user.uid);
      const list = records
        .filter(data => isVctOperational(data))
        .map(data => ({
          uid: data.uid,
          username: data.username || '',
          phone: data.phone,
          email: data.email,
          workflowMode: data.workflowMode ?? 'auto',
        }));
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
        rcWorkflowMode: inheritedMode,
        rcApproved: false,
        createdAt: new Date().toISOString(),
        createdByUid: user?.uid,
      });
      setCustomer(''); setProduct(''); setSerial('');
      setShowAddForm(false);
    } finally {
      setSubmitting(false);
    }
  };

  // Only show jobs created by this RC Admin
  const myJobs = useMemo(() => {
    return jobs.filter(j => j.createdByUid === user?.uid);
  }, [jobs, user?.uid]);

  const filteredJobs = useMemo(() => {
    return myJobs.filter(job => {
      const matchesStatus = statusFilter === 'all' || job.status === statusFilter;
      const term = searchTerm.toLowerCase();
      const matchesSearch = 
        job.id.toLowerCase().includes(term) ||
        job.customer.toLowerCase().includes(term) ||
        job.serial.toLowerCase().includes(term);
        
      return matchesStatus && matchesSearch;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [myJobs, statusFilter, searchTerm]);

  const handleDelete = async (jobId: string) => {
    const ok = await confirm({
      title: 'Delete job?',
      message: 'Are you sure you want to cancel and delete this job? This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'jobs', jobId));
    } catch (err) {
      console.error("Error deleting job:", err);
      alert("Failed to delete job.");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return <span className="status-badge status-completed"><CheckCircle2 size={12} /> Completed</span>;
      case 'pending_review': return <span className="status-badge status-pending"><Clock size={12} /> Pending Review</span>;
      case 'assigned': return <span className="status-badge status-assigned"><PlayCircle size={12} /> Assigned</span>;
      default: return <span className="status-badge">{status}</span>;
    }
  };

  const getTechName = (uid: string) => {
    const tech = vctOptions.find((v) => v.uid === uid);
    return tech ? formatTechnicianLabel(tech) : uid.slice(0, 8);
  };

  return (
    <div className="fade-in max-w-6xl mx-auto">
      <div className="flex justify-between items-end mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
            <ClipboardList className="text-blue" /> Master Job Queue
          </h1>
          <p className="text-muted">Manage and track all jobs created by your Regional Center.</p>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="btn btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3" onClick={() => setShowAddForm(p => !p)}>
            {showAddForm ? <X size={15} /> : <Plus size={15} />}
            {showAddForm ? 'Cancel' : 'Create New Job'}
          </button>
        </div>
      </div>

      {/* Create Job Form */}
      {showAddForm && (
        <div className="panel glass mb-6 fade-in">
          <div className="panel-header">
            <h2><Plus className="inline-icon" /> Create Job</h2>
          </div>
          <div className="panel-body">
            <form onSubmit={handleCreateJob} className="vct-create-grid">
              <div className="form-group">
                <label htmlFor="job-vct"><Users size={14} className="inline-icon-sm" /> Assign to Technician</label>
                {loadingVCTs ? (
                  <div className="text-muted text-sm py-2">
                    <span className="spinner-inline"></span> Loading technicians…
                  </div>
                ) : vctOptions.length === 0 ? (
                  <div className="rc-empty-hint">
                    No VCT technicians yet — add them via VCT.
                  </div>
                ) : (
                  <select
                    id="job-vct"
                    className="input-field"
                    value={assignedTo}
                    onChange={e => setAssignedTo(e.target.value)}
                    required
                  >
                    {vctOptions.map(v => (
                      <option key={v.uid} value={v.uid}>
                        {formatTechnicianLabel(v)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {selectedVCT && (
                <div className="inherited-mode-banner">
                  <span className="text-muted text-xs-soft">Job mode for this technician:</span>
                  <span className={`mode-badge ${inheritedMode === 'auto' ? 'mode-auto' : 'mode-manual'}`}>
                    {inheritedMode === 'auto'
                      ? <><Zap size={12} /> Auto-approve</>
                      : <><ClipboardList size={12} /> Manual review</>}
                  </span>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="job-customer">Customer Name</label>
                <input id="job-customer" type="text" className="input-field" placeholder="Customer Name" value={customer}
                  onChange={e => setCustomer(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="job-product">Product</label>
                <select id="job-product" className="input-field" value={product}
                  onChange={e => setProduct(e.target.value)} required>
                  <option value="">Select Product…</option>
                  {products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="job-serial">Serial Number</label>
                <input id="job-serial" type="text" className="input-field" placeholder="Serial Number" value={serial}
                  onChange={e => setSerial(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="job-type">Job Type</label>
                <select id="job-type" className="input-field" value={jobType}
                  onChange={e => setJobType(e.target.value as 'OV' | 'RV')}>
                  <option value="OV">OV</option>
                  <option value="RV">RV</option>
                </select>
              </div>

              <div className="form-actions mt-2 col-span-all">
                <button type="submit" className="btn btn-primary" disabled={submitting || vctOptions.length === 0}>
                  {submitting ? <span className="spinner-inline"></span> : <><Plus size={16} /> Create & Assign Job</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex justify-end items-end mb-4 flex-wrap gap-4">
        <div className="flex gap-3 flex-wrap">
          <div className="search-wrap">
            <Search size={16} className="search-icon" />
            <input 
              type="text" 
              className="search-input" 
              placeholder="Search ID, customer, serial..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-2 bg-dark-glass px-3 py-1.5 rounded-lg border border-white-5">
            <Filter size={16} className="text-muted" />
            <select 
              id="status-filter"
              title="Filter by Status"
              className="bg-transparent text-sm outline-none cursor-pointer"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="assigned">In Progress (Assigned)</option>
              <option value="pending_review">Pending Review</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>
      </div>

      <div className="panel glass">
        <div className="panel-body p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Customer & Product</th>
                <th>Serial / Type</th>
                <th>Technician</th>
                <th>Status</th>
                <th>Workflow</th>
                <th>Created</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map(job => (
                <tr key={job.id}>
                  <td className="text-mono-muted">
                    {job.id.slice(0, 16)}...
                  </td>
                  <td>
                    <div className="font-medium">{job.customer}</div>
                    <div className="text-xs text-muted">{job.product}</div>
                  </td>
                  <td>
                    <div className="font-medium">{job.serial}</div>
                    <div className="text-xs font-bold text-blue-soft">{job.jobType}</div>
                  </td>
                  <td className="text-sm">{getTechName(job.assignedTo)}</td>
                  <td>{getStatusBadge(job.status)}</td>
                  <td>
                    <span className={`workflow-pill ${job.rcWorkflowMode === 'auto' ? 'mode-auto' : 'mode-manual'}`}>
                      {job.rcWorkflowMode.toUpperCase()}
                    </span>
                  </td>
                  <td className="text-muted text-sm">
                    {new Date(job.createdAt).toLocaleDateString('en-IN', {
                      day: '2-digit', month: 'short', year: 'numeric'
                    })}
                  </td>
                  <td className="text-right">
                    {job.status === 'assigned' ? (
                      <button 
                        className="btn-icon text-red" 
                        onClick={() => handleDelete(job.id)}
                        title="Cancel Job"
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredJobs.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted">
                    No jobs found matching your criteria.
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
