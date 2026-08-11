import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import ToastHost from './components/Toast'
import { installConsoleTee } from './utils/log'
import './theme/tokens.css'
import './index.css'

installConsoleTee()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <ToastHost />
    </ErrorBoundary>
  </React.StrictMode>,
)
