import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Sparkles, Mic, Code, ChevronDown, ChevronUp, Trash2, FileText } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
import { processTextCommand } from '../../lib/ai/orchestrator';

export const ChatSidebar: React.FC = () => {
  const {
    chatMessages,
    isChatOpen,
    toggleChat,
    clearChat,
    isAiProcessing,
    getSceneGraph,
    llmApiKey,
    groqApiKey,
    activeModelName
  } = useBoardStore();

  const [inputVal, setInputVal] = useState('');
  const [expandedGraphs, setExpandedGraphs] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  if (!isChatOpen) return null;

  const handleSendText = async () => {
    if (!inputVal.trim() || isAiProcessing) return;
    const text = inputVal.trim();
    setInputVal('');

    try {
      await processTextCommand(text, getSceneGraph(), {
        llmApiKey,
        groqApiKey
      });
    } catch (err: any) {
      console.error('Text command failed:', err);
      useBoardStore.getState().setAiStatus(false, '');
      useBoardStore.getState().addChatMessage({
        sender: 'system',
        text: `❌ Command failed: ${err.message}`
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendText();
    }
  };

  const toggleGraphExpand = (msgId: string) => {
    setExpandedGraphs((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: '16px',
        right: '16px',
        bottom: '16px',
        width: '360px',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--s-app-2)',
        border: '1px solid var(--s-line)',
        borderRadius: '14px',
        overflow: 'hidden',
        zIndex: 55
      }}
    >
      {/* ─── Header ─── */}
      <div
        style={{
          padding: '13px 15px',
          borderBottom: '1px solid var(--s-line)',
          background: 'var(--s-app-3)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MessageSquare size={17} color="var(--s-ai)" />
            <span style={{ fontFamily: 'var(--s-font-display)', fontSize: '17px', fontWeight: 700, color: 'var(--s-ink)' }}>
              Voice & text
            </span>
          </div>
          <div style={{ fontFamily: 'var(--s-font-mono)', fontSize: '11.5px', color: 'var(--s-ai)', marginTop: '3px' }}>
            active: {activeModelName}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={clearChat}
            title="Clear Chat History"
            style={{ width: '28px', height: '28px', border: 'none', background: 'none', color: 'var(--s-ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <Trash2 size={15} />
          </button>
          <button
            onClick={toggleChat}
            title="Close Chat Panel"
            style={{ width: '28px', height: '28px', border: 'none', background: 'none', color: 'var(--s-ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ─── Messages Feed ─── */}
      <div
        style={{
          flex: 1,
          padding: '15px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '13px'
        }}
      >
        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start'
            }}
          >
            {/* Message Bubble */}
            <div
              style={{
                maxWidth: msg.sender === 'user' ? '88%' : '92%',
                padding: msg.sender === 'system' ? '10px 12px' : '11px 13px',
                borderRadius: msg.sender === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                background:
                  msg.sender === 'user'
                    ? 'var(--s-accent)'
                    : msg.sender === 'system'
                    ? 'var(--s-app-3)'
                    : 'var(--s-app-3)',
                border: msg.sender === 'ai'
                  ? '1px solid var(--s-ai-line)'
                  : msg.sender === 'system'
                  ? '1px solid var(--s-line-2)'
                  : 'none',
                color: msg.sender === 'user' ? 'var(--s-accent-ink)' : 'var(--s-ink)',
                fontSize: msg.sender === 'system' ? '13.5px' : '14px',
                lineHeight: '1.45',
                whiteSpace: 'pre-wrap' as const
              }}
            >
              {/* Header: sender tag */}
              <div
                style={{
                  fontSize: msg.sender === 'system' ? '10.5px' : '11px',
                  fontWeight: msg.sender === 'user' ? 700 : 400,
                  opacity: msg.sender === 'user' ? 0.75 : 1,
                  color: msg.sender === 'user'
                    ? 'var(--s-accent-ink)'
                    : msg.sender === 'ai'
                    ? 'var(--s-ai)'
                    : 'var(--s-ink-3)',
                  marginBottom: msg.sender === 'system' ? '4px' : '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontFamily: msg.sender !== 'user' ? 'var(--s-font-mono)' : 'inherit',
                  letterSpacing: msg.sender !== 'user' ? '0.06em' : undefined,
                  textTransform: msg.sender !== 'user' ? 'uppercase' as const : undefined
                }}
              >
                {msg.sender === 'user' ? <Mic size={11} /> : msg.sender === 'ai' ? <Sparkles size={12} /> : null}
                <span>
                  {msg.sender === 'user'
                    ? `you · ${msg.timestamp}`
                    : msg.sender === 'ai'
                    ? `slate ai · ${activeModelName}`
                    : 'system'}
                </span>
              </div>

              {/* Message Content */}
              <div style={{ lineHeight: '1.5' }}>{msg.text}</div>

              {/* Cropped Image Payload */}
              {msg.imageCropUrl && (
                <div style={{ marginTop: '8px', marginBottom: '8px' }}>
                  <img
                    src={msg.imageCropUrl}
                    alt="TrOCR Image Crop"
                    style={{
                      maxWidth: '100%',
                      borderRadius: '6px',
                      border: '1px solid var(--s-line)',
                      background: '#ffffff',
                      padding: '4px'
                    }}
                  />
                </div>
              )}

              {/* Expandable Scene Graph Context */}
              {msg.graphSnippet && (
                <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid var(--s-line-2)' }}>
                  <button
                    onClick={() => toggleGraphExpand(msg.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--s-ink-3)',
                      fontSize: '11.5px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: 0,
                      fontFamily: 'var(--s-font-mono)'
                    }}
                  >
                    <Code size={12} />
                    <span>{expandedGraphs[msg.id] ? 'hide scene graph sent' : 'view scene graph sent'}</span>
                    {expandedGraphs[msg.id] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>

                  {expandedGraphs[msg.id] && (
                    <pre
                      className="mono-font"
                      style={{
                        marginTop: '9px',
                        padding: '9px 10px',
                        borderRadius: '8px',
                        background: 'var(--s-app)',
                        border: '1px solid var(--s-line-2)',
                        fontFamily: 'var(--s-font-mono)',
                        fontSize: '12px',
                        lineHeight: '1.6',
                        color: 'var(--s-data)',
                        overflowX: 'auto',
                        whiteSpace: 'pre-wrap'
                      }}
                    >
                      {msg.graphSnippet}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* ─── Input Area ─── */}
      <div
        style={{
          padding: '12px',
          borderTop: '1px solid var(--s-line)',
          background: 'var(--s-app-3)',
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}
      >
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Speak or type a command…"
          style={{
            flex: 1,
            height: '38px',
            padding: '0 13px',
            borderRadius: '10px',
            border: '1px solid var(--s-line)',
            background: 'var(--s-app)',
            color: 'var(--s-ink)',
            fontFamily: 'inherit',
            fontSize: '13.5px',
            outline: 'none'
          }}
        />
        <button
          onClick={handleSendText}
          disabled={!inputVal.trim() || isAiProcessing}
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            border: 'none',
            background: 'var(--s-accent)',
            color: 'var(--s-accent-ink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: inputVal.trim() ? 'pointer' : 'default'
          }}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
};
