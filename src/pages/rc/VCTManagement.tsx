import React, { useState, useEffect, useCallback } from 'react';
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
  phone: string;
  aadhar: string;
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
  const [newPhone,         setNewPhone]        = useState('');
  const [newAadhar,        setNewAadhar]       = useState('');
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

  const fetchVCTs = useCallback(async () => {
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
  }, [user]);

  useEffect(() => {
    Promise.resolve().then(() => fetchVCTs());
  }, [fetchVCTs]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');

    const cleanPhone = newPhone.trim();
    const cleanAadhar = newAadhar.trim();

    if (!newName.trim()) {
      setError('Please enter a technician name.');
      return;
    }
    if (!/^\d{10}$/.test(cleanPhone)) {
      setError('Phone number must be exactly 10 digits.');
      return;
    }
    if (!/^\d{12}$/.test(cleanAadhar)) {
      setError('Aadhar number must be exactly 12 digits.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const email = `${cleanPhone}@yesweigh.in`;
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, newPassword);
      await secondaryAuth.signOut();

      const profile: FirestoreUserDoc = {
        email,
        role: 'vct',
        username: newName.trim(),
        phone: cleanPhone,
        aadhar: cleanAadhar,
        clearTextPassword: newPassword,
        workflowMode: newMode,
        createdAt: new Date().toISOString(),
        createdByUid: user?.uid,
        rcId: user?.uid,
      };
      await setDoc(doc(db, 'users', cred.user.uid), profile);

      setSuccess(`✅ Technician "${newName.trim()}" added successfully.`);
      setNewName(''); setNewPhone(''); setNewAadhar(''); setNewPassword(''); setNewMode('auto');
      await fetchVCTs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setError(msg.includes('email-already-in-use') || msg.includes('credential') ? 'That Phone Number is already registered.' : msg);
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (v: VCTRecord) => {
    setEditing({
      uid: v.uid,
      username: v.username,
      phone: v.phone || '',
      aadhar: v.aadhar || '',
      newPassword: '',
      workflowMode: v.workflowMode ?? 'auto'
    });
    setEditShowPw(false);
  };

  const cancelEdit = () => setEditing(null);

  const handleSaveEdit = async () => {
    if (!editing) return;
    
    const cleanPhone = editing.phone.trim();
    const cleanAadhar = editing.aadhar.trim();
    if (!/^\d{10}$/.test(cleanPhone)) {
      alert('Phone number must be exactly 10 digits.');
      return;
    }
    if (!/^\d{12}$/.test(cleanAadhar)) {
      alert('Aadhar number must be exactly 12 digits.');
      return;
    }

    setSavingEdit(true);
    try {
      const updates: Partial<FirestoreUserDoc> = {
        username: editing.username.trim(),
        phone: cleanPhone,
        aadhar: cleanAadhar,
        workflowMode: editing.workflowMode,
      };
      if (editing.newPassword.length >= 6) {
        updates.clearTextPassword = editing.newPassword;
      }
      await updateDoc(doc(db, 'users', editing.uid), updates);
      setSuccess(`✅ Technician "${editing.username}" updated successfully.`);
      setEditing(null);
      await fetchVCTs();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update technician');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (uid: string, identifier: string) => {
    if (!confirm(`Remove technician "${identifier}" from your centre?`)) return;
    await deleteDoc(doc(db, 'users', uid));
    await fetchVCTs();
  };

  const toggleReveal = (uid: string) => {
    setRevealedUids(prev => {
      const n = new Set(prev);
      if (n.has(uid)) {
        n.delete(uid);
      } else {
        n.add(uid);
      }
      return n;
    });
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
          <form className="vct-create-grid" onSubmit={handleCreate} autoComplete="off">
            <div className="form-group">
              <label htmlFor="vct-fullname">Full Name</label>
              <input id="vct-fullname" type="text" className="input-field" placeholder="e.g. Amit Sharma"
                value={newName} onChange={e => setNewName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label htmlFor="vct-phone">Phone Number</label>
              <input id="vct-phone" type="text" className="input-field" placeholder="10-digit Phone"
                value={newPhone} onChange={e => setNewPhone(e.target.value)} required maxLength={10} />
            </div>
            <div className="form-group">
              <label htmlFor="vct-aadhar">Aadhar Number</label>
              <input id="vct-aadhar" type="text" className="input-field" placeholder="12-digit Aadhar"
                value={newAadhar} onChange={e => setNewAadhar(e.target.value)} required minLength={12} maxLength={12} pattern="\d{12}" title="Aadhar number must be exactly 12 digits" />
            </div>
            <div className="form-group">
              <label htmlFor="vct-password">Password</label>
              <div className="input-icon-wrap">
                <input
                  id="vct-password"
                  type={showPw ? 'text' : 'password'}
                  className="input-field"
                  placeholder="min. 6 chars"
                  autoComplete="new-password"
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
              <label htmlFor="vct-jobmode">Job Mode</label>
              <ModeToggle value={newMode} onChange={setNewMode} />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary animate-pulse-subtle" disabled={submitting}>
                {submitting ? <span className="spinner-inline"></span> : <><UserPlus size={16} /> Add</>}
              </button>
            </div>
          </form>
          <p className="text-muted mt-3 text-xs-soft-muted">
            <strong>Auto</strong> — jobs auto-complete after VCT submission. &nbsp;
            <strong>Manual</strong> — jobs go to RC Admin for review.
          </p>
        </div>
      </div>

      {/* ── VCT Table ── */}
      <div className="panel glass">
        <div className="panel-header justify-between">
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
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Aadhar</th>
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
                          <td className="text-muted text-sm">{v.phone || '—'}</td>
                          <td className="text-muted text-sm">{v.aadhar || '—'}</td>
                          <td>
                            <span className={`mode-badge ${v.workflowMode === 'auto' ? 'mode-auto' : 'mode-manual'}`}>
                              {v.workflowMode === 'auto'
                                ? <><Zap size={12} /> Auto</>
                                : <><ClipboardList size={12} /> Manual</>}
                            </span>
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <span className="text-mono text-sm">
                                {revealedUids.has(v.uid) ? (v.clearTextPassword ?? '—') : '••••••••'}
                              </span>
                              <button className="btn-icon" onClick={() => toggleReveal(v.uid)}>
                                {revealedUids.has(v.uid) ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            </div>
                          </td>
                          <td className="text-muted text-xs-soft">
                            {v.createdAt ? new Date(v.createdAt).toLocaleDateString('en-IN') : '—'}
                          </td>
                          <td className="text-right flex gap-2 justify-end">
                            <button className="btn-icon text-blue" onClick={() => startEdit(v)} title="Edit">
                              <Pencil size={16} />
                            </button>
                            <button className="btn-icon text-red" onClick={() => handleDelete(v.uid, v.username || v.phone || '')} title="Remove">
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
                              placeholder="Name"
                              title="Edit Username"
                              value={editing.username}
                              onChange={e => setEditing(p => p ? { ...p, username: e.target.value } : null)}
                            />
                          </td>
                          <td>
                            <input type="text" className="input-field input-sm"
                              placeholder="Phone"
                              maxLength={10}
                              title="Edit Phone"
                              value={editing.phone}
                              onChange={e => setEditing(p => p ? { ...p, phone: e.target.value } : null)}
                            />
                          </td>
                          <td>
                            <input type="text" className="input-field input-sm"
                              placeholder="Aadhar"
                              minLength={12}
                              maxLength={12}
                              pattern="\d{12}"
                              title="Aadhar number must be exactly 12 digits"
                              value={editing.aadhar}
                              onChange={e => setEditing(p => p ? { ...p, aadhar: e.target.value } : null)}
                              required
                            />
                          </td>
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
                          <td className="text-right flex gap-2 justify-end">
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
                    <tr><td colSpan={7} className="text-center py-10 text-muted">No technicians yet. Add one above.</td></tr>
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
