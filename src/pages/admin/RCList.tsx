import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import {
  assertAadharAvailable,
  authErrorMessage,
  createAuthUserForAadhar,
  formatAadharDisplay,
  isValidAadhar,
  normalizeAadhar,
  syncAuthPassword,
} from '../../lib/aadharAuth';
import { isValidPhone, normalizePhone, requireValidEmail } from '../../lib/contactFields';
import {
  Building2, Users, CheckCircle2, Briefcase, CreditCard, FileText, RefreshCw, MapPin, Phone, Mail,
  Plus, Edit2, Trash2, Eye, EyeOff, Save, X,
} from 'lucide-react';
import type { FirestoreUserDoc } from '../../types';

interface RCRecord extends FirestoreUserDoc {
  uid: string;
  vctCount: number;
  totalJobs: number;
  completedJobs: number;
}

export const RCList: React.FC = () => {
  const { user } = useAuth();
  const { jobs } = useAppContext();
  const [rcList, setRcList] = useState<RCRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newAadhar, setNewAadhar] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newGstNumber, setNewGstNumber] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editGstNumber, setEditGstNumber] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [revealedUids, setRevealedUids] = useState<Set<string>>(new Set());

  const fetchRCs = useCallback(async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, 'users'));
    const allUsers = snap.docs.map(d => ({ uid: d.id, ...(d.data() as FirestoreUserDoc) }));
    const rcAdmins = allUsers.filter(u => u.role === 'rc_admin');

    const records: RCRecord[] = rcAdmins.map(rc => {
      const vctCount = allUsers.filter(u => u.role === 'vct' && u.rcId === rc.uid).length;
      const rcJobs = jobs.filter(j => j.createdByUid === rc.uid);
      const completedJobs = rcJobs.filter(j => j.status === 'completed').length;
      return { ...rc, vctCount, totalJobs: rcJobs.length, completedJobs };
    });

    records.sort((a, b) => b.totalJobs - a.totalJobs);
    setRcList(records);
    setLoading(false);
  }, [jobs]);

  useEffect(() => {
    Promise.resolve().then(() => fetchRCs());
  }, [fetchRCs]);

  const toggleExpand = (uid: string) => {
    if (editingUid === uid) return;
    setExpanded(prev => (prev === uid ? null : uid));
  };

  const toggleReveal = (uid: string) => {
    setRevealedUids(prev => {
      const n = new Set(prev);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const cleanAadhar = normalizeAadhar(newAadhar);

    if (!newCompanyName.trim()) {
      setError('Company Name is required.');
      return;
    }
    if (!isValidAadhar(cleanAadhar)) {
      setError('Aadhar number must be exactly 12 digits.');
      return;
    }
    if (!requireValidEmail(newEmail)) {
      setError('A valid contact email is required.');
      return;
    }
    if (!isValidPhone(newPhone)) {
      setError('Phone number must be exactly 10 digits.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await assertAadharAvailable(cleanAadhar);
      const cred = await createAuthUserForAadhar(cleanAadhar, newPassword);

      const profile: FirestoreUserDoc = {
        aadhar: cleanAadhar,
        role: 'rc_admin',
        username: newCompanyName.trim(),
        clearTextPassword: newPassword,
        createdAt: new Date().toISOString(),
        createdByUid: user?.uid,
        rcId: cred.user.uid,
        companyName: newCompanyName.trim(),
        address: newAddress.trim(),
        gstNumber: newGstNumber.trim(),
        email: newEmail.trim(),
        phone: normalizePhone(newPhone),
      };
      await setDoc(doc(db, 'users', cred.user.uid), profile);

      setSuccess(`✅ Center "${newCompanyName.trim()}" registered successfully.`);
      setNewCompanyName('');
      setNewAadhar('');
      setNewEmail('');
      setNewPhone('');
      setNewGstNumber('');
      setNewAddress('');
      setNewPassword('');
      setShowAddForm(false);
      await fetchRCs();
    } catch (err: unknown) {
      setError(authErrorMessage(err, 'Failed to register regional center.'));
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (rc: RCRecord) => {
    setEditingUid(rc.uid);
    setEditCompanyName(rc.companyName || rc.username || '');
    setEditEmail(rc.email || '');
    setEditPhone(rc.phone || '');
    setEditGstNumber(rc.gstNumber || '');
    setEditAddress(rc.address || '');
    setEditPassword('');
  };

  const handleSaveEdit = async (uid: string) => {
    if (!editCompanyName.trim()) {
      alert('Company Name is required.');
      return;
    }
    if (!requireValidEmail(editEmail)) {
      alert('A valid contact email is required.');
      return;
    }
    if (!isValidPhone(editPhone)) {
      alert('Phone number must be exactly 10 digits.');
      return;
    }

    const rc = rcList.find(r => r.uid === uid);
    if (!rc) return;

    setSavingEdit(true);
    try {
      const updates: Partial<FirestoreUserDoc> = {
        companyName: editCompanyName.trim(),
        username: editCompanyName.trim(),
        gstNumber: editGstNumber.trim(),
        address: editAddress.trim(),
        email: editEmail.trim(),
        phone: normalizePhone(editPhone),
      };

      if (editPassword.trim().length >= 6) {
        const current = rc.clearTextPassword;
        if (!current) {
          alert('Cannot reset password: stored credential missing.');
          return;
        }
        await syncAuthPassword(rc.aadhar, current, editPassword.trim());
        updates.clearTextPassword = editPassword.trim();
      }

      await updateDoc(doc(db, 'users', uid), updates);
      setEditingUid(null);
      await fetchRCs();
    } catch (err: unknown) {
      alert(authErrorMessage(err, 'Failed to update regional center.'));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (uid: string, name: string) => {
    if (uid === user?.uid) {
      alert("You can't delete your own account.");
      return;
    }
    if (
      !confirm(
        `⚠️ Are you sure you want to delete Regional Center "${name}"?\nThis will remove their administration access. (Technicians are stored separately).`,
      )
    ) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'users', uid));
      await fetchRCs();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete regional center.');
    }
  };

  return (
    <div className="fade-in">
      <div className="flex justify-between items-center mb-6">
        <div>
          <p className="text-muted text-sm">
            {rcList.length} registered regional center{rcList.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
            onClick={() => setShowAddForm(p => !p)}
          >
            {showAddForm ? <X size={15} /> : <Plus size={15} />}
            {showAddForm ? 'Cancel' : 'Register Regional Center'}
          </button>
          <button className="btn-icon" onClick={fetchRCs} title="Refresh">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="panel glass mb-6 fade-in">
          <div className="panel-header">
            <h2><Building2 className="inline-icon" /> Register New Regional Center</h2>
          </div>
          <div className="panel-body">
            {error && <div className="login-error mb-4">{error}</div>}
            {success && <div className="login-success mb-4">{success}</div>}
            <form onSubmit={handleCreate} className="vct-create-grid" autoComplete="off">
              <div className="form-group">
                <label>Company / Center Name</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Meezan Electronic Scales"
                  value={newCompanyName}
                  onChange={e => setNewCompanyName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Aadhar Number (login ID)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input-field"
                  placeholder="12-digit Aadhar"
                  value={newAadhar}
                  onChange={e => setNewAadhar(e.target.value.replace(/\D/g, '').slice(0, 12))}
                  required
                  maxLength={12}
                />
              </div>
              <div className="form-group">
                <label>Contact Email</label>
                <input
                  type="email"
                  className="input-field"
                  placeholder="rc@example.com"
                  autoComplete="off"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Primary Phone</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input-field"
                  placeholder="10-digit mobile"
                  value={newPhone}
                  onChange={e => setNewPhone(normalizePhone(e.target.value))}
                  required
                  maxLength={10}
                />
              </div>
              <div className="form-group">
                <label>GST Number</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. 27AAAAA1111A1Z1"
                  value={newGstNumber}
                  onChange={e => setNewGstNumber(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Password</label>
                <div className="input-icon-wrap">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="input-field"
                    placeholder="min. 6 characters"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                  <button type="button" className="input-icon-right" onClick={() => setShowPw(p => !p)}>
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="form-group col-span-all">
                <label>Address with Pin</label>
                <textarea
                  className="input-field"
                  rows={3}
                  placeholder="Full physical postal address of the center with pin code"
                  value={newAddress}
                  onChange={e => setNewAddress(e.target.value)}
                />
              </div>
              <div className="form-actions mt-2 col-span-all">
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? (
                    <span className="spinner-inline"></span>
                  ) : (
                    <>
                      <Plus size={16} /> Register Center
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="stats-grid mb-6">
        <div className="stat-card glass">
          <div className="stat-icon text-blue"><Building2 /></div>
          <div className="stat-content">
            <h3>Regional Centers</h3>
            <p className="stat-value">{rcList.length}</p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-green"><Users /></div>
          <div className="stat-content">
            <h3>Total VCT Technicians</h3>
            <p className="stat-value">{rcList.reduce((s, r) => s + r.vctCount, 0)}</p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-orange"><Briefcase /></div>
          <div className="stat-content">
            <h3>Total Jobs</h3>
            <p className="stat-value">{rcList.reduce((s, r) => s + r.totalJobs, 0)}</p>
            <p className="stat-sub">{rcList.reduce((s, r) => s + r.completedJobs, 0)} completed</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <span className="spinner-inline large"></span>
        </div>
      ) : rcList.length === 0 ? (
        <div className="panel glass">
          <div className="panel-body text-center py-16">
            <Building2 size={48} className="text-muted empty-state-icon" />
            <p className="text-muted">No Regional Centers found.</p>
            <p className="text-muted text-sm mt-1">Click &quot;Register Regional Center&quot; above to add one.</p>
          </div>
        </div>
      ) : (
        <div className="rc-cards-grid">
          {rcList.map(rc => {
            const completionRate =
              rc.totalJobs > 0 ? Math.round((rc.completedJobs / rc.totalJobs) * 100) : 0;
            const isExpanded = expanded === rc.uid;

            return (
              <div key={rc.uid} className={`rc-card glass ${isExpanded ? 'expanded' : ''}`}>
                <div className="rc-card-header cursor-pointer" onClick={() => toggleExpand(rc.uid)}>
                  <div className="rc-card-avatar">
                    <Building2 size={20} />
                  </div>
                  <div className="rc-card-title">
                    <h3>{rc.companyName || rc.username}</h3>
                    <p className="text-muted text-xs">
                      {rc.phone || rc.email || formatAadharDisplay(rc.aadhar)}
                    </p>
                  </div>
                  <span className="role-badge badge-rc ml-auto">RC Admin</span>
                </div>

                <div className="rc-card-stats">
                  <div className="rc-stat">
                    <Users size={14} className="text-muted" />
                    <span>{rc.vctCount} VCT</span>
                  </div>
                  <div className="rc-stat">
                    <Briefcase size={14} className="text-muted" />
                    <span>{rc.totalJobs} Jobs</span>
                  </div>
                  <div className="rc-stat">
                    <CheckCircle2 size={14} className="text-green" />
                    <span>{rc.completedJobs} Done</span>
                  </div>
                </div>

                <div className="rc-progress-bar">
                  <div className="rc-progress-fill" style={{ width: `${completionRate}%` }} />
                </div>
                <p className="text-muted text-xxs mt-1">{completionRate}% completion rate</p>

                {isExpanded && (
                  <div className="rc-card-detail">
                    {editingUid === rc.uid ? (
                      <div className="flex flex-col gap-4 mt-2">
                        <div className="form-group">
                          <label
                            htmlFor="edit-company"
                            className="text-xxs uppercase tracking-wider text-muted font-bold"
                          >
                            Company Name
                          </label>
                          <input
                            id="edit-company"
                            type="text"
                            className="input-field input-sm"
                            value={editCompanyName}
                            onChange={e => setEditCompanyName(e.target.value)}
                            required
                          />
                        </div>
                        <div className="form-group">
                          <label className="text-xxs uppercase tracking-wider text-muted font-bold">
                            Login Aadhar
                          </label>
                          <p className="text-sm text-muted">{formatAadharDisplay(rc.aadhar)}</p>
                        </div>
                        <div className="form-group">
                          <label
                            htmlFor="edit-email"
                            className="text-xxs uppercase tracking-wider text-muted font-bold"
                          >
                            Contact Email
                          </label>
                          <input
                            id="edit-email"
                            type="email"
                            className="input-field input-sm"
                            value={editEmail}
                            onChange={e => setEditEmail(e.target.value)}
                            required
                          />
                        </div>
                        <div className="form-group">
                          <label
                            htmlFor="edit-phone"
                            className="text-xxs uppercase tracking-wider text-muted font-bold"
                          >
                            Primary Phone
                          </label>
                          <input
                            id="edit-phone"
                            type="text"
                            inputMode="numeric"
                            className="input-field input-sm"
                            value={editPhone}
                            onChange={e => setEditPhone(normalizePhone(e.target.value))}
                            maxLength={10}
                            required
                          />
                        </div>
                        <div className="form-group">
                          <label
                            htmlFor="edit-gst"
                            className="text-xxs uppercase tracking-wider text-muted font-bold"
                          >
                            GST Number
                          </label>
                          <input
                            id="edit-gst"
                            type="text"
                            className="input-field input-sm"
                            value={editGstNumber}
                            onChange={e => setEditGstNumber(e.target.value)}
                          />
                        </div>
                        <div className="form-group col-span-all">
                          <label
                            htmlFor="edit-address"
                            className="text-xxs uppercase tracking-wider text-muted font-bold"
                          >
                            Address with Pin
                          </label>
                          <textarea
                            id="edit-address"
                            className="input-field input-sm"
                            rows={3}
                            value={editAddress}
                            onChange={e => setEditAddress(e.target.value)}
                          />
                        </div>
                        <div className="form-group col-span-all">
                          <label
                            htmlFor="edit-password"
                            className="text-xxs uppercase tracking-wider text-muted font-bold"
                          >
                            Reset Password (Optional)
                          </label>
                          <input
                            id="edit-password"
                            type="text"
                            className="input-field input-sm text-mono"
                            placeholder="min. 6 characters to reset"
                            value={editPassword}
                            onChange={e => setEditPassword(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-2 justify-end mt-2 col-span-all">
                          <button
                            className="btn btn-primary py-1 px-3 text-xs flex items-center gap-1"
                            onClick={() => handleSaveEdit(rc.uid)}
                            disabled={savingEdit}
                          >
                            {savingEdit ? <span className="spinner-inline"></span> : <><Save size={13} /> Save</>}
                          </button>
                          <button
                            className="btn btn-secondary py-1 px-3 text-xs flex items-center gap-1"
                            onClick={() => setEditingUid(null)}
                          >
                            <X size={13} /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="rc-detail-row">
                          <CreditCard size={13} className="text-muted" />
                          <span>Login Aadhar: {formatAadharDisplay(rc.aadhar)}</span>
                        </div>
                        {rc.phone && (
                          <div className="rc-detail-row">
                            <Phone size={13} className="text-muted" />
                            <span>{rc.phone}</span>
                          </div>
                        )}
                        {rc.email && (
                          <div className="rc-detail-row">
                            <Mail size={13} className="text-muted" />
                            <span>{rc.email}</span>
                          </div>
                        )}
                        {rc.gstNumber && (
                          <div className="rc-detail-row">
                            <FileText size={13} className="text-muted" />
                            <span>GST: {rc.gstNumber}</span>
                          </div>
                        )}
                        {rc.address && (
                          <div className="rc-detail-row">
                            <MapPin size={13} className="text-muted" />
                            <span>{rc.address}</span>
                          </div>
                        )}
                        {!rc.phone && !rc.email && !rc.gstNumber && !rc.address && (
                          <p className="text-muted text-xs-soft">No additional profile data. Click Edit to fill.</p>
                        )}

                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-glass">
                          <span className="text-muted text-xxs font-bold uppercase tracking-wider">Password:</span>
                          <span className="text-mono text-sm">
                            {revealedUids.has(rc.uid) ? (rc.clearTextPassword ?? '—') : '••••••••'}
                          </span>
                          <button
                            className="btn-icon"
                            onClick={e => {
                              e.stopPropagation();
                              toggleReveal(rc.uid);
                            }}
                            title="Toggle Reveal"
                          >
                            {revealedUids.has(rc.uid) ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>

                        <div className="flex gap-2 justify-end mt-4 pt-2 border-t border-glass">
                          <button
                            className="btn-icon text-blue flex items-center gap-1 text-xs"
                            onClick={e => {
                              e.stopPropagation();
                              startEdit(rc);
                            }}
                          >
                            <Edit2 size={14} /> Edit
                          </button>
                          <button
                            className="btn-icon text-red flex items-center gap-1 text-xs"
                            onClick={e => {
                              e.stopPropagation();
                              handleDelete(rc.uid, rc.companyName || rc.username || '');
                            }}
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
