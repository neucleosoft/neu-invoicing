import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Renderer crashes land in the main process's log file (userData/logs) —
// otherwise a white-screen on the boss's machine leaves no trace anywhere.
window.addEventListener('error', (e) => {
  window.electronAPI?.log?.send('ERROR', `${e.message} @ ${e.filename}:${e.lineno}`).catch(() => {})
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  window.electronAPI?.log?.send('REJECTION', r instanceof Error ? (r.stack ?? r.message) : String(r)).catch(() => {})
})

console.log('📦 main.tsx loaded - Starting React initialization...');

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('❌ Root element not found!');
  } else {
    console.log('✅ Root element found, creating React root...');
    const root = ReactDOM.createRoot(rootElement);
    console.log('📝 Rendering App component...');
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log('✅ React render called successfully');
  }
} catch (error) {
  console.error('❌ React initialization failed:', error);
}
