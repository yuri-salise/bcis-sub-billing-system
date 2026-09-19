import React, { useState } from 'react';
import { useAuth } from '../state/AuthContext.js';
import { useConfig } from '../state/ConfigContext.js';

export const LockOverlay: React.FC = () => {
  const { isLocked, user, unlockScreen } = useAuth();
  const { printerConfig } = useConfig();
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isLocked) return null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const success = await unlockScreen(password);
    setIsSubmitting(false);

    if (success) {
      setPassword('');
      setErrorMessage(null);
    } else {
      setIsShaking(true);
      setErrorMessage('Incorrect password. Please re-enter.');
      setTimeout(() => setIsShaking(false), 500);
    }
  };

  return (
    <div
      className="glass-lock"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#FFFFFF',
      }}
    >
      <style>{`
        @keyframes appleShake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        .shake {
          animation: appleShake 400ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
        }
      `}</style>

      <div
        className={isShaking ? 'shake modal-animate-enter' : 'modal-animate-enter'}
        style={{
          width: '360px',
          padding: '36px 32px',
          borderRadius: '16px',
          backgroundColor: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          textAlign: 'center',
          backdropFilter: 'blur(20px)',
        }}
      >
        {/* Lock Icon */}
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>Workstation Locked</h2>
        <div style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '20px' }}>
          {printerConfig.stationId} • {user?.fullName || 'Active Session'}
        </div>

        <form onSubmit={handleUnlock}>
          <div style={{ marginBottom: '16px' }}>
            <input
              type="password"
              placeholder="Enter password to resume"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                border: errorMessage ? '1px solid #EF4444' : '1px solid rgba(255, 255, 255, 0.2)',
                color: '#FFFFFF',
                fontSize: '14px',
                textAlign: 'center',
                outline: 'none',
              }}
            />
            {errorMessage && (
              <div style={{ fontSize: '12px', color: '#F87171', marginTop: '6px' }}>
                {errorMessage}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={!password || isSubmitting}
            style={{
              width: '100%',
              padding: '10px',
              fontSize: '14px',
            }}
          >
            {isSubmitting ? 'Verifying...' : 'Resume Workstation'}
          </button>
        </form>

        <div style={{ marginTop: '16px', fontSize: '11px', color: '#64748B' }}>
          Security Policy: 5 failed attempts will lock account.
        </div>
      </div>
    </div>
  );
};
