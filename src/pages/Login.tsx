import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { CreditCard, Lock, LogIn, Eye, EyeOff } from 'lucide-react';
import { isValidAadhar, normalizeAadhar } from '../lib/aadharAuth';

export const Login: React.FC = () => {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();

  const [aadhar, setAadhar] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && user) {
      if (user.role === 'super_admin') navigate('/admin', { replace: true });
      else if (user.role === 'rc_admin') navigate('/rc', { replace: true });
      else navigate('/vct', { replace: true });
    }
  }, [user, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const clean = normalizeAadhar(aadhar);
    if (!isValidAadhar(clean)) {
      setError('Aadhar number must be exactly 12 digits.');
      return;
    }
    setSubmitting(true);
    try {
      await login(clean, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
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
          <img src="/dark logo.png" alt="YES LAB" className="login-logo" />
          <p>Sign in with your Aadhar number</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="login-aadhar">Aadhar Number</label>
            <div className="input-icon-wrap">
              <CreditCard size={18} className="input-icon" />
              <input
                id="login-aadhar"
                type="text"
                inputMode="numeric"
                className="input-field input-with-icon"
                placeholder="12-digit Aadhar"
                value={aadhar}
                onChange={e => setAadhar(e.target.value.replace(/\D/g, '').slice(0, 12))}
                required
                autoFocus
                maxLength={12}
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
