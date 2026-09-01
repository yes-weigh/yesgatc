import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { CreditCard, Lock, LogIn, Eye, EyeOff } from 'lucide-react';
import { isValidAadhar, normalizeAadhar, sanitizeAadharInput } from '../lib/aadharAuth';
import { embedVerificationPath, isEmbedSession, rememberEmbedMode } from '../lib/embedMode';
import { APP_VERSION } from '../lib/appVersion';

const LOCAL_QUICK_LOGINS = import.meta.env.DEV
  ? [
      {
        id: 'riyas-meezan',
        label: 'Riyas meezan',
        aadhar: '869223351535',
        password: 'GATC12345',
      },
      {
        id: 'faisal-admin',
        label: 'Faisal admin',
        aadhar: '718835126130',
        password: 'Pala!7890',
      },
      {
        id: 'vishnu-vct',
        label: 'Vishnu VCT',
        aadhar: '261870165022',
        password: 'Gatc@2026',
      },
    ]
  : [];

export const Login: React.FC = () => {
  const { login, user, loading, error: authError } = useAuth();
  const navigate = useNavigate();

  const [aadhar, setAadhar] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [quickLoginId, setQuickLoginId] = useState('');

  useEffect(() => {
    rememberEmbedMode();
  }, []);

  useEffect(() => {
    if (authError) setError(authError);
  }, [authError]);

  useEffect(() => {
    if (!loading && user) {
      if (isEmbedSession()) {
        navigate(embedVerificationPath(), { replace: true });
        return;
      }
      if (user.role === 'super_admin') navigate('/admin', { replace: true });
      else if (user.role === 'rc_admin') navigate('/rc', { replace: true });
      else if (user.role === 'verifier') navigate('/verifier', { replace: true });
      else navigate('/vct', { replace: true });
    }
  }, [user, loading, navigate]);

  const signInWithAadhar = async (aadharInput: string, nextPassword: string) => {
    setError('');
    const clean = normalizeAadhar(aadharInput);
    if (clean.length === 10) {
      setError('That is a phone number. Use the 12-digit Aadhar on the Verifiers card.');
      return;
    }
    if (!isValidAadhar(clean)) {
      setError('Aadhar number must be exactly 12 digits.');
      return;
    }
    setSubmitting(true);
    try {
      await login(clean, nextPassword);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickLogin = async (id: string) => {
    if (!id) return;
    setQuickLoginId(id);
    const profile = LOCAL_QUICK_LOGINS.find(entry => entry.id === id);
    if (!profile) return;
    setAadhar(sanitizeAadharInput(profile.aadhar));
    setPassword(profile.password);
    await signInWithAadhar(profile.aadhar, profile.password);
    setQuickLoginId('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await signInWithAadhar(aadhar, password);
  };

  if (loading) {
    return (
      <div className="login-container">
        <div className="loader-ring"></div>
        <div className="bg-shapes">
          <div className="shape shape-1"></div>
          <div className="shape shape-2"></div>
          <div className="shape shape-3"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-box glass">
        <div className="login-header">
          <img src="/brand/logo-dark.png" alt="YES LAB" className="login-logo" />
          <p className="login-version">{APP_VERSION}</p>
          <p>Sign in with 12-digit Aadhar — not phone</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          {LOCAL_QUICK_LOGINS.length > 0 && (
            <div className="login-quick-login">
              <label htmlFor="login-quick-profile" className="sr-only">
                Local quick login
              </label>
              <select
                id="login-quick-profile"
                className="login-quick-login-select"
                value={quickLoginId}
                disabled={submitting}
                aria-label="Quick login"
                onChange={e => void handleQuickLogin(e.target.value)}
              >
                <option value="">Select user</option>
                {LOCAL_QUICK_LOGINS.map(profile => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="login-aadhar">Aadhar Number</label>
            <div className="input-icon-wrap">
              <CreditCard size={18} className="input-icon" />
              <input
                id="login-aadhar"
                type="text"
                inputMode="text"
                className="input-field input-with-icon"
                placeholder="12-digit Aadhar"
                value={aadhar}
                onChange={e => setAadhar(sanitizeAadharInput(e.target.value))}
                required
                autoFocus
                maxLength={14}
                autoComplete="username"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <div className="input-icon-wrap">
              <Lock size={18} className="input-icon" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="input-field input-with-icon"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="input-icon-right"
                onClick={() => setShowPassword(p => !p)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary w-full mt-2" disabled={submitting}>
            {submitting ? (
              <span className="spinner-inline"></span>
            ) : (
              <>
                <LogIn size={18} />
                Sign In
              </>
            )}
          </button>
        </form>

        <div className="login-footer">
          <p className="text-muted text-sm">© Interweighing PVT LTD, 2026</p>
        </div>
      </div>

      <div className="bg-shapes">
        <div className="shape shape-1"></div>
        <div className="shape shape-2"></div>
        <div className="shape shape-3"></div>
      </div>
    </div>
  );
};
