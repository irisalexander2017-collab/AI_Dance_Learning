export interface GestureFraming { zoom: number; panX: number; panY: number }
interface Point { x: number; y: number }

export class TeacherGesture {
  private pointers = new Map<number, Point>()
  private origin: Point = { x: 0, y: 0 }
  private framing: GestureFraming = { zoom: 1, panX: 0, panY: 0 }
  private distance = 0
  private moved = false
  private latest: GestureFraming = { zoom: 1, panX: 0, panY: 0 }

  start(id: number, x: number, y: number, framing: GestureFraming) {
    if (!this.pointers.size) this.moved = false
    this.pointers.set(id, { x, y })
    this.framing = { ...framing }
    this.latest = { ...framing }
    const points = [...this.pointers.values()]
    this.origin = this.center(points)
    if (points.length > 1) {
      this.distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      this.moved = true
    }
  }

  move(id: number, x: number, y: number): GestureFraming | null {
    if (!this.pointers.has(id)) return null
    this.pointers.set(id, { x, y })
    const points = [...this.pointers.values()], center = this.center(points)
    const dx = center.x - this.origin.x, dy = center.y - this.origin.y
    if (Math.hypot(dx, dy) > 6) this.moved = true
    const zoom = points.length > 1 && this.distance > 0
      ? Math.max(1, Math.min(3, this.framing.zoom * Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / this.distance))
      : this.framing.zoom
    this.latest = { zoom, panX: this.framing.panX + dx, panY: this.framing.panY + dy }
    return this.latest
  }

  end(id: number, cancelled = false) {
    if (!this.pointers.has(id)) return false
    this.pointers.delete(id)
    // Any multi-touch gesture remains a non-tap until every finger has lifted.
    const tap = !cancelled && !this.pointers.size && !this.moved
    if (this.pointers.size) {
      this.moved = true
      this.framing = { ...this.latest }
      this.origin = this.center([...this.pointers.values()])
    }
    return tap
  }

  reset() { this.pointers.clear(); this.moved = false }
  private center(points: Point[]): Point {
    return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length }
  }
}
