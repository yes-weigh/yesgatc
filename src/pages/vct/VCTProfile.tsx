import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { formatAadharDisplay } from '../../lib/aadharAuth';
import {
  CreditCard,
  Droplets,
  ExternalLink,
  FileText,
  LogOut,
  MapPin,
  Phone,
  Shield,
  User,
  UserCircle,
  Zap,
  ClipboardList,
} from 'lucide-react';
import {
  VCT_DOC_KEYS,
  VCT_DOC_LABELS,
  vctDocsFromUser,
  vctProfilePhotoFromUser,
} from '../../lib/vctProfileFields';
import { StorageImage } from '../../components/StorageImage';
import type { FirestoreUserDoc, WorkflowMode } from '../../types';

function ReadOnlyField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="profile-field">
      <div className="profile-field-label">
        <span className="profile-icon">{icon}</span>
        <span>{label}</span>
      </div>
      <p className="profile-value">{value || <span className="text-muted">Not set</span>}</p>
    </div>
  );
}

function workflowModeLabel(mode?: WorkflowMode): string {
  if (mode === 'manual') return 'Manual';
  if (mode === 'auto') return 'Auto';
  return '—';
}

export const VCTProfile: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<FirestoreUserDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!cancelled && snap.exists()) {
          setProfile(snap.data() as FirestoreUserDoc);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

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

  const displayPhoto = profile ? vctProfilePhotoFromUser(profile) : null;
  const docs = profile ? vctDocsFromUser(profile) : null;
  const workflowMode = profile?.workflowMode;

  return (
    <div className="fade-in max-w-3xl mx-auto">
      <div className="panel glass">
        <div className="panel-header justify-between">
          <div className="flex items-center gap-3">
            <div className="rc-avatar">
              {displayPhoto?.url ? (
                <StorageImage url={displayPhoto.url} path={displayPhoto.path} alt="" className="rc-avatar-img" />
              ) : (
                <UserCircle size={22} />
              )}
            </div>
            <div>
              <h2 className="mb-xs">{profile?.username || user?.username || 'My profile'}</h2>
              <span className="role-badge badge-vct">VCT Technician</span>
            </div>
          </div>
        </div>

        <div className="panel-body">
          <div className="profile-grid">
            <ReadOnlyField
              icon={<User size={16} />}
              label="Full name"
              value={profile?.username || user?.username}
            />
            <ReadOnlyField
              icon={<CreditCard size={16} />}
              label="Login Aadhar"
              value={formatAadharDisplay(profile?.aadhar ?? user?.aadhar ?? '')}
            />
            <ReadOnlyField
              icon={<Phone size={16} />}
              label="Mobile"
              value={profile?.phone || user?.phone}
            />
            <ReadOnlyField
              icon={<Droplets size={16} />}
              label="Blood group"
              value={profile?.bloodGroup}
            />
            <ReadOnlyField
              icon={<MapPin size={16} />}
              label="Postal code"
              value={profile?.pincode}
            />
            <ReadOnlyField
              icon={<Shield size={16} />}
              label="Police station"
              value={profile?.policeStation}
            />
            <ReadOnlyField
              icon={<MapPin size={16} />}
              label="Residential address"
              value={profile?.address}
            />
          </div>

          <div className="profile-grid mt-6 pt-6 border-t border-subtle">
            <p className="col-span-all text-muted text-sm font-medium mb-2">Emergency contact</p>
            <ReadOnlyField
              icon={<User size={16} />}
              label="Name"
              value={profile?.secondaryContactName}
            />
            <ReadOnlyField
              icon={<User size={16} />}
              label="Relationship"
              value={profile?.secondaryContactRelationship}
            />
            <ReadOnlyField
              icon={<Phone size={16} />}
              label="Phone"
              value={profile?.secondaryContactPhone}
            />
          </div>

          <div className="profile-grid mt-6 pt-6 border-t border-subtle">
            <p className="col-span-all text-muted text-sm font-medium mb-2">Job settings</p>
            <div className="profile-field">
              <div className="profile-field-label">
                <span className="profile-icon">
                  {workflowMode === 'manual' ? <ClipboardList size={16} /> : <Zap size={16} />}
                </span>
                <span>Job mode</span>
              </div>
              <p className="profile-value">{workflowModeLabel(workflowMode)}</p>
              <p className="text-muted text-xs mt-1 mb-0">Managed by your RC admin.</p>
            </div>
          </div>

          <div className="profile-grid mt-6 pt-6 border-t border-subtle">
            <p className="col-span-all text-muted text-sm font-medium mb-2">Documents</p>
            {VCT_DOC_KEYS.map(key => {
              const docMeta = docs?.[key];
              const label = VCT_DOC_LABELS[key].label;
              return (
                <div key={key} className="profile-field">
                  <div className="profile-field-label">
                    <span className="profile-icon">
                      <FileText size={16} />
                    </span>
                    <span>{label}</span>
                  </div>
                  {docMeta?.url ? (
                    <a
                      href={docMeta.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary text-sm inline-flex items-center gap-1.5 mt-1"
                    >
                      <ExternalLink size={14} />
                      {docMeta.name || `View ${label.toLowerCase()}`}
                    </a>
                  ) : (
                    <p className="profile-value text-muted">Not uploaded</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="profile-meta-bar mt-6">
            <span className="text-muted text-sm">
              Account created:{' '}
              <strong>
                {profile?.createdAt
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
