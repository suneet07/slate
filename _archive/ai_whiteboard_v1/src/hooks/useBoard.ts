import { useEffect, useRef, useState } from 'react'
import { BoardStore } from '../engine/store'

const STORAGE_KEY = 'ai-whiteboard:board'

/**
 * Creates one store per mount and re-renders React whenever it changes.
 * The store itself is mutable and framework-free; React only observes it.
 */
export function useBoard(): { store: BoardStore; version: number } {
  const storeRef = useRef<BoardStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = new BoardStore()
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (saved) {
      try {
        storeRef.current.load(saved)
      } catch {
        // A corrupt save should never block the app from opening.
      }
    }
  }
  const store = storeRef.current
  const [version, setVersion] = useState(0)

  useEffect(() => store.subscribe(() => setVersion((v) => v + 1)), [store])

  // Debounced autosave so a refresh never loses the lesson.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, store.serialize())
      } catch {
        // Quota errors are not worth interrupting a lesson over.
      }
    }, 500)
    return () => clearTimeout(id)
  }, [store, version])

  return { store, version }
}
