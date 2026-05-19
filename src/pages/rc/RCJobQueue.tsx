import React, { useState, useMemo, useEffect } from 'react';
import { deleteDoc, doc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { ClipboardList, Search, Filter, Trash2, CheckCircle2, Clock, PlayCircle } from 'lucide-react';
import type { FirestoreUserDoc } from '../../types';

export const RCJobQueue: React.FC = () => {
  const { user } = useAuth();
  const { jobs } = useAppContext();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [vctOptions, setVctOptions] = useState<{uid: string, username: string, email: string}[]>([]);

  useEffect(() => {
    if (!user?.uid) return;
    const fetchVCTs = async () => {
      const q = query(collection(db, 'users'), where('role', '==', 'vct'), where('rcId', '==', user.uid));
      const snap = await getDocs(q);
      setVctOptions(snap.docs.map(d => ({
        uid: d.id,
        username: (d.data() as FirestoreUserDoc).username || '',
        email: (d.data() as FirestoreUserDoc).email || ''
      })));
    };
    fetchVCTs();
  }, [user?.uid]);

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
    if (!confirm('Are you sure you want to cancel and delete this job? This cannot be undone.')) return;
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
    return tech ? tech.username || tech.email : uid.slice(0, 8);
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
        
        {/* Filters */}
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
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', opacity: 0.8 }}>
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
