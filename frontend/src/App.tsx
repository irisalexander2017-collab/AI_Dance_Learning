import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

function App() {
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Health check failed')
        return response.json()
      })
      .then((data) => setBackendConnected(data.status === 'ok'))
      .catch(() => setBackendConnected(false))

    return () => controller.abort()
  }, [])

  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">LOCAL PRACTICE TOOL</p>
        <h1>AI Dance Learning</h1>
        <p className="tagline">Turn dance videos into simple 8-count practice sessions.</p>
        <div className="status-list" aria-label="Service status">
          <div className="status"><span className="dot online" />Frontend running</div>
          <div className="status"><span className={`dot ${backendConnected ? 'online' : backendConnected === false ? 'offline' : 'checking'}`} />
            {backendConnected === null ? 'Checking backend…' : backendConnected ? 'Backend connected' : 'Backend unavailable'}
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
