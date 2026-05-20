import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, LogIn, Eye, EyeOff } from 'lucide-react';

export const Login: React.FC = () => {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Redirect if already logged in
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
    setSubmitting(true);
    try {
      let loginEmail = email.trim();
      if (!loginEmail.includes('@') && /^\d+$/.test(loginEmail)) {
        loginEmail = `${loginEmail}@yesweigh.in`;
      }
      await login(loginEmail, password);
      // Navigation handled by useEffect above
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
          <p>Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <div className="form-group">
            <label>Email Address / Phone / Aadhar</label>
            <div className="input-icon-wrap">
              <Mail size={18} className="input-icon" />
              <input
                type="text"
                className="input-field input-with-icon"
                placeholder="you@example.com or 10-digit Phone or 12-digit Aadhar"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
          </div>

          <div className="form-group">
            <label>Password</label>
            <div className="input-icon-wrap">
              <Lock size={18} className="input-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                className="input-field input-with-icon"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
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

          <button
            type="submit"
            className="btn btn-primary w-full mt-2"
            disabled={submitting}
          >
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
          <p className="text-muted text-sm">Roles: Super Admin • RC Admin • VCT Technician</p>
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
