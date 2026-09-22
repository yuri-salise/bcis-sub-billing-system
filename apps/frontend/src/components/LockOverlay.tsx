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
          width: '380px',
          padding: '38px 32px',
          borderRadius: '18px',
          backgroundColor: 'rgba(235, 227, 167, 0.07)',
          border: '1px solid rgba(235, 227, 167, 0.22)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6), inset 0 1px 1px rgba(235, 227, 167, 0.2)',
          textAlign: 'center',
          backdropFilter: 'blur(24px)',
        }}
      >
        {/* Lock Icon */}
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: 'rgba(235, 125, 0, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            border: '1px solid rgba(235, 125, 0, 0.4)',
            boxShadow: '0 4px 12px rgba(235, 125, 0, 0.25)',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EB7D00" strokeWidth="2.2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h2 style={{ fontSize: '19px', fontWeight: 700, marginBottom: '4px', color: '#FFFFFF' }}>Workstation Locked</h2>
        <div style={{ fontSize: '13px', color: '#EBE3A7', marginBottom: '22px', opacity: 0.9 }}>
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
                padding: '11px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(235, 227, 167, 0.12)',
                border: errorMessage ? '1px solid #DC2626' : '1px solid rgba(235, 227, 167, 0.25)',
                color: '#FFFFFF',
                fontSize: '14px',
                textAlign: 'center',
                outline: 'none',
                fontFamily: 'inherit',
                transition: 'border-color 140ms ease',
              }}
            />
            {errorMessage && (
              <div style={{ fontSize: '12px', color: '#FCA5A5', marginTop: '6px', fontWeight: 500 }}>
                {errorMessage}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="btn-accent"
            disabled={!password || isSubmitting}
            style={{
              width: '100%',
              padding: '11px',
              fontSize: '14px',
            }}
          >
            {isSubmitting ? 'Verifying...' : 'Resume Workstation'}
          </button>
        </form>

        <div style={{ marginTop: '18px', fontSize: '11px', color: '#EBE3A7', opacity: 0.7 }}>
          Security Policy: 5 failed attempts will lock account.
        </div>
      </div>
    </div>
  );
};
