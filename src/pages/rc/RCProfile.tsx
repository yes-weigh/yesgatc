import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { formatAadharDisplay } from '../../lib/aadharAuth';
import { isValidPhone, isValidPincode, normalizePhone, normalizePincode, requireValidEmail } from '../../lib/contactFields';
import { Building2, CreditCard, Crosshair, MapPin, FileText, Save, Pencil, X, Mail, Phone, User, ExternalLink, IndianRupee, LogOut } from 'lucide-react';
import {
  parseRcLocation,
  rcMapsUrl,
  rcProfileCoordsFromUser,
  rcProfilePhotoFieldsFromMeta,
  rcProfilePhotoFromUser,
  rcStandardWeightsCertClearFields,
  rcStandardWeightsCertFieldsFromMeta,
  rcStandardWeightsCertFromUser,
  formatRcLocation,
  standardWeightsCertExpiryFromDate,
  resolveRcFeesStructure,
  rcFeesDraftFromUser,
  formatRcFeeAmount,
  parseRcFeeAmountInput,
  validateRcFeesStructure,
} from '../../lib/rcProfileFields';
import { deleteRcStorageFile, uploadRcStandardWeightsCert } from '../../lib/rcCertificateUpload';
import { uploadVctProfilePhoto } from '../../lib/vctDocumentUpload';
import { UploadField } from '../admin/productFormUi';
import {
  EMPTY_IMAGE_UPLOAD_STATE,
  type ImageUploadState,
} from './CustomerFormFields';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import type { FirestoreUserDoc, RcFeesStructure } from '../../types';

