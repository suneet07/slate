import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, ChevronDown, Check } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
import { SUPPORTED_MODELS, getModelConfig } from '../../lib/ai/models';
import { CLI_NAMES } from '../../lib/ai/llmClient';

export const ModelSelectorDropdown: React.FC = () => {
  const {
    selectedModelId,
    setSelectedModelId,
    setActiveModelName,
    groqApiKey,
    llmApiKey,
    openaiApiKey,
    aiConnection,
    setAiConnection,
    cliTool,
    cliModel
  } = useBoardStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentModel = getModelConfig(selectedModelId);
  const onCli = aiConnection === 'cli';
  const cliLabel = `${cliModel || 'default'} · ${CLI_NAMES[cliTool] ?? cliTool}`;
  const triggerLabel = onCli ? cliLabel : currentModel.name;

  // Sync model display name
  useEffect(() => {
    setActiveModelName(triggerLabel);
  }, [triggerLabel, setActiveModelName]);

  // Click outside listener to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Picking an API model is an explicit choice to use a key, so it switches the connection.
  const handleSelectModel = (modelId: string, modelName: string) => {
    setAiConnection('apiKey');
    setSelectedModelId(modelId);
    setActiveModelName(modelName);
    setIsOpen(false);
  };

  const isKeyPresent = (requiresKey: string) => {
    if (requiresKey === 'llmApiKey') return Boolean(llmApiKey);
    if (requiresKey === 'groqApiKey') return Boolean(groqApiKey);
    if (requiresKey === 'openaiApiKey') return Boolean(openaiApiKey);
    return true;
  };

  // Group models by provider
  // Every provider in SUPPORTED_MODELS must appear here — a missing group silently hides
  // those models from the picker (which is what happened to Antigravity).
  const providers = [
    { key: 'nvidia', title: '⚡ NVIDIA NIM / DeepSeek' },
    { key: 'groq', title: '🦙 Groq Cloud' },
    { key: 'openai', title: '🤖 OpenAI' },
    { key: 'custom', title: '💻 Local / Custom Endpoint' }
  ];

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Trigger Button — exact Drafting: app-3 bg, line border, sparkles in AI color */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Change AI model"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          height: 'var(--s-tap)',
          padding: '0 12px',
          borderRadius: '9px',
          border: '1px solid var(--s-line)',
          background: 'var(--s-app-3)',
          color: 'var(--s-ink)',
          fontSize: 'var(--s-fs-sm)',
          fontWeight: 600,
          fontFamily: 'inherit',
          cursor: 'pointer'
        }}
      >
        <Sparkles size={16} color="var(--s-ai)" />
        <span>{triggerLabel}</span>
        <ChevronDown size={14} color="var(--s-ink-3)" />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '44px',
            right: 0,
            width: '340px',
            maxHeight: '480px',
            overflowY: 'auto',
            zIndex: 100,
            padding: '12px',
            boxShadow: '0 15px 40px rgba(0, 0, 0, 0.6)',
            borderRadius: '14px',
            background: 'var(--s-app-2)',
            border: '1px solid var(--s-line)'
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--s-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', padding: '0 4px', fontFamily: 'var(--s-font-mono)' }}>
            Select AI Model & Engine
          </div>

          {/* The signed-in CLI is one entry here; which CLI and model is chosen in Settings. */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--s-ai)', marginBottom: '4px', padding: '2px 4px' }}>
              🔐 Signed-in CLI (no key)
            </div>
            <button
              onClick={() => {
                setAiConnection('cli');
                setIsOpen(false);
              }}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 10px',
                borderRadius: '8px',
                border: onCli ? '1px solid var(--s-accent-line)' : '1px solid transparent',
                background: onCli ? 'var(--s-accent-soft)' : 'var(--s-app-3)',
                color: 'var(--s-ink)',
                textAlign: 'left' as const,
                cursor: 'pointer'
              }}
            >
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{cliLabel}</div>
                <div style={{ fontSize: '11px', color: 'var(--s-ink-2)', marginTop: '2px' }}>
                  Change CLI or model in Settings (⚙)
                </div>
              </div>
              {onCli && <Check size={14} color="var(--s-accent)" />}
            </button>
          </div>

          {providers.map((p) => {
            const modelsInGroup = SUPPORTED_MODELS.filter((m) => m.provider === p.key);
            if (modelsInGroup.length === 0) return null;

            return (
              <div key={p.key} style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--s-ai)', marginBottom: '4px', padding: '2px 4px' }}>
                  {p.title}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {modelsInGroup.map((m) => {
                    const isSelected = !onCli && selectedModelId === m.id;
                    const hasKey = isKeyPresent(m.requiresKey);

                    return (
                      <button
                        key={m.id}
                        onClick={() => handleSelectModel(m.id, m.name)}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          border: isSelected ? '1px solid var(--s-accent-line)' : '1px solid transparent',
                          background: isSelected ? 'var(--s-accent-soft)' : 'var(--s-app-3)',
                          color: 'var(--s-ink)',
                          textAlign: 'left' as const,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ flex: 1, paddingRight: '8px' }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--s-ink)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>{m.name}</span>
                            {m.isRecommended && (
                              <span style={{ fontSize: '9px', background: 'var(--s-data-soft)', color: 'var(--s-data)', padding: '1px 5px', borderRadius: '4px', border: '1px solid rgba(87, 184, 148, 0.4)' }}>
                                Recommended
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--s-ink-2)', marginTop: '2px', lineHeight: '1.3' }}>
                            {m.description}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingTop: '2px' }}>
                          {hasKey ? (
                            <span title="API Key ready" style={{ fontSize: '10px', color: 'var(--s-data)' }}>🟢</span>
                          ) : (
                            <span title="Key missing in Settings" style={{ fontSize: '10px', color: 'var(--s-danger)' }}>🔴</span>
                          )}
                          {isSelected && <Check size={14} color="var(--s-accent)" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
