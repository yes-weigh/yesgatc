import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { formatAadharDisplay } from '../../lib/aadharAuth';
import { vctProfilePhotoFromUser } from '../../lib/vctProfileFields';
import { verifierOwnGpsWrite } from '../../lib/verifierProfileFields';
import { StorageImage } from '../../components/StorageImage';
import { CreditCard, LogOut, Mail, MapPin, Phone, RefreshCw, User, UserCircle } from 'lucide-react';
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
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState('');

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

  const handleCaptureGps = () => {
    if (!user?.uid) return;
    setGpsError('');
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const payload = verifierOwnGpsWrite(pos.coords.latitude, pos.coords.longitude);
        if (!payload) {
          setLocating(false);
          setGpsError('Could not read GPS coordinates.');
          return;
        }
        void (async () => {
          try {
            await updateDoc(doc(db, 'users', user.uid), payload);
            setProfile(prev => (prev ? { ...prev, location: payload.location } : prev));
          } catch {
            setGpsError('Could not save GPS.');
          } finally {
            setLocating(false);
          }
        })();
      },
      err => {
        setLocating(false);
        setGpsError(err.message || 'Could not detect location.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  if (loading) {
    return (
      <div className="fade-in flex justify-center py-20">
        <span className="spinner-inline large" />
      </div>
    );
  }

  const displayPhoto = profile ? vctProfilePhotoFromUser(profile) : null;
  const gpsValue = profile?.location
    ? `${profile.location.lat.toFixed(5)}, ${profile.location.lng.toFixed(5)}`
    : '';

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
            <ReadOnlyField icon={<MapPin size={16} />} label="Address" value={profile?.address} />
            <ReadOnlyField icon={<MapPin size={16} />} label="PIN" value={profile?.pincode} />
            <ReadOnlyField icon={<MapPin size={16} />} label="District" value={profile?.district} />
            <ReadOnlyField icon={<MapPin size={16} />} label="State" value={profile?.state} />
            <div className="profile-field col-span-all">
              <div className="profile-field-label">
                <span className="profile-icon">
                  <MapPin size={16} />
                </span>
                <span>GPS</span>
              </div>
              <div className="profile-gps-row">
                <p className="profile-value">
                  {gpsValue || <span className="text-muted">Tap refresh to capture GPS</span>}
                </p>
                <button
                  type="button"
                  className="party-info-row-action-btn"
                  onClick={handleCaptureGps}
                  disabled={locating}
                  title="Update GPS location"
                  aria-label="Update GPS location"
                >
                  {locating ? (
                    <span className="party-info-pin-spinner" aria-label="Detecting location" />
                  ) : (
                    <RefreshCw strokeWidth={2} />
                  )}
                </button>
              </div>
              {gpsError ? (
                <p className="party-info-rows-error" role="alert">
                  {gpsError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
