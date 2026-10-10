import { useEffect, useRef, useState } from 'react'
import { execute, type Command } from '../ai/commands'
import { digestBoard } from '../ai/serialize'
import type { BoardStore } from '../engine/store'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

interface Props {
  store: BoardStore
  /** Bumped by the parent on every board change; re-renders the shape counter. */
  version: number
  onShowSpec: () => void
}

interface LogEntry {
  role: 'you' | 'board'
  text: string
  ok?: boolean
  /** Which model slot answered, e.g. "nvidia:meta/llama-3.3-70b-instruct". */
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

export function AiPanel({ store, onShowSpec }: Props) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [listening, setListening] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  const send = async (text: string) => {
    if (!text.trim() || busy) return
    setBusy(true)
    setPrompt('')
    setLog((l) => [...l, { role: 'you', text }])

    try {
      const first = await requestCommands(text, digestBoard(store))
      let model = first.model
      if (first.commands.length === 0) {
        setLog((l) => [...l, { role: 'board', text: 'No answer came back.', ok: false, model }])
        return
      }

      let report = execute(store, first.commands, { author: 'ai' })

      // Self-repair: hand the model its own error messages plus the fresh board
      // state and let it correct itself once. Cheap, and it rescues most of the
      // mistakes small models make (bad names, invalid enums, odd sizes).
      if (!report.ok) {
        const retry = await requestCommands(text, digestBoard(store), {
          previous: first.commands,
          errors: report.errors,
        }).catch(() => null)
        if (retry && retry.commands.length > 0) {
          report = execute(store, retry.commands, { author: 'ai' })
          // The failover chain may have moved on between the two calls.
          if (retry.model && retry.model !== model) model = `${model} → ${retry.model}`
        }
      }

      // A `say` answer is the reply; the command tally is just noise beside it.
      const spoken = report.messages.join('\n')
      const changes = report.results.filter((r) => r.ok && r.op !== 'say').length
      const summary = summarize(changes, report.errors, report.warnings)
      const shown = spoken
        ? changes > 0
          ? `${spoken}\n(${summary})`
          : spoken
        : summary
      setLog((l) => [...l, { role: 'board', text: shown, ok: report.ok, model, usage: first.usage }])
    } catch (err) {
      // Only suggest the backend is down when we genuinely could not reach it.
      // A model that answered badly is a different problem, and saying
      // "is the backend running?" sends you looking in the wrong place.
      const unreachable = err instanceof TypeError
      const message =
        err instanceof Error
          ? unreachable
            ? `Cannot reach the backend on ${API}. Is uvicorn running?`
            : err.message
          : 'Request failed.'
      setLog((l) => [...l, { role: 'board', text: message, ok: false }])
    } finally {
      setBusy(false)
    }
  }

  const toggleVoice = () => {
    const Recognition =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition
    if (!Recognition) {
      setLog((l) => [...l, { role: 'board', text: 'Voice input is not supported in this browser.', ok: false }])
      return
    }
    const recognition = new Recognition()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      const said = event.results[0][0].transcript
      setListening(false)
      void send(said)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognition.start()
    setListening(true)
  }

  const shapeCount = store.all().length

  return (
    <div className="wb-ai">
      <div className="wb-ai-head">
        <span className="wb-ai-title">AI</span>
        <span className="wb-ai-meta">
          {shapeCount} shape{shapeCount === 1 ? '' : 's'} · grid {store.cols}×{store.rows}
        </span>
        <button className="wb-link" onClick={onShowSpec} title="What the AI can do">
          commands
        </button>
      </div>

      <div className="wb-ai-log" ref={logRef}>
        {log.length === 0 && (
          <div className="wb-ai-empty">
            Try: <em>“draw the water cycle with three stages”</em>,{' '}
            <em>“align those boxes on the left”</em>, <em>“put a sticky note with the homework”</em>.
          </div>
        )}
        {log.map((entry, i) => (
          <div key={i} className={`wb-ai-msg wb-ai-${entry.role} ${entry.ok === false ? 'is-bad' : ''}`}>
            {entry.text}
            {entry.model && <span className="wb-ai-model">{entry.model}</span>}
            {entry.usage && entry.usage.total_tokens !== undefined && (
              <span className="wb-ai-model" style={{ marginLeft: 6, opacity: 0.8 }}>
                ({entry.usage.prompt_tokens} in / {entry.usage.completion_tokens} out)
              </span>
            )}
          </div>
        ))}
        {busy && <div className="wb-ai-msg wb-ai-board">Thinking…</div>}
      </div>

      <div className="wb-ai-input">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(prompt)}
          placeholder="Tell the board what to draw…"
          disabled={busy}
        />
        <button
          className={`wb-btn ${listening ? 'is-active' : ''}`}
          onClick={toggleVoice}
          title="Speak a request"
          disabled={busy}
        >
          🎤
        </button>
        <button className="wb-btn wb-primary" onClick={() => send(prompt)} disabled={busy}>
          Send
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ backend

interface RepairContext {
  previous: Command[]
  errors: string[]
}

interface Reply {
  commands: Command[]
  /** Which model slot in the failover chain actually answered. */
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

async function requestCommands(
  prompt: string,
  board: string,
  repair?: RepairContext,
): Promise<Reply> {
  const res = await fetch(`${API}/api/reason`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, board, repair }),
  })
  if (!res.ok) throw new Error(`Backend returned ${res.status}`)
  const data = (await res.json()) as {
    commands?: Command[]
    error?: string
    model?: string
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  if (data.error) throw new Error(data.error)
  return { commands: Array.isArray(data.commands) ? data.commands : [], model: data.model, usage: data.usage }
}

function summarize(okCount: number, errors: string[], warnings: string[]): string {
  let out = `${okCount} command${okCount === 1 ? '' : 's'} applied`
  if (warnings.length > 0) out += ` (${warnings.slice(0, 2).join('; ')})`
  if (errors.length > 0) out += `; ${errors.length} failed — ${errors.slice(0, 2).join(' | ')}`
  return out
}

// Minimal shims — the Web Speech API is not in the DOM lib types.
type SpeechRecognitionCtor = new () => {
  lang: string
  interimResults: boolean
  start: () => void
  onresult: (e: SpeechRecognitionEventLike) => void
  onerror: () => void
  onend: () => void
}

interface SpeechRecognitionEventLike {
  results: { [index: number]: { [index: number]: { transcript: string } } }
}
