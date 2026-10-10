import React, { useState } from 'react';
import { X, Key, Server, Check, Cpu, Compass } from 'lucide-react';
import { DEFAULT_EXPERT_RULES, useBoardStore, type AiConnection, type CliTool } from '../../store/useBoardStore';
import { CliConnectionPanel } from './CliConnectionPanel';
import { SUPPORTED_MODELS, getModelConfig } from '../../lib/ai/models';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const {
    groqApiKey,
    llmApiKey,
    openaiApiKey,
    customApiEndpoint,
    customModelId,
    trocrUrl,
    expertRules,
    selectedModelId,
    autoExecuteHandwriting,
    setGroqApiKey,
    setLlmApiKey,
    setOpenaiApiKey,
    setCustomApiEndpoint,
    setCustomModelId,
    aiConnection,
    cliTool,
    cliModel,
    setAiConnection,
    setCliTool,
    setCliModel,
    setTrocrUrl,
    setExpertRules,
    setSelectedModelId,
    setAutoExecuteHandwriting
  } = useBoardStore();

  const [groqKeyInput, setGroqKeyInput] = useState(groqApiKey);
  const [llmKeyInput, setLlmKeyInput] = useState(llmApiKey);
  const [openaiKeyInput, setOpenaiKeyInput] = useState(openaiApiKey);
  const [customEndpointInput, setCustomEndpointInput] = useState(customApiEndpoint);
  const [customModelInput, setCustomModelInput] = useState(customModelId);
  const [connectionInput, setConnectionInput] = useState<AiConnection>(aiConnection);
  const [cliToolInput, setCliToolInput] = useState<CliTool>(cliTool);
  const [cliModelInput, setCliModelInput] = useState(cliModel);
  const [trocrInput, setTrocrInput] = useState(trocrUrl);
  const [expertRulesInput, setExpertRulesInput] = useState(expertRules);
  const [saved, setSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    setGroqApiKey(groqKeyInput.trim());
    setLlmApiKey(llmKeyInput.trim());
    setOpenaiApiKey(openaiKeyInput.trim());
    setCustomApiEndpoint(customEndpointInput.trim());
    setCustomModelId(customModelInput.trim());
    setAiConnection(connectionInput);
    setCliTool(cliToolInput);
    setCliModel(cliModelInput.trim());
    setTrocrUrl(trocrInput.trim());
    setExpertRules(expertRulesInput.trim());
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: '500px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '24px',
          color: '#f3f4f6',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Key size={20} color="#818cf8" />
            <span>AI Model & Integration Settings</span>
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* How Slate reaches a model. Two genuinely different setups: a pasted key, or a
              CLI already signed in through OAuth on this machine. */}
          <div>
            <label style={{ fontSize: '13px', color: '#818cf8', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
              Connect AI with
            </label>
            <div style={{ display: 'flex', gap: '6px', padding: '4px', borderRadius: '10px', background: '#161822', border: '1px solid rgba(255,255,255,0.1)' }}>
              {([
                ['cli', 'Signed-in CLI (OAuth)'],
                ['apiKey', 'API key']
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setConnectionInput(mode)}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: '7px',
                    border: 'none',
                    background: connectionInput === mode ? '#6366f1' : 'transparent',
                    color: connectionInput === mode ? '#ffffff' : '#9ca3af',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer'
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {connectionInput === 'cli' && (
            <CliConnectionPanel
              tool={cliToolInput}
              model={cliModelInput}
              onToolChange={(t) => {
                setCliToolInput(t);
                setCliModelInput('');
              }}
              onModelChange={setCliModelInput}
            />
          )}

          {connectionInput === 'apiKey' && (<>
          {/* Active Model Selection */}
          <div>
            <label style={{ fontSize: '13px', color: '#818cf8', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
              Active AI Model Engine
            </label>
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #6366f1',
                background: '#161822',
                color: '#ffffff',
                fontSize: '14px',
                outline: 'none'
              }}
            >
              {SUPPORTED_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.provider === 'nvidia' ? '⚡' : m.provider === 'groq' ? '🦙' : m.provider === 'openai' ? '🤖' : '💻'} {m.name} ({m.providerName})
                </option>
              ))}
            </select>
          </div>

          {/* NVIDIA NIM Key */}
          <div>
            <label style={{ fontSize: '13px', color: '#9ca3af', display: 'block', marginBottom: '6px' }}>
              NVIDIA NIM / DeepSeek API Key
            </label>
            <input
              type="password"
              value={llmKeyInput}
              onChange={(e) => setLlmKeyInput(e.target.value)}
              placeholder="nvapi-..."
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: '#161822',
                color: '#ffffff',
                fontSize: '14px'
              }}
            />
            <span style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px', display: 'block' }}>
              Used for DeepSeek V4 Flash, DeepSeek R1, DeepSeek V3, and Nemotron on NVIDIA NIM.
            </span>
          </div>

          {/* OpenAI Key */}
          <div>
            <label style={{ fontSize: '13px', color: '#9ca3af', display: 'block', marginBottom: '6px' }}>
              OpenAI API Key (GPT-4o, GPT-4o-mini, o3-mini)
            </label>
            <input
              type="password"
              value={openaiKeyInput}
              onChange={(e) => setOpenaiKeyInput(e.target.value)}
              placeholder="sk-..."
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: '#161822',
                color: '#ffffff',
                fontSize: '14px'
              }}
            />
          </div>

          {/* Custom Base URL & Model ID */}
          {getModelConfig(selectedModelId).provider === 'custom' && (
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>
                  Custom API Base URL (Ollama / LM Studio / OpenRouter)
                </label>
                <input
                  type="text"
                  value={customEndpointInput}
                  onChange={(e) => setCustomEndpointInput(e.target.value)}
                  placeholder="http://localhost:11434/v1"
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
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>
                  Custom Model ID
                </label>
                <input
                  type="text"
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  placeholder="mistralai/mistral-7b-instruct"
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
              </div>
            </div>
          )}

          </>)}

          {/* Groq Key */}
          <div>
            <label style={{ fontSize: '13px', color: '#9ca3af', display: 'block', marginBottom: '6px' }}>
              Groq API Key — voice input, and fallback model
            </label>
            <input
              type="password"
              value={groqKeyInput}
              onChange={(e) => setGroqKeyInput(e.target.value)}
              placeholder="gsk_..."
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: '#161822',
                color: '#ffffff',
                fontSize: '14px'
              }}
            />
            <span style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px', display: 'block' }}>
              Voice commands use Groq Whisper in either mode. With a key set, a failed request also falls back to LLaMA 3.3 70B.
            </span>
          </div>

          {/* TrOCR Server URL */}
          <div>
            <label style={{ fontSize: '13px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <Server size={14} color="#06b6d4" />
              <span>TrOCR Handwriting Server URL (Google Colab Cloudflare Tunnel)</span>
            </label>
            <input
              type="text"
              value={trocrInput}
              onChange={(e) => setTrocrInput(e.target.value)}
              placeholder="https://random-subdomain.trycloudflare.com"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: '#161822',
                color: '#ffffff',
                fontSize: '14px'
              }}
            />
          </div>

          {/* Expert routing rules.
              Domain knowledge as prompt text: this is what points a question at the right
              section, and it costs an edit rather than an embedding fine-tune. */}
          <div>
            <label style={{ fontSize: '13px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <Compass size={14} color="#10b981" />
              <span>Expert Retrieval Rules — where the AI should look in your notes</span>
            </label>
            <textarea
              value={expertRulesInput}
              onChange={(e) => setExpertRulesInput(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder="- Definitions -> the section that first introduces the term"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: '#161822',
                color: '#ffffff',
                fontSize: '12.5px',
                fontFamily: 'var(--s-font-mono)',
                lineHeight: '1.5',
                resize: 'vertical'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
              <span style={{ fontSize: '11px', color: '#6b7280' }}>
                Written for your subject, these decide which section a question is routed to.
              </span>
              <button
                onClick={() => setExpertRulesInput(DEFAULT_EXPERT_RULES)}
                style={{ background: 'none', border: 'none', color: '#10b981', fontSize: '11px', cursor: 'pointer' }}
              >
                Reset to defaults
              </button>
            </div>
          </div>

          {/* Auto-execute toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
            <input
              type="checkbox"
              id="autoExecuteHandwritingToggle"
              checked={autoExecuteHandwriting}
              onChange={(e) => setAutoExecuteHandwriting(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: '#6366f1', cursor: 'pointer' }}
            />
            <label htmlFor="autoExecuteHandwritingToggle" style={{ fontSize: '13px', color: '#e0e7ff', cursor: 'pointer', fontWeight: 500 }}>
              ⚡ Auto-Execute LLM Whiteboard Actions from TrOCR Handwriting
            </label>
          </div>
        </div>

        {/* Footer actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent',
              color: '#9ca3af',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              background: saved ? '#10b981' : '#6366f1',
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease'
            }}
          >
            {saved ? <Check size={16} /> : null}
            <span>{saved ? 'Saved!' : 'Save Settings'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
