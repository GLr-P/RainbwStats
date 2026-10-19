import { createRoot } from 'react-dom/client'

function App() {
  return <div data-app-ready>RainbwStats</div>
}

createRoot(document.getElementById('root')!).render(<App />)
