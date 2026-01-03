import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import TerminalWindowApp from './TerminalWindowApp.jsx'
import './index.css'

const isTerminalWindow = (() => {
  try {
    const url = new URL(window.location.href)
    const flag = String(url.searchParams.get('terminalWindow') || '').trim().toLowerCase()
    return flag === '1' || flag === 'true' || flag === 'yes'
  } catch {
    return false
  }
})()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isTerminalWindow ? <TerminalWindowApp /> : <App />}
  </React.StrictMode>,
)