interface RCProfile extends FirestoreUserDoc {
  companyName: string;
  contactPerson: string;
  place: string;
  address: string;
  gstNumber: string;
  email: string;
  phone: string;
  pincode: string;
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Partial<RCProfile>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<RCProfile>>({});
  const [saved, setSaved] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<ImageUploadState>({ ...EMPTY_IMAGE_UPLOAD_STATE });
  const [pendingProfilePhoto, setPendingProfilePhoto] = useState<File | null>(null);
  const [profilePhotoRemoved, setProfilePhotoRemoved] = useState(false);
  const profilePhotoRef = useRef<HTMLInputElement>(null);
  const certInputRef = useRef<HTMLInputElement>(null);
  const [cert, setCert] = useState<ProductFileMeta | null>(null);
  const [certUploading, setCertUploading] = useState(false);
  const [certProgress, setCertProgress] = useState(0);
  const [certRemoved, setCertRemoved] = useState(false);
  const [draftCoords, setDraftCoords] = useState({ latitude: '', longitude: '' });
  const [draftFees, setDraftFees] = useState<RcFeesStructure>(rcFeesDraftFromUser(null));
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  useEffect(() => {
    if (!user?.uid) return;
    const load = async () => {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const data = snap.data() as FirestoreUserDoc;
        setProfile(data);
        setProfilePhoto({
          ...EMPTY_IMAGE_UPLOAD_STATE,
          file: rcProfilePhotoFromUser(data),
        });
      }
      setLoading(false);
    };
    load();
  }, [user?.uid]);

  const startEdit = () => {
    setDraft({ ...profile });
    setDraftCoords(rcProfileCoordsFromUser(profile as FirestoreUserDoc));
    setDraftFees(rcFeesDraftFromUser(profile as FirestoreUserDoc));
    setLocationError('');
    setPendingProfilePhoto(null);
    setProfilePhotoRemoved(false);
    setProfilePhoto({
      ...EMPTY_IMAGE_UPLOAD_STATE,
      file: rcProfilePhotoFromUser(profile as FirestoreUserDoc),
    });
    setCert(rcStandardWeightsCertFromUser(profile as FirestoreUserDoc));
    setCertRemoved(false);
    setCertUploading(false);
    setCertProgress(0);
    setEditing(true);
    setSaved(false);
  };

  const cancelEdit = () => {
    setDraft({});
    setDraftCoords(rcProfileCoordsFromUser(profile as FirestoreUserDoc));
    setDraftFees(rcFeesDraftFromUser(profile as FirestoreUserDoc));
    setLocationError('');
    setPendingProfilePhoto(null);
    setProfilePhotoRemoved(false);
    setProfilePhoto({
      ...EMPTY_IMAGE_UPLOAD_STATE,
      file: rcProfilePhotoFromUser(profile as FirestoreUserDoc),
    });
    setCert(rcStandardWeightsCertFromUser(profile as FirestoreUserDoc));
    setCertRemoved(false);
    setCertUploading(false);
    setCertProgress(0);
    setEditing(false);
  };

  const handleCertSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user?.uid) return;

    setCertUploading(true);
    setCertProgress(0);
    try {
      const meta = await uploadRcStandardWeightsCert(user.uid, file, setCertProgress);
      const prevPath = cert?.path || profile.standardWeightsCertPath;
      if (prevPath && prevPath !== meta.path) {
        await deleteRcStorageFile(prevPath).catch(() => undefined);
      }
      setCert(meta);
      setCertRemoved(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Certificate upload failed.');
    } finally {
      setCertUploading(false);
    }
  };

  const handleCertRemove = () => {
    setCert(null);
    setCertRemoved(true);
  };

  const handleProfilePhotoSelect = (file: File) => {
    setPendingProfilePhoto(file);
    setProfilePhotoRemoved(false);
    setProfilePhoto({
      file: {
        url: URL.createObjectURL(file),
        path: '',
        name: file.name,
        contentType: file.type,
      },
      uploading: false,
      progress: 0,
    });
  };

  const handleProfilePhotoRemove = () => {
    setPendingProfilePhoto(null);
    setProfilePhotoRemoved(true);
    setProfilePhoto({ ...EMPTY_IMAGE_UPLOAD_STATE });
  };

  const uploadProfilePhoto = async (uid: string): Promise<Partial<FirestoreUserDoc>> => {
    if (profilePhotoRemoved && !pendingProfilePhoto) {
      return rcProfilePhotoFieldsFromMeta(null);
    }
    if (!pendingProfilePhoto) {
      const existing = profilePhoto.file;
      if (existing?.url && !existing.url.startsWith('blob:')) {
        return rcProfilePhotoFieldsFromMeta(existing);
      }
      return {};
    }
    setProfilePhoto(prev => ({ ...prev, uploading: true, progress: 0 }));
    try {
      const meta = await uploadVctProfilePhoto(uid, pendingProfilePhoto, pct => {
        setProfilePhoto(prev => ({ ...prev, progress: pct }));
      });
      setProfilePhoto({ file: meta, uploading: false, progress: 100 });
      return rcProfilePhotoFieldsFromMeta(meta);
    } catch (err) {
      setProfilePhoto(prev => ({ ...prev, uploading: false, progress: 0 }));
      throw err;
    }
  };

  const handleDetectLocation = () => {
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setDraftCoords({
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        });
        setLocating(false);
      },
      err => {
        setLocating(false);
        setLocationError(err.message || 'Could not detect location.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const handleClearLocation = () => {
    setLocationError('');
    setDraftCoords({ latitude: '', longitude: '' });
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
    const pincode = normalizePincode(draft.pincode ?? '');
    if (pincode && !isValidPincode(pincode)) {
      alert('Postal code must be exactly 6 digits.');
      return;
    }
    const feesError = validateRcFeesStructure(draftFees);
    if (feesError) {
      alert(feesError);
      return;
    }

    setSaving(true);
    try {
      const photoFields = await uploadProfilePhoto(user.uid);
      const location = parseRcLocation(draftCoords);
      const certDate = (draft.standardWeightsCertDate ?? '').trim();
      const certFields: Record<string, unknown> = {
        standardWeightsCertNumber: (draft.standardWeightsCertNumber ?? '').trim(),
        standardWeightsCertDate: certDate,
        standardWeightsCertExpiry: standardWeightsCertExpiryFromDate(certDate),
      };
      if (certRemoved && !cert) {
        Object.assign(certFields, rcStandardWeightsCertClearFields());
        const oldPath = profile.standardWeightsCertPath;
        if (oldPath) await deleteRcStorageFile(oldPath).catch(() => undefined);
      } else if (cert) {
        Object.assign(certFields, rcStandardWeightsCertFieldsFromMeta(cert));
      }
      const updates: Record<string, unknown> = {
        companyName: draft.companyName ?? '',
        contactPerson: (draft.contactPerson ?? '').trim(),
        place: (draft.place ?? '').trim(),
        address: (draft.address ?? '').trim(),
        gstNumber: draft.gstNumber ?? '',
        username: draft.companyName ?? profile.username ?? '',
        email: (draft.email ?? '').trim(),
        phone: normalizePhone(draft.phone ?? ''),
        pincode,
        feesStructure: draftFees,
        ...photoFields,
        ...certFields,
      };
      if (location) {
        updates.location = location;
      } else {
        updates.location = deleteField();
      }
      await updateDoc(doc(db, 'users', user.uid), updates);
      setProfile(prev => ({
        ...prev,
        ...updates,
        location: location ?? undefined,
      } as Partial<RCProfile>));
      setPendingProfilePhoto(null);
      setProfilePhotoRemoved(false);
      setCertRemoved(false);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const p = editing ? draft : profile;
  const set = (key: keyof RCProfile) => (v: string) =>
    setDraft(prev => ({ ...prev, [key]: v }));
  const displayPhoto = rcProfilePhotoFromUser(profile as FirestoreUserDoc);
  const mapsUrl = rcMapsUrl(profile as FirestoreUserDoc);
  const displayFees = resolveRcFeesStructure(profile as FirestoreUserDoc);
  const fees = editing ? draftFees : displayFees;
  const displayCert = editing ? cert : rcStandardWeightsCertFromUser(profile as FirestoreUserDoc);
  const certDueDate = standardWeightsCertExpiryFromDate(
    (p.standardWeightsCertDate ?? '').trim() || (profile.standardWeightsCertDate ?? ''),
  );
  const hasDraftLocation = Boolean(draftCoords.latitude.trim() && draftCoords.longitude.trim());

  const setFee = (
    tier: keyof RcFeesStructure,
    field: 'inPremise' | 'inSitu' | 'self',
  ) => (value: string) => {
    setDraftFees(prev => ({
      ...prev,
      [tier]: {
        ...prev[tier],
        [field]: parseRcFeeAmountInput(value),
      },
    }));
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

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
              {displayPhoto?.url ? (
                <img src={displayPhoto.url} alt="" className="rc-avatar-img" />
              ) : (
                <Building2 size={22} />
              )}
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

          {editing && (
            <div className="rc-profile-photo-row mb-6">
              <UploadField
                label="Profile photo"
                hint="Optional — shown on self verifications"
                file={profilePhoto.file}
                uploading={profilePhoto.uploading}
                progress={profilePhoto.progress}
                accept="image/jpeg,image/png,image/webp,image/gif"
                uploadLabel="Upload"
                formats="Max 15 MB"
                inputRef={profilePhotoRef}
                onSelect={e => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) handleProfilePhotoSelect(file);
                }}
                onRemove={handleProfilePhotoRemove}
                submitting={saving}
                variant="image"
                compact
                avatar
              />
            </div>
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
              label="Postal code"
              value={p.pincode ?? ''}
              editing={editing}
              inputType="text"
              onChange={v => set('pincode')(normalizePincode(v))}
              placeholder="6-digit PIN"
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

          <div className="profile-grid mt-4">
            <div className="profile-field col-span-all">
              <div className="profile-field-label">
                <span className="profile-icon"><MapPin size={16} /></span>
                <span>GPS coordinates</span>
                <span className="text-muted text-sm font-normal ml-1">Optional — used for weather on self verifications</span>
              </div>
              {editing ? (
                <div className="customer-form-location-side mt-1">
                  <div className="customer-form-location-controls">
                    <button
                      type="button"
                      className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5 shrink-0"
                      onClick={handleDetectLocation}
                      disabled={saving || locating}
                    >
                      {locating ? <span className="spinner-inline"></span> : <Crosshair size={14} />}
                      Use my location
                    </button>
                    {hasDraftLocation && (
                      <button
                        type="button"
                        className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5 shrink-0"
                        onClick={handleClearLocation}
                        disabled={saving || locating}
                        title="Clear location"
                        aria-label="Clear location"
                      >
                        <X size={14} />
                      </button>
                    )}
                    <div className="customer-form-location-coords">
                      <input
                        type="text"
                        className="input-field input-field--coords"
                        placeholder="Lat"
                        value={draftCoords.latitude}
                        readOnly
                        tabIndex={-1}
                        aria-label="Latitude"
                      />
                      <input
                        type="text"
                        className="input-field input-field--coords"
                        placeholder="Lng"
                        value={draftCoords.longitude}
                        readOnly
                        tabIndex={-1}
                        aria-label="Longitude"
                      />
                    </div>
                  </div>
                  {locationError && (
                    <p className="customer-form-location-error text-sm mt-2 mb-0" role="alert">
                      {locationError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="mt-1">
                  <p className="profile-value mb-0">
                    {formatRcLocation(profile as FirestoreUserDoc)}
                  </p>
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary text-sm inline-flex items-center gap-1.5 mt-2"
                    >
                      <ExternalLink size={14} />
                      Open in Maps
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="profile-grid mt-6 pt-6 border-t border-subtle">
            <p className="col-span-all text-muted text-sm font-medium mb-2 flex items-center gap-1.5">
              <IndianRupee size={15} />
              Fees structure
            </p>
            <div className="profile-field col-span-all">
              <p className="text-muted text-xs mb-3">
                Default verification fees by weight and location. You can update these for your centre.
              </p>
              <div className="table-scroll-wrap">
                <table className="data-table rc-fees-table">
                  <thead>
                    <tr>
                      <th>Weight range</th>
                      <th>In the premises</th>
                      <th>In situ</th>
                      <th>Self</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="font-medium">Up to 20 kg</td>
                      <td>
                        {editing ? (
                          <input
                            type="text"
                            inputMode="numeric"
                            className="input-field input-field--table"
                            value={fees.tierUpto20Kg.inPremise || ''}
                            onChange={e => setFee('tierUpto20Kg', 'inPremise')(e.target.value)}
                            placeholder="750"
                            aria-label="Up to 20 kg — in the premises fee"
                          />
                        ) : (
                          formatRcFeeAmount(displayFees.tierUpto20Kg.inPremise)
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <input
                            type="text"
                            inputMode="numeric"
                            className="input-field input-field--table"
                            value={fees.tierUpto20Kg.inSitu || ''}
                            onChange={e => setFee('tierUpto20Kg', 'inSitu')(e.target.value)}
                            placeholder="850"
                            aria-label="Up to 20 kg — in situ fee"
                          />
                        ) : (
                          formatRcFeeAmount(displayFees.tierUpto20Kg.inSitu)
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <input
                            type="text"
                            inputMode="numeric"
                            className="input-field input-field--table"
                            value={fees.tierUpto20Kg.self || ''}
                            onChange={e => setFee('tierUpto20Kg', 'self')(e.target.value)}
                            placeholder="150"
                            aria-label="Up to 20 kg — self verification fee"
                          />
                        ) : (
                          formatRcFeeAmount(displayFees.tierUpto20Kg.self)
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td className="font-medium">Above 20 kg up to 150 kg</td>
                      <td>
                        {editing ? (
                          <input
                            type="text"
                            inputMode="numeric"
                            className="input-field input-field--table"
                            value={fees.tierUpto150Kg.inPremise || ''}
                            onChange={e => setFee('tierUpto150Kg', 'inPremise')(e.target.value)}
                            placeholder="900"
                            aria-label="Above 20 kg up to 150 kg — in the premises fee"
                          />
                        ) : (
                          formatRcFeeAmount(displayFees.tierUpto150Kg.inPremise)
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <input
                            type="text"
                            inputMode="numeric"
                            className="input-field input-field--table"
                            value={fees.tierUpto150Kg.inSitu || ''}
                            onChange={e => setFee('tierUpto150Kg', 'inSitu')(e.target.value)}
                            placeholder="1000"
                            aria-label="Above 20 kg up to 150 kg — in situ fee"
                          />
                        ) : (
                          formatRcFeeAmount(displayFees.tierUpto150Kg.inSitu)
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <input
                            type="text"
                            inputMode="numeric"
                            className="input-field input-field--table"
                            value={fees.tierUpto150Kg.self || ''}
                            onChange={e => setFee('tierUpto150Kg', 'self')(e.target.value)}
                            placeholder="250"
                            aria-label="Above 20 kg up to 150 kg — self verification fee"
                          />
                        ) : (
                          formatRcFeeAmount(displayFees.tierUpto150Kg.self)
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="profile-grid mt-6 pt-6 border-t border-subtle">
            <p className="col-span-all text-muted text-sm font-medium mb-2">
              Standard weights certificate
            </p>
            <p className="col-span-all text-muted text-xs mb-3 mt-0">
              Required before technicians can start new verifications. PDF or image, max 15 MB.
            </p>
            <Field
              icon={<FileText size={16} />}
              label="Certificate Number"
              value={p.standardWeightsCertNumber ?? ''}
              editing={editing}
              onChange={set('standardWeightsCertNumber')}
              placeholder="Reference no."
            />
            <Field
              icon={<FileText size={16} />}
              label="Certificate Date"
              value={p.standardWeightsCertDate ?? ''}
              editing={editing}
              inputType="date"
              onChange={set('standardWeightsCertDate')}
            />
            <Field
              icon={<FileText size={16} />}
              label="Due date"
              value={
                certDueDate
                  || profile.standardWeightsCertExpiry
                  || ''
              }
              editing={false}
              readOnly
              onChange={() => {}}
            />
            <div className="profile-field col-span-all">
              {editing ? (
                <UploadField
                  label="Certificate document"
                  hint="PDF / image"
                  file={displayCert}
                  uploading={certUploading}
                  progress={certProgress}
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
                  uploadLabel="Upload"
                  formats="Max 15 MB"
                  inputRef={certInputRef}
                  onSelect={handleCertSelect}
                  onRemove={handleCertRemove}
                  submitting={saving}
                  variant="document"
                  compact
                />
              ) : (
                <>
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
                    <p className="profile-value text-muted">Not uploaded — edit profile to add</p>
                  )}
                </>
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

          <div className="profile-logout-section">
            <button type="button" className="profile-logout-btn" onClick={() => void handleLogout()}>
              <LogOut size={18} aria-hidden />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
