import React, { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { Building2, Phone, Mail, MapPin, FileText, Save, Pencil, X } from 'lucide-react';
import type { FirestoreUserDoc } from '../../types';

interface RCProfile extends FirestoreUserDoc {
  companyName: string;
  address: string;
  gstNumber: string;
  phone: string;
}

const Field: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  editing: boolean;
  inputType?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}> = ({ icon, label, value, editing, inputType = 'text', onChange, placeholder, multiline }) => (
  <div className="profile-field">
    <div className="profile-field-label">
      <span className="profile-icon">{icon}</span>
      <span>{label}</span>
    </div>
    {editing ? (
      multiline ? (
        <textarea
          className="input-field"
          rows={3}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          type={inputType}
          className="input-field"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )
    ) : (
      <p className="profile-value">{value || <span className="text-muted">Not set</span>}</p>
    )}
  </div>
);

export const RCProfile: React.FC = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Partial<RCProfile>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [draft,   setDraft]   = useState<Partial<RCProfile>>({});
  const [saved,   setSaved]   = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    const load = async () => {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        setProfile(snap.data() as FirestoreUserDoc);
      }
      setLoading(false);
    };
    load();
  }, [user?.uid]);

  const startEdit = () => {
    setDraft({ ...profile });
    setEditing(true);
    setSaved(false);
  };

  const cancelEdit = () => {
    setDraft({});
    setEditing(false);
  };

  const handleSave = async () => {
    if (!user?.uid) return;
    setSaving(true);
    const updates: Partial<FirestoreUserDoc> = {
      companyName: draft.companyName ?? '',
      address:     draft.address     ?? '',
      gstNumber:   draft.gstNumber   ?? '',
      phone:       draft.phone       ?? '',
      username:    draft.username    ?? profile.username ?? '',
    };
    await updateDoc(doc(db, 'users', user.uid), updates);
    setProfile(prev => ({ ...prev, ...updates }));
    setSaving(false);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const p = editing ? draft : profile;
  const set = (key: keyof RCProfile) => (v: string) =>
    setDraft(prev => ({ ...prev, [key]: v }));

  if (loading) {
    return (
      <div className="fade-in flex justify-center py-20">
        <span className="spinner-inline large"></span>
      </div>
    );
  }

  return (
    <div className="fade-in max-w-3xl mx-auto">
      <div className="panel glass">
        {/* Header */}
        <div className="panel-header justify-between">
          <div className="flex items-center gap-3">
            <div className="rc-avatar">
              <Building2 size={22} />
            </div>
            <div>
              <h2 className="mb-xs">
                {profile.companyName || profile.username || 'Regional Center Profile'}
              </h2>
              <span className="role-badge badge-rc">RC Admin</span>
            </div>
          </div>
          <div className="flex gap-2">
            {!editing ? (
              <button className="btn btn-secondary" onClick={startEdit}>
                <Pencil size={15} /> Edit Profile
              </button>
            ) : (
              <>
                <button className="btn btn-secondary" onClick={cancelEdit}>
                  <X size={15} /> Cancel
                </button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? <span className="spinner-inline"></span> : <><Save size={15} /> Save</>}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="panel-body">
          {saved && (
            <div className="login-success mb-6">✅ Profile updated successfully.</div>
          )}

          <div className="profile-grid">
            <Field
              icon={<Building2 size={16} />}
              label="Company Name"
              value={p.companyName ?? ''}
              editing={editing}
              onChange={set('companyName')}
              placeholder="e.g. Meezan Electronic Scales Pvt Ltd"
            />
            <Field
              icon={<Mail size={16} />}
              label="Contact Email"
              value={p.email ?? ''}
              editing={false}   /* email is immutable (Auth) */
              onChange={() => {}}
            />
            <Field
              icon={<Phone size={16} />}
              label="Mobile / Phone"
              value={p.phone ?? ''}
              editing={editing}
              inputType="tel"
              onChange={set('phone')}
              placeholder="e.g. 9995424242"
            />
            <Field
              icon={<FileText size={16} />}
              label="GST Number (GSTIN)"
              value={p.gstNumber ?? ''}
              editing={editing}
              onChange={set('gstNumber')}
              placeholder="e.g. 32AAECM1277C1ZY"
            />
            <Field
              icon={<MapPin size={16} />}
              label="Full Address"
              value={p.address ?? ''}
              editing={editing}
              onChange={set('address')}
              placeholder="Street, City, State, PIN"
              multiline
            />
            <Field
              icon={<Building2 size={16} />}
              label="Display Name / Contact Person"
              value={p.username ?? ''}
              editing={editing}
              onChange={set('username')}
              placeholder="e.g. Admin - Meezan"
            />
          </div>

          {/* Read-only info block */}
          <div className="profile-meta-bar mt-6">
            <span className="text-muted text-sm">Account created: <strong>{profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</strong></span>
            <span className="text-muted text-sm">UID: <span className="text-mono-muted">{user?.uid}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
};
