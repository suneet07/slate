import React, { useState, useRef } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
import { processVoiceCommand } from '../../lib/ai/orchestrator';

export const VoiceButton: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const { groqApiKey, llmApiKey, setAiStatus, getSceneGraph } = useBoardStore();

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await handleAudioProcess(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setAiStatus(true, 'Listening... Speak your command');
    } catch (err) {
      console.error('Microphone permission error:', err);
      alert('Unable to access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleAudioProcess = async (audioBlob: Blob) => {
    setIsProcessing(true);
    setAiStatus(true, 'Transcribing audio via Groq Whisper...');

    try {
      const sceneGraph = getSceneGraph();
      await processVoiceCommand(audioBlob, sceneGraph, {
        groqApiKey,
        llmApiKey
      });
    } catch (error: any) {
      console.error('Voice processing failed:', error);
      setAiStatus(false, `Error: ${error.message || 'Processing failed'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <button
      onClick={isRecording ? stopRecording : startRecording}
      disabled={isProcessing}
      title="Push to talk"
      className={isRecording ? 'animate-pulse-mic' : ''}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        height: 'var(--s-tap)',
        padding: '0 16px',
        borderRadius: '9px',
        border: 'none',
        background: isRecording ? 'var(--s-danger)' : 'var(--s-accent)',
        color: isRecording ? '#fff' : 'var(--s-accent-ink)',
        fontSize: 'var(--s-fs)',
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
        animation: !isRecording && !isProcessing ? 's-pulse 2.4s infinite' : 'none'
      }}
    >
      {isProcessing ? (
        <Loader2 size={17} className="animate-spin" />
      ) : isRecording ? (
        <MicOff size={17} />
      ) : (
        <Mic size={17} />
      )}
      <span>{isProcessing ? 'Processing...' : isRecording ? 'Stop' : 'Speak'}</span>
    </button>
  );
};
