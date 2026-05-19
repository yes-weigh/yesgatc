import React, { useState, useEffect } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { secondaryAuth, db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { UserPlus, Trash2, Eye, EyeOff, RefreshCw, ShieldCheck, Building2 } from 'lucide-react';
import type { Role, FirestoreUserDoc } from '../../types';
import { ROLE_LABELS } from '../../types';

interface UserRecord extends FirestoreUserDoc {
  uid: string;
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'rc_admin',    label: 'RC Admin' },
  { value: 'vct',         label: 'VCT Technician' },
  { value: 'super_admin', label: 'Super Admin' },
];

export const UserManagement: React.FC = () => {
  const { user } = useAuth();
  const [users,       setUsers]       = useState<UserRecord[]>([]);
  const [rcAdmins,    setRcAdmins]    = useState<UserRecord[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [username,    setUsername]    = useState('');
  const [role,        setRole]        = useState<Role>('rc_admin');
  const [rcId,        setRcId]        = useState('');   // only used when role === 'vct'
  // RC Admin business profile fields
  const [companyName, setCompanyName] = useState('');
  const [phone,       setPhone]       = useState('');
  const [gstNumber,   setGstNumber]   = useState('');
  const [address,     setAddress]     = useState('');
  const [showPw,      setShowPw]      = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');
  const [revealedUids, setRevealedUids] = useState<Set<string>>(new Set());

  const fetchUsers = async () => {
    setLoadingUsers(true);
    const snap = await getDocs(collection(db, 'users'));
    const all = snap.docs.map(d => ({ uid: d.id, ...(d.data() as FirestoreUserDoc) }));
    setUsers(all);
    setRcAdmins(all.filter(u => u.role === 'rc_admin'));
    setLoadingUsers(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  // Reset rcId and RC profile fields when role changes
  useEffect(() => {
    if (role !== 'vct') setRcId('');
    if (role !== 'rc_admin') { setCompanyName(''); setPhone(''); setGstNumber(''); setAddress(''); }
  }, [role]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (role === 'vct' && !rcId) { setError('Please select a Regional Center for this VCT Technician.'); return; }
    setSubmitting(true);
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      await secondaryAuth.signOut();

      const profile: FirestoreUserDoc = {
        email,
        role,
        username: username || email.split('@')[0],
        clearTextPassword: password,
        createdAt: new Date().toISOString(),
        createdByUid: user?.uid,
        ...(role === 'vct'      && { rcId }),
        // RC Admins get their own UID as rcId for self-reference + business profile
        ...(role === 'rc_admin' && {
          rcId: cred.user.uid,
          companyName,
          address,
          phone,
          gstNumber,
        }),
      };
      await setDoc(doc(db, 'users', cred.user.uid), profile);

      setSuccess(`✅ "${email}" created as ${ROLE_LABELS[role]}.`);
      setEmail(''); setPassword(''); setUsername(''); setRole('rc_admin'); setRcId('');
      setCompanyName(''); setPhone(''); setGstNumber(''); setAddress('');
      await fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setError(msg.includes('email-already-in-use') ? 'That email is already registered.' : msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (uid: string, userEmail: string) => {
    if (uid === user?.uid) { alert("You can't delete your own account."); return; }
    if (!confirm(`Remove "${userEmail}" from the system?`)) return;
    await deleteDoc(doc(db, 'users', uid));
    await fetchUsers();
  };

  const toggleReveal = (uid: string) => {
    setRevealedUids(prev => { const n = new Set(prev); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  };

  const roleBadgeClass: Record<Role, string> = {
    super_admin: 'badge-super',
    rc_admin:    'badge-rc',
    vct:         'badge-vct',
  };

  const getRcLabel = (rcId?: string) => {
    if (!rcId) return '—';
    const rc = rcAdmins.find(r => r.uid === rcId);
    return rc ? rc.username || rc.email : rcId;
  };

  return (
    <div className="fade-in max-w-5xl mx-auto">
      {/* ── Create User ── */}
      <div className="panel glass mb-6">
        <div className="panel-header">
          <h2><UserPlus className="inline-icon" /> Create New User</h2>
        </div>
        <div className="panel-body">
          {error   && <div className="login-error mb-4">{error}</div>}
          {success && <div className="login-success mb-4">{success}</div>}

          <form className="user-create-grid" onSubmit={handleCreate}>
            <div className="form-group">
              <label>Full Name</label>
              <input type="text" className="input-field" placeholder="e.g. Rahul Kumar" value={username} onChange={e => setUsername(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <input type="email" className="input-field" placeholder="user@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <div className="input-icon-wrap">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input-field"
                  placeholder="min. 6 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required minLength={6}
                />
                <button type="button" className="input-icon-right" onClick={() => setShowPw(p => !p)}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>Role</label>
              <select className="input-field" value={role} onChange={e => setRole(e.target.value as Role)}>
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>

            {/* RC dropdown — only when creating a VCT technician */}
            {role === 'vct' && (
              <div className="form-group rc-select-group">
                <label><Building2 size={14} className="inline-icon-sm" /> Regional Center</label>
                {rcAdmins.length === 0 ? (
                  <div className="rc-empty-hint">No RC Admins found — create one first.</div>
                ) : (
                  <select className="input-field rc-select-highlight" value={rcId} onChange={e => setRcId(e.target.value)} required>
                    <option value="">Select Regional Center...</option>
                    {rcAdmins.map(rc => (
                      <option key={rc.uid} value={rc.uid}>
                        {rc.username || rc.email} ({rc.email})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* RC Admin profile fields — appear when role = rc_admin */}
            {role === 'rc_admin' && (<>
              <div className="form-group">
                <label>Company Name</label>
                <input type="text" className="input-field" placeholder="e.g. Meezan Electronic Scales Pvt Ltd"
                  value={companyName} onChange={e => setCompanyName(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Mobile / Phone</label>
                <input type="tel" className="input-field" placeholder="e.g. 9995424242"
                  value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              <div className="form-group">
                <label>GST Number (GSTIN)</label>
                <input type="text" className="input-field" placeholder="e.g. 32AAECM1277C1ZY"
                  value={gstNumber} onChange={e => setGstNumber(e.target.value)} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Address</label>
                <input type="text" className="input-field" placeholder="Street, City, State, PIN"
                  value={address} onChange={e => setAddress(e.target.value)} />
              </div>
            </>)}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <span className="spinner-inline"></span> : <><UserPlus size={16} /> Create</>}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ── Users Table ── */}
      <div className="panel glass">
        <div className="panel-header" style={{ justifyContent: 'space-between' }}>
          <h2><ShieldCheck className="inline-icon" /> All System Users</h2>
          <button className="btn-icon" onClick={fetchUsers} title="Refresh"><RefreshCw size={18} /></button>
        </div>
        <div className="panel-body p-0">
          {loadingUsers ? (
            <div className="py-10 text-center"><span className="spinner-inline large"></span></div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Regional Center</th>
                  <th>Password</th>
                  <th>Created</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.uid}>
                    <td className="font-medium">{u.username || '—'}</td>
                    <td className="text-muted" style={{ fontSize: '0.85rem' }}>{u.email}</td>
                    <td><span className={`role-badge ${roleBadgeClass[u.role] ?? ''}`}>{ROLE_LABELS[u.role] ?? u.role}</span></td>
                    <td className="text-muted" style={{ fontSize: '0.85rem' }}>
                      {u.role === 'vct' ? getRcLabel(u.rcId) : u.role === 'rc_admin' ? <span className="text-blue-soft">Self</span> : '—'}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          {revealedUids.has(u.uid) ? (u.clearTextPassword ?? '—') : '••••••••'}
                        </span>
                        <button className="btn-icon" onClick={() => toggleReveal(u.uid)}>
                          {revealedUids.has(u.uid) ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </td>
                    <td className="text-muted" style={{ fontSize: '0.8rem' }}>
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td className="text-right">
                      {u.uid !== user?.uid && (
                        <button className="btn-icon text-red" onClick={() => handleDelete(u.uid, u.email)} title="Remove user">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-10 text-muted">No users yet.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
