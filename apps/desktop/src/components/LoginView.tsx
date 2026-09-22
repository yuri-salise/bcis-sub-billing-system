import React, { useState } from 'react';
import { useAuth } from '../state/AuthContext.js';

export const LoginView: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    
    setIsSubmitting(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      width: '100vw',
      backgroundColor: 'var(--bg-app)',
      color: '#FFFFFF'
    }}>
      <div style={{
        width: '400px',
        padding: '40px',
        borderRadius: '16px',
        backgroundColor: '#2E2910',
        border: '1px solid rgba(235, 227, 167, 0.2)',
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
        textAlign: 'center'
      }}>
        <h2 style={{ marginBottom: '24px', fontSize: '24px', fontWeight: 'bold' }}>BCIS Billing Login</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            disabled={isSubmitting}
            style={{
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid rgba(235, 227, 167, 0.3)',
              backgroundColor: 'rgba(0,0,0,0.2)',
              color: '#FFFFFF',
              outline: 'none',
              fontSize: '16px'
            }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={isSubmitting}
            style={{
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid rgba(235, 227, 167, 0.3)',
              backgroundColor: 'rgba(0,0,0,0.2)',
              color: '#FFFFFF',
              outline: 'none',
              fontSize: '16px'
            }}
          />
          {error && <div style={{ color: '#FCA5A5', fontSize: '14px', textAlign: 'left' }}>{error}</div>}
          <button
            type="submit"
            disabled={isSubmitting || !username || !password}
            style={{
              padding: '12px',
              borderRadius: '8px',
              backgroundColor: '#EB7D00',
              color: '#FFFFFF',
              border: 'none',
              fontWeight: 'bold',
              cursor: isSubmitting ? 'wait' : 'pointer',
              fontSize: '16px',
              marginTop: '8px'
            }}
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};
