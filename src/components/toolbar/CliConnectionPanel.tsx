import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CliTool } from '../../store/useBoardStore';

interface CliModel {
  id: string;
  name: string;
}

interface CliStatus {
  id: CliTool;
  name: string;
  installed: boolean;
  signedIn: boolean;
  detail: string;
  loginHint: string;
  models: CliModel[];
}

interface Props {
  tool: CliTool;
  model: string;
  onToolChange: (tool: CliTool) => void;
  onModelChange: (model: string) => void;
}

/**
 * Picks a signed-in AI CLI. Status comes from the dev server's bridge, which asks each CLI
 * directly (`agy models`, `claude auth status`) — so "signed in" here means the CLI really
 * has a live session, not that a binary happens to exist.
 */
export const CliConnectionPanel: React.FC<Props> = ({ tool, model, onToolChange, onModelChange }) => {
  const [clis, setClis] = useState<CliStatus[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/cli/status${refresh ? '?refresh=1' : ''}`, {
        headers: { 'X-Slate-Bridge': '1' }
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setClis(data.clis ?? []);
    } catch (err: any) {
      // The bridge lives in the Vite dev server; a static build has no way to run CLIs.
      setError(`Could not reach the CLI bridge (${err.message}). It runs inside \`npm run dev\` only.`);
      setClis([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const selected = clis?.find((c) => c.id === tool);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', color: '#9ca3af' }}>
          Uses a CLI you are already signed in to on this computer. No API key is stored or sent.
        </span>
        <button
          onClick={() => void load(true)}
          disabled={loading}
          title="Check sign-in again"
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '6px',
            color: '#9ca3af',
            cursor: loading ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 8px',
            fontSize: '11px',
            flexShrink: 0
          }}
        >
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} />
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {error && <div style={{ fontSize: '12px', color: '#f87171' }}>{error}</div>}
      {clis === null && <div style={{ fontSize: '12px', color: '#6b7280' }}>Checking which CLIs are signed in…</div>}

      {clis?.map((c) => {
        const isSelected = c.id === tool;
        const dot = c.signedIn ? '#10b981' : c.installed ? '#f59e0b' : '#4b5563';
        const label = c.signedIn ? 'Signed in' : c.installed ? 'Signed out' : 'Not installed';
        return (
          <button
            key={c.id}
            onClick={() => onToolChange(c.id)}
            style={{
              textAlign: 'left',
              padding: '10px 12px',
              borderRadius: '8px',
              border: isSelected ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.12)',
              background: isSelected ? 'rgba(99,102,241,0.12)' : '#161822',
              color: '#f3f4f6',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>{c.name}</span>
              <span style={{ fontSize: '11px', color: dot, display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, display: 'inline-block' }} />
                {label}
              </span>
            </div>
            {!c.signedIn && (
              <span style={{ fontSize: '11px', color: '#9ca3af', lineHeight: 1.4 }}>
                {c.installed ? c.loginHint : c.detail}
              </span>
            )}
          </button>
        );
      })}

      {selected && (
        <div>
          <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>
            Model
          </label>
          {selected.models.length > 0 ? (
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: '#161822',
                color: '#ffffff',
                fontSize: '13px',
                outline: 'none'
              }}
            >
              <option value="">CLI default</option>
              {/* Keep a saved model visible even if this CLI no longer lists it. */}
              {model && !selected.models.some((m) => m.id === model) && <option value={model}>{model}</option>}
              {selected.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              placeholder="Leave blank for the CLI's default"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: '#161822',
                color: '#ffffff',
                fontSize: '13px'
              }}
            />
          )}
          <span style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px', display: 'block' }}>
            The CLI runs with its tools switched off, so it can answer but never act on this computer.
          </span>
        </div>
      )}
    </div>
  );
};
