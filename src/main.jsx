import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// StrictMode removed: double-mount in dev doubles WebGL context init,
// GPU buffer uploads, and canvas creation — costly for this app.
ReactDOM.createRoot(document.getElementById('root')).render(
  <App />,
)
