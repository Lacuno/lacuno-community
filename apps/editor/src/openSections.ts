/** Remember explicit choices, including closing a section that starts open. */
const key = 'lacuno:open-sections'

const choices = (): Record<string, boolean> => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}')
    // Before the tabs this key held a list of the open names; it reads as no choices.
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

export const isOpen = (name: string, defaultOpen = false) => choices()[name] ?? defaultOpen

export function setOpen(name: string, open: boolean) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...choices(), [name]: open }))
  } catch {}
}
