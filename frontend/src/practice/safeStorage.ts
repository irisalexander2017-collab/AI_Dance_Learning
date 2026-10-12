// Browsers may disable local storage. Practice still works for this session.
export const safeStorage = {
  getItem(key: string): string | null { try { return localStorage.getItem(key) } catch { return null } },
  setItem(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* Keep session state without crashing. */ } },
}
