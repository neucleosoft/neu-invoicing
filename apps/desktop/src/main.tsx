import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

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
