import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Clock, Check } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import type { FirestoreUserDoc, WorkflowMode } from '../../types';

interface VCTOption {
  uid: string;
  username: string;
  phone?: string;
  email?: string;
  workflowMode: WorkflowMode;
}

export const RCDashboard: React.FC = () => {
  const { jobs, updateJob, addCertificate } = useAppContext();
  const { user } = useAuth();
  const [vctOptions, setVctOptions] = useState<VCTOption[]>([]);

  const pendingJobs = jobs.filter(j => j.status === 'pending_review');

  // Load VCT technicians to resolve their names
  useEffect(() => {
    if (!user?.uid) return;
    const fetchVCTs = async () => {
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
          username: data.username || data.aadhar,
          phone: data.phone,
          email: data.email,
          workflowMode: data.workflowMode ?? 'auto',
        };
      });
      setVctOptions(list);
    };
    fetchVCTs();
  }, [user?.uid]);

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
        {/* Removed Create Job Panel from Dashboard */}
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
                      <h4 className="font-bold text-mono-xs">
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
