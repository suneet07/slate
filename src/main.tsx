import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// NOTE: React.StrictMode is intentionally omitted. react-konva's Stage does not
// survive StrictMode's double mount/unmount in React 19 — the second mount reuses a
// destroyed 0x0 backing canvas and every draw throws
// "drawImage ... canvas element with a width or height of 0", leaving a blank board.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
