import React, { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { formatAadharDisplay } from '../../lib/aadharAuth';
import { isValidPhone, normalizePhone, requireValidEmail } from '../../lib/contactFields';
import { Building2, CreditCard, MapPin, FileText, Save, Pencil, X, Mail, Phone, User, ExternalLink } from 'lucide-react';
import { standardWeightsCertExpiryFromDate } from '../../lib/rcProfileFields';
import type { FirestoreUserDoc } from '../../types';

interface RCProfile extends FirestoreUserDoc {
  companyName: string;
  contactPerson: string;
  place: string;
  address: string;
  gstNumber: string;
  email: string;
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
  readOnly?: boolean;
}> = ({ icon, label, value, editing, inputType = 'text', onChange, placeholder, multiline, readOnly }) => (
  <div className="profile-field">
    <div className="profile-field-label">
      <span className="profile-icon">{icon}</span>
      <span>{label}</span>
    </div>
    {editing && !readOnly ? (
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
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<RCProfile>>({});
  const [saved, setSaved] = useState(false);

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
    if (!requireValidEmail(draft.email ?? '')) {
      alert('A valid contact email is required.');
      return;
    }
    if (!isValidPhone(draft.phone ?? '')) {
      alert('Phone number must be exactly 10 digits.');
      return;
    }

    setSaving(true);
    const updates: Partial<FirestoreUserDoc> = {
      companyName: draft.companyName ?? '',
      contactPerson: (draft.contactPerson ?? '').trim(),
      place: (draft.place ?? '').trim(),
      address: (draft.address ?? '').trim(),
      gstNumber: draft.gstNumber ?? '',
      username: draft.companyName ?? profile.username ?? '',
      email: (draft.email ?? '').trim(),
      phone: normalizePhone(draft.phone ?? ''),
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

        <div className="panel-body">
          {saved && <div className="login-success mb-6">✅ Profile updated successfully.</div>}

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
              icon={<CreditCard size={16} />}
              label="Login Aadhar"
              value={formatAadharDisplay(profile.aadhar ?? user?.aadhar ?? '')}
              editing={false}
              readOnly
              onChange={() => {}}
            />
            <Field
              icon={<Mail size={16} />}
              label="Contact Email"
              value={p.email ?? ''}
              editing={editing}
              inputType="email"
              onChange={set('email')}
              placeholder="rc@example.com"
            />
            <Field
              icon={<Phone size={16} />}
              label="Primary Phone"
              value={p.phone ?? ''}
              editing={editing}
              inputType="tel"
              onChange={v => set('phone')(normalizePhone(v))}
              placeholder="10-digit mobile"
            />
            <Field
              icon={<User size={16} />}
              label="Contact Person"
              value={p.contactPerson ?? ''}
              editing={editing}
              onChange={set('contactPerson')}
              placeholder="Primary contact name"
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
              label="Place"
              value={p.place ?? ''}
              editing={editing}
              onChange={set('place')}
              placeholder="City / town / area"
            />
            <Field
              icon={<MapPin size={16} />}
              label="Full Address"
              value={p.address ?? ''}
              editing={editing}
              onChange={set('address')}
              placeholder="Street, city, state, PIN"
              multiline
            />
          </div>

          <div className="profile-grid mt-6 pt-6 border-t border-subtle">
            <p className="col-span-all text-muted text-sm font-medium mb-2">Standard weights certificate (managed by Super Admin)</p>
            <Field
              icon={<FileText size={16} />}
              label="Certificate Number"
              value={profile.standardWeightsCertNumber ?? ''}
              editing={false}
              readOnly
              onChange={() => {}}
            />
            <Field
              icon={<FileText size={16} />}
              label="Certificate Date"
              value={profile.standardWeightsCertDate ?? ''}
              editing={false}
              readOnly
              onChange={() => {}}
            />
            <Field
              icon={<FileText size={16} />}
              label="Due date"
              value={
                profile.standardWeightsCertDate
                  ? standardWeightsCertExpiryFromDate(profile.standardWeightsCertDate)
                  : profile.standardWeightsCertExpiry || ''
              }
              editing={false}
              readOnly
              onChange={() => {}}
            />
            <div className="profile-field col-span-all">
              <div className="profile-field-label">
                <span className="profile-icon"><FileText size={16} /></span>
                <span>Certificate Document</span>
              </div>
              {profile.standardWeightsCertUrl ? (
                <a
                  href={profile.standardWeightsCertUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary text-sm inline-flex items-center gap-1.5 mt-1"
                >
                  <ExternalLink size={14} />
                  {profile.standardWeightsCertName || 'View certificate'}
                </a>
              ) : (
                <p className="profile-value text-muted">Not uploaded</p>
              )}
            </div>
          </div>

          <div className="profile-grid mt-6 pt-6 border-t border-subtle">
            <p className="col-span-all text-muted text-sm font-medium mb-2">RC seal (managed by Super Admin)</p>
            <div className="profile-field col-span-all">
              <div className="profile-field-label">
                <span className="profile-icon"><FileText size={16} /></span>
                <span>Seal image</span>
              </div>
              {profile.sealUrl ? (
                <div className="rc-seal-preview mt-2">
                  <img src={profile.sealUrl} alt="RC seal" className="rc-seal-preview-img" />
                  <a
                    href={profile.sealUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary text-sm inline-flex items-center gap-1.5 mt-2"
                  >
                    <ExternalLink size={14} />
                    {profile.sealName || 'View seal'}
                  </a>
                </div>
              ) : (
                <p className="profile-value text-muted">Not uploaded</p>
              )}
              <p className="text-muted text-xs mt-2 mb-0">PNG with transparent background required.</p>
            </div>
          </div>

          <div className="profile-meta-bar mt-6">
            <span className="text-muted text-sm">
              Account created:{' '}
              <strong>
                {profile.createdAt
                  ? new Date(profile.createdAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })
                  : '—'}
              </strong>
            </span>
            <span className="text-muted text-sm">
              UID: <span className="text-mono-muted">{user?.uid}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
