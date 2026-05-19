import React from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Award, Download } from 'lucide-react';

export const Certificates: React.FC = () => {
  const { certificates, jobs } = useAppContext();
  const { user } = useAuth();

  // Show only certificates issued to THIS VCT technician
  const myCerts = certificates.filter(c => c.assignedTo === user?.uid);

  return (
    <div className="fade-in max-w-4xl mx-auto">
      <div className="panel glass">
        <div className="panel-header">
          <h2>
            <Award className="inline-icon text-yellow" /> My Issued Certificates
          </h2>
          {myCerts.length > 0 && <span className="badge-count">{myCerts.length}</span>}
        </div>
        <div className="panel-body p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Certificate ID</th>
                <th>Job Reference</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Date Issued</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {myCerts.map(cert => {
                const job = jobs.find(j => j.id === cert.jobId);
                return (
                  <tr key={cert.id}>
                    <td className="font-bold text-blue" style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {cert.id.slice(0, 16)}…
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {cert.jobId.slice(0, 16)}…
                    </td>
                    <td className="font-medium">{job?.customer ?? '—'}</td>
                    <td>
                      {job && (
                        <span className={`role-badge ${job.jobType === 'OV' ? 'badge-rc' : 'badge-vct'}`}>
                          {job.jobType}
                        </span>
                      )}
                    </td>
                    <td className="text-muted" style={{ fontSize: '0.875rem' }}>
                      {new Date(cert.issuedAt).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      })}
                    </td>
                    <td className="text-right">
                      <button
                        className="btn-icon"
                        title="Download PDF (coming soon)"
                        onClick={() => alert('PDF generation coming soon.')}
                      >
                        <Download size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {myCerts.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-muted">
                    No certificates yet. Complete a job to generate one.
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
