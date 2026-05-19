import React, { useState, useEffect } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import {
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where,
} from 'firebase/firestore';
import { secondaryAuth, db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import {
  UserPlus, Trash2, Eye, EyeOff, RefreshCw, Users, Pencil, X, Check, Zap, ClipboardList,
} from 'lucide-react';
import type { FirestoreUserDoc, WorkflowMode } from '../../types';

interface VCTRecord extends FirestoreUserDoc {
  uid: string;
}

interface EditState {
  uid: string;
  username: string;
  newPassword: string;
  workflowMode: WorkflowMode;
}

const ModeToggle = ({
  value,
  onChange,
}: {
  value: WorkflowMode;
  onChange: (m: WorkflowMode) => void;
}) => (
  <div className="mode-toggle">
    <button
      type="button"
      className={`mode-btn ${value === 'auto' ? 'active-auto' : ''}`}
      onClick={() => onChange('auto')}
    >
      <Zap size={13} /> Auto
    </button>
    <button
      type="button"
      className={`mode-btn ${value === 'manual' ? 'active-manual' : ''}`}
      onClick={() => onChange('manual')}
    >
      <ClipboardList size={13} /> Manual
    </button>
  </div>
);

export const VCTManagement: React.FC = () => {
  const { user } = useAuth();
  const [vcts, setVcts] = useState<VCTRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [newName,          setNewName]         = useState('');
  const [newEmail,         setNewEmail]        = useState('');
  const [newPassword,      setNewPassword]     = useState('');
  const [newMode,          setNewMode]         = useState<WorkflowMode>('auto');
  const [showPw,           setShowPw]          = useState(false);
  const [submitting,       setSubmitting]      = useState(false);
  const [error,            setError]           = useState('');
  const [success,          setSuccess]         = useState('');

  // Edit state
  const [editing,     setEditing]     = useState<EditState | null>(null);
  const [editShowPw,  setEditShowPw]  = useState(false);
  const [savingEdit,  setSavingEdit]  = useState(false);

  const [revealedUids, setRevealedUids] = useState<Set<string>>(new Set());

  const fetchVCTs = async () => {
    if (!user?.uid) return;
    setLoading(true);
    const q = query(
      collection(db, 'users'),
      where('role', '==', 'vct'),
      where('rcId', '==', user.uid),
    );
    const snap = await getDocs(q);
    setVcts(snap.docs.map(d => ({ uid: d.id, ...(d.data() as FirestoreUserDoc) })));
    setLoading(false);
  };

  useEffect(() => { fetchVCTs(); }, [user?.uid]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    setSubmitting(true);
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, newEmail, newPassword);
      await secondaryAuth.signOut();

      const profile: FirestoreUserDoc = {
        email: newEmail,
        role: 'vct',
        username: newName || newEmail.split('@')[0],
        clearTextPassword: newPassword,
        workflowMode: newMode,          // ← set per-VCT mode
        createdAt: new Date().toISOString(),
        createdByUid: user?.uid,
        rcId: user?.uid,
      };
      await setDoc(doc(db, 'users', cred.user.uid), profile);

      setSuccess(`✅ Technician "${newEmail}" added (${newMode === 'auto' ? 'Auto-approve' : 'Manual review'} mode).`);
      setNewName(''); setNewEmail(''); setNewPassword(''); setNewMode('auto');
      await fetchVCTs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setError(msg.includes('email-already-in-use') ? 'That email is already registered.' : msg);
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (v: VCTRecord) => {
    setEditing({ uid: v.uid, username: v.username, newPassword: '', workflowMode: v.workflowMode ?? 'auto' });
    setEditShowPw(false);
  };

  const cancelEdit = () => setEditing(null);

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    const updates: Partial<FirestoreUserDoc> = {
      username: editing.username,
      workflowMode: editing.workflowMode,
    };
    if (editing.newPassword.length >= 6) updates.clearTextPassword = editing.newPassword;
    await updateDoc(doc(db, 'users', editing.uid), updates);
    setSavingEdit(false);
    setEditing(null);
    await fetchVCTs();
  };

  const handleDelete = async (uid: string, email: string) => {
    if (!confirm(`Remove technician "${email}" from your centre?`)) return;
    await deleteDoc(doc(db, 'users', uid));
    await fetchVCTs();
  };

  const toggleReveal = (uid: string) => {
    setRevealedUids(prev => { const n = new Set(prev); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  };

  return (
    <div className="fade-in max-w-5xl mx-auto">
      {/* ── Create VCT ── */}
      <div className="panel glass mb-6">
        <div className="panel-header">
          <h2><UserPlus className="inline-icon" /> Add VCT Technician</h2>
        </div>
        <div className="panel-body">
          {error   && <div className="login-error mb-4">{error}</div>}
          {success && <div className="login-success mb-4">{success}</div>}
          <form className="vct-create-grid" onSubmit={handleCreate}>
            <div className="form-group">
              <label>Full Name</label>
              <input type="text" className="input-field" placeholder="e.g. Amit Sharma"
                value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <input type="email" className="input-field" placeholder="tech@example.com"
                value={newEmail} onChange={e => setNewEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <div className="input-icon-wrap">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input-field"
                  placeholder="min. 6 characters"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required minLength={6}
                />
                <button type="button" className="input-icon-right" onClick={() => setShowPw(p => !p)}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>Job Mode</label>
              <ModeToggle value={newMode} onChange={setNewMode} />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <span className="spinner-inline"></span> : <><UserPlus size={16} /> Add</>}
              </button>
            </div>
          </form>
          <p className="text-muted mt-3" style={{ fontSize: '0.8rem', opacity: 0.6 }}>
            <strong>Auto</strong> — jobs auto-complete after VCT submission. &nbsp;
            <strong>Manual</strong> — jobs go to RC Admin for review.
          </p>
        </div>
      </div>

      {/* ── VCT Table ── */}
      <div className="panel glass">
        <div className="panel-header" style={{ justifyContent: 'space-between' }}>
          <h2>
            <Users className="inline-icon" /> My Technicians
            {vcts.length > 0 && <span className="badge-count">{vcts.length}</span>}
          </h2>
          <button className="btn-icon" onClick={fetchVCTs} title="Refresh"><RefreshCw size={18} /></button>
        </div>
        <div className="panel-body p-0">
          {loading ? (
            <div className="py-10 text-center"><span className="spinner-inline large"></span></div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Job Mode</th>
                  <th>Password</th>
                  <th>Created</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vcts.map(v => (
                  <React.Fragment key={v.uid}>
                    {/* Normal row */}
                    {editing?.uid !== v.uid && (
                      <tr>
                        <td className="font-medium">{v.username || '—'}</td>
                        <td className="text-muted" style={{ fontSize: '0.85rem' }}>{v.email}</td>
                        <td>
                          <span className={`mode-badge ${v.workflowMode === 'auto' ? 'mode-auto' : 'mode-manual'}`}>
                            {v.workflowMode === 'auto'
                              ? <><Zap size={12} /> Auto</>
                              : <><ClipboardList size={12} /> Manual</>}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                              {revealedUids.has(v.uid) ? (v.clearTextPassword ?? '—') : '••••••••'}
                            </span>
                            <button className="btn-icon" onClick={() => toggleReveal(v.uid)}>
                              {revealedUids.has(v.uid) ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                        </td>
                        <td className="text-muted" style={{ fontSize: '0.8rem' }}>
                          {v.createdAt ? new Date(v.createdAt).toLocaleDateString('en-IN') : '—'}
                        </td>
                        <td className="text-right" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button className="btn-icon text-blue" onClick={() => startEdit(v)} title="Edit">
                            <Pencil size={16} />
                          </button>
                          <button className="btn-icon text-red" onClick={() => handleDelete(v.uid, v.email)} title="Remove">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    )}

                    {/* Inline edit row */}
                    {editing?.uid === v.uid && (
                      <tr className="edit-row">
                        <td>
                          <input type="text" className="input-field input-sm"
                            value={editing.username}
                            onChange={e => setEditing(p => p ? { ...p, username: e.target.value } : null)}
                          />
                        </td>
                        <td className="text-muted" style={{ fontSize: '0.85rem' }}>{v.email}</td>
                        <td>
                          <ModeToggle
                            value={editing.workflowMode}
                            onChange={m => setEditing(p => p ? { ...p, workflowMode: m } : null)}
                          />
                        </td>
                        <td>
                          <div className="input-icon-wrap">
                            <input
                              type={editShowPw ? 'text' : 'password'}
                              className="input-field input-sm"
                              placeholder="New password (optional)"
                              value={editing.newPassword}
                              onChange={e => setEditing(p => p ? { ...p, newPassword: e.target.value } : null)}
                            />
                            <button type="button" className="input-icon-right" onClick={() => setEditShowPw(p => !p)}>
                              {editShowPw ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                        </td>
                        <td></td>
                        <td className="text-right" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button className="btn-approve" onClick={handleSaveEdit} disabled={savingEdit} title="Save">
                            {savingEdit ? <span className="spinner-inline"></span> : <Check size={16} />}
                          </button>
                          <button className="btn-icon text-muted" onClick={cancelEdit} title="Cancel">
                            <X size={16} />
                          </button>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {vcts.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-10 text-muted">No technicians yet. Add one above.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
