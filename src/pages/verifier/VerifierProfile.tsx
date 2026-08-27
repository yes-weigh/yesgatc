import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { formatAadharDisplay } from '../../lib/aadharAuth';
import { vctProfilePhotoFromUser } from '../../lib/vctProfileFields';
import { StorageImage } from '../../components/StorageImage';
import { CreditCard, LogOut, Mail, Phone, User, UserCircle } from 'lucide-react';
import type { FirestoreUserDoc } from '../../types';

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

export const VerifierProfile: React.FC = () => {
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
        <span className="spinner-inline large" />
      </div>
    );
  }

  const displayPhoto = profile ? vctProfilePhotoFromUser(profile) : null;

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
              <span className="role-badge badge-verifier">Verifier</span>
            </div>
          </div>
          <button type="button" className="btn btn-secondary flex items-center gap-2" onClick={() => void handleLogout()}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
        <div className="panel-body">
          <div className="profile-grid">
            <ReadOnlyField icon={<User size={16} />} label="Full name" value={profile?.username || user?.username} />
            <ReadOnlyField
              icon={<CreditCard size={16} />}
              label="Login Aadhar"
              value={formatAadharDisplay(profile?.aadhar || user?.aadhar || '')}
            />
            <ReadOnlyField icon={<Mail size={16} />} label="Contact email" value={profile?.email || user?.email} />
            <ReadOnlyField icon={<Phone size={16} />} label="Primary phone" value={profile?.phone || user?.phone} />
          </div>
        </div>
      </div>
    </div>
  );
};
