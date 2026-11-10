/**
 * Pressed state for every button, driven by pointer events.
 * iOS Safari only fires :active when a touch listener exists and releases it unpredictably,
 * so we add `.is-pressed` on pointerdown and drop it on up / cancel / when the finger slides off.
 */
const SELECTOR = 'button:not(:disabled), .button-link, label.upload-panel'

export function installPressFeedback(doc: Document = document) {
  let pressed: Element | null = null
  const release = () => { pressed?.classList.remove('is-pressed'); pressed = null }
  const onDown = (event: PointerEvent) => {
    if (event.button > 0) return
    const target = (event.target as Element | null)?.closest?.(SELECTOR)
    release()
    if (!target) return
    pressed = target
    target.classList.add('is-pressed')
  }
  const onMove = (event: PointerEvent) => {
    if (!pressed) return
    const rect = pressed.getBoundingClientRect()
    const slop = 12
    if (event.clientX < rect.left - slop || event.clientX > rect.right + slop || event.clientY < rect.top - slop || event.clientY > rect.bottom + slop) release()
  }
  const options = { passive: true, capture: true } as const
  doc.addEventListener('pointerdown', onDown, options)
  doc.addEventListener('pointermove', onMove, options)
  doc.addEventListener('pointerup', release, options)
  doc.addEventListener('pointercancel', release, options)
  doc.addEventListener('dragstart', release, options)
  // An empty touchstart listener lets iOS Safari apply :active styles at all.
  doc.addEventListener('touchstart', () => {}, { passive: true })
  window.addEventListener('blur', release)
  return () => {
    doc.removeEventListener('pointerdown', onDown, options)
    doc.removeEventListener('pointermove', onMove, options)
    doc.removeEventListener('pointerup', release, options)
    doc.removeEventListener('pointercancel', release, options)
    doc.removeEventListener('dragstart', release, options)
    window.removeEventListener('blur', release)
  }
}
