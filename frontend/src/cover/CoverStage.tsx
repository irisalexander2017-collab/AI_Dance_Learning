import { useEffect, useRef } from 'react'

/**
 * Animated cover scene (gold afterimage). Layers share the 1672×941 artwork coordinates:
 * background, a light sweep that wakes the painted trails, four gold "ghost" copies of the
 * dancer cut-out thrown out on the beat, the dancer hit, SVG trail arcs, floor rings and dust.
 * Loops pause when the stage is offscreen or the tab is hidden; reduced motion gets a still,
 * faded-in version (handled in CSS) and no rAF loop at all.
 */
export function CoverStage({ label }: { label: string }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const base = import.meta.env.BASE_URL

  useEffect(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const layers = Array.from(stage.querySelectorAll<HTMLElement>('[data-depth]'))
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const size = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
    }
    size()
    type Dust = { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number }
    const seed = (p: Dust) => {
      p.x = 0.6 + Math.random() * 0.26; p.y = 0.86 + Math.random() * 0.06
      p.vx = (Math.random() - 0.5) * 0.0004; p.vy = -(0.0004 + Math.random() * 0.0012)
      p.r = 0.6 + Math.random() * 1.6; p.life = 0; p.max = 120 + Math.random() * 160
      return p
    }
    const dust = Array.from({ length: 46 }, () => seed({} as Dust))
    let tx = 0, ty = 0, cx = 0, cy = 0
    let raf = 0
    let running = false
    let visible = true
    const tick = () => {
      cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12
      for (const layer of layers) {
        const depth = Number(layer.dataset.depth)
        layer.style.transform = `translate3d(${(cx * depth * 0.6).toFixed(2)}px,${(cy * depth * 0.4).toFixed(2)}px,0)`
      }
      if (ctx) {
        const w = canvas.width, h = canvas.height
        ctx.clearRect(0, 0, w, h)
        for (const p of dust) {
          p.x += p.vx; p.y += p.vy; p.life++
          if (p.life > p.max) seed(p)
          const alpha = Math.sin(Math.PI * p.life / p.max) * 0.85
          ctx.beginPath(); ctx.fillStyle = `rgba(241,217,153,${alpha.toFixed(3)})`
          ctx.arc(p.x * w, p.y * h, p.r * dpr, 0, 7); ctx.fill()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    const sync = () => {
      const go = visible && !document.hidden && !reduce?.matches
      stage.classList.toggle('is-paused', !(visible && !document.hidden))
      if (go && !running) { running = true; raf = requestAnimationFrame(tick) }
      if (!go && running) {
        running = false; cancelAnimationFrame(raf)
        if (reduce?.matches) { ctx?.clearRect(0, 0, canvas.width, canvas.height); layers.forEach(layer => { layer.style.transform = '' }) }
      }
    }
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      tx = (event.clientX / window.innerWidth - 0.5) * 2; ty = (event.clientY / window.innerHeight - 0.5) * 2
    }
    const onTilt = (event: DeviceOrientationEvent) => {
      if (event.gamma == null || event.beta == null) return
      tx = Math.max(-1, Math.min(1, event.gamma / 25)); ty = Math.max(-1, Math.min(1, (event.beta - 45) / 25))
    }
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() })
      : null
    observer?.observe(stage)
    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('deviceorientation', onTilt, { passive: true })
    window.addEventListener('resize', size)
    document.addEventListener('visibilitychange', sync)
    reduce?.addEventListener?.('change', sync)
    sync()
    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('deviceorientation', onTilt)
      window.removeEventListener('resize', size)
      document.removeEventListener('visibilitychange', sync)
      reduce?.removeEventListener?.('change', sync)
    }
  }, [])

  return <div className="cover-stage" ref={stageRef} role="img" aria-label={label}>
    <div className="cover-scene" style={{ ['--cover-bg' as string]: `url("${base}image/branding/cover/cover-bg.webp")`, ['--cover-dancer' as string]: `url("${base}image/branding/cover/cover-dancer.webp")` }}>
      <div className="cover-layer cover-bg" data-depth="-6" />
      <div className="cover-layer cover-sweep" data-depth="-6" />
      <div className="cover-layer" data-depth="10">
        <div className="cover-ghost" /><div className="cover-ghost" /><div className="cover-ghost" /><div className="cover-ghost" />
        <div className="cover-dancer" />
      </div>
      <svg className="cover-layer cover-fx" data-depth="14" viewBox="0 0 1672 941" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="coverGold" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#a8843f" stopOpacity="0" /><stop offset=".5" stopColor="#f6e2a8" /><stop offset="1" stopColor="#d6b873" /></linearGradient>
          <filter id="coverGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <path className="cover-arc" d="M812 607 C 830 420, 960 200, 1290 73" />
        <path className="cover-arc cover-arc-b" d="M1462 335 C 1600 400, 1580 600, 1404 686" />
        <ellipse className="cover-ring" cx="1208" cy="842" rx="330" ry="30" />
        <ellipse className="cover-ring cover-ring-b" cx="1208" cy="842" rx="330" ry="30" />
      </svg>
      <canvas className="cover-layer cover-dust" ref={canvasRef} aria-hidden="true" />
    </div>
    <div className="cover-beats" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index} style={{ ['--n' as string]: index }} />)}</div>
  </div>
}
