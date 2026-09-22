import React from 'react';

interface PaginatorProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export const Paginator: React.FC<PaginatorProps> = ({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}) => {
  if (totalPages <= 1) return null;

  const from = Math.min((page - 1) * pageSize + 1, totalItems);
  const to = Math.min(page * pageSize, totalItems);

  const btnBase: React.CSSProperties = {
    padding: '4px 10px',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: '#FFFFFF',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    lineHeight: '1.4',
    transition: 'background 120ms ease',
  };

  const btnDisabled: React.CSSProperties = {
    ...btnBase,
    opacity: 0.4,
    cursor: 'not-allowed',
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
        Showing {from}–{to} of {totalItems}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button
          type="button"
          style={page <= 1 ? btnDisabled : btnBase}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          ← Prev
        </button>

        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            minWidth: '64px',
            textAlign: 'center',
          }}
        >
          {page} / {totalPages}
        </span>

        <button
          type="button"
          style={page >= totalPages ? btnDisabled : btnBase}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          Next →
        </button>
      </div>
    </div>
  );
};
