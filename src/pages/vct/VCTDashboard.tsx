import React, { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Wrench, CreditCard, Camera, UploadCloud, Clock } from 'lucide-react';

export const VCTDashboard: React.FC = () => {
  const { jobs, updateJob, addCertificate } = useAppContext();
  const { user } = useAuth();

  // Only show jobs explicitly assigned to this VCT technician's UID
  const myJobs = jobs.filter(j => j.assignedTo === user?.uid && j.status !== 'completed');

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [mfgYear, setMfgYear]   = useState('');
  const [maxError, setMaxError] = useState('');
  const [sealId, setSealId]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedJob = jobs.find(j => j.id === selectedJobId) ?? null;

  const handleProcessPayment = async () => {
    if (!selectedJob) return;
    if (confirm(`Simulate Zoho Payment Gateway: ₹295 for job ${selectedJob.id.slice(0, 16)}…?`)) {
      await updateJob(selectedJob.id, { paymentStatus: 'paid' });
    }
  };

  const handleSubmitJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJob || !user) return;
    if (selectedJob.jobType === 'RV' && selectedJob.paymentStatus !== 'paid') {
      alert('Payment required for RV jobs before submission.');
      return;
    }
    setSubmitting(true);
    try {
      const technicalData = { mfgYear, maxError, sealId, photos: [] };

      if (selectedJob.rcWorkflowMode === 'auto') {
        await updateJob(selectedJob.id, {
          status: 'completed',
          technicalData,
          completedAt: new Date().toISOString(),
          paymentStatus: selectedJob.jobType === 'RV' ? 'paid' : selectedJob.paymentStatus,
        });
        await addCertificate({
          jobId: selectedJob.id,
          issuedAt: new Date().toISOString(),
          assignedTo: user.uid,   // store VCT UID on certificate
        });
        alert('✅ Auto Mode: Job completed & Certificate generated!');
      } else {
        await updateJob(selectedJob.id, { status: 'pending_review', technicalData });
        alert('📋 Manual Mode: Submitted for RC Admin approval.');
      }

      setSelectedJobId(null);
      setMfgYear(''); setMaxError(''); setSealId('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fade-in grid-2">
      {/* ── Job Queue ── */}
      <div className="panel glass">
        <div className="panel-header">
          <h2><Wrench className="inline-icon text-blue" /> My Job Queue</h2>
          {myJobs.length > 0 && <span className="badge-count">{myJobs.length}</span>}
        </div>
        <div className="panel-body p-0">
          <ul className="list-group">
            {myJobs.map(job => (
              <li
                key={job.id}
                className={`list-item p-4 border-b cursor-pointer ${selectedJobId === job.id ? 'bg-active' : ''}`}
                onClick={() => setSelectedJobId(job.id)}
              >
                <div className="flex justify-between items-start mb-1">
                  <h4 className="font-bold text-mono-xs">
                    {job.id.slice(0, 20)}…
                  </h4>
                  <span className={`status-badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
                </div>
                <p className="text-sm text-muted">{job.customer} • {job.product}</p>
                <p className="text-xs text-muted mt-1">
                  Type: <strong>{job.jobType}</strong> &nbsp;•&nbsp;
                  Payment: <strong>{job.paymentStatus.replace('_', ' ')}</strong> &nbsp;•&nbsp;
                  Mode: <strong className={job.rcWorkflowMode === 'auto' ? 'text-green' : 'text-orange'}>
                    {job.rcWorkflowMode}
                  </strong>
                </p>
              </li>
            ))}
            {myJobs.length === 0 && (
              <li className="p-8 text-center text-muted">No jobs assigned to you yet.</li>
            )}
          </ul>
        </div>
      </div>

      {/* ── Process Form ── */}
      <div className="panel glass">
        <div className="panel-header">
          <h2>Process Job</h2>
        </div>
        <div className="panel-body">
          {!selectedJob ? (
            <div className="empty-state">
              <Camera size={48} className="text-muted empty-state-icon" />
              <p className="text-muted text-center">Select a job from the queue to start processing</p>
            </div>
          ) : selectedJob.status === 'pending_review' ? (
            <div className="text-center py-8">
              <Clock size={32} className="text-orange icon-block-center" />
              <p className="font-medium">Awaiting RC Admin Approval</p>
              <p className="text-muted text-sm mt-2">
                Job submitted and waiting for review.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmitJob} className="form-col">
              <div className="job-info-banner">
                <p><span className="text-muted">Customer:</span> <strong>{selectedJob.customer}</strong></p>
                <p><span className="text-muted">Product:</span> {selectedJob.product} — S/N: <strong>{selectedJob.serial}</strong></p>
                <p>
                  <span className="text-muted">Mode:</span>&nbsp;
                  <span className={selectedJob.rcWorkflowMode === 'auto' ? 'text-green' : 'text-orange'}>
                    {selectedJob.rcWorkflowMode === 'auto' ? '⚡ Auto-approve' : '📋 Manual review'}
                  </span>
                </p>
              </div>

              <div className="form-group">
                <label htmlFor="mfgYear">Manufacturing Year</label>
                <input id="mfgYear" type="text" className="input-field" placeholder="e.g. 2024" value={mfgYear} onChange={e => setMfgYear(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="maxError">Max Error</label>
                <input id="maxError" type="text" className="input-field" placeholder="e.g. ±0.2%" value={maxError} onChange={e => setMaxError(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="sealId">Seal ID</label>
                <input id="sealId" type="text" className="input-field" placeholder="e.g. SEAL-2024-001" value={sealId} onChange={e => setSealId(e.target.value)} required />
              </div>

              <div className="form-group">
                <label>Site Photos</label>
                <div className="upload-box">
                  <UploadCloud size={24} className="text-muted icon-block-center" />
                  <span className="text-sm text-muted">Click to upload photos</span>
                </div>
              </div>

              {selectedJob.jobType === 'RV' && selectedJob.paymentStatus !== 'paid' && (
                <div className="payment-banner">
                  <span>RV Job requires payment: <strong>₹295</strong></span>
                  <button type="button" className="btn-pay" onClick={handleProcessPayment}>
                    <CreditCard size={16} /> Pay Now
                  </button>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary w-full mt-4"
                disabled={submitting || (selectedJob.jobType === 'RV' && selectedJob.paymentStatus !== 'paid')}
              >
                {submitting ? <span className="spinner-inline"></span> : 'Submit for Processing'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
