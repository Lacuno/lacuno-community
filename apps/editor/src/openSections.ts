/** Remember explicit choices, including closing a section that starts open. */
const key = 'lacuno:open-sections'

const opened = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]')
  } catch {
    return []
  }
}

const choices = (): Record<string, boolean> => {
  try {
    const value = JSON.parse(localStorage.getItem(`${key}:choices`) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

export const isOpen = (name: string, defaultOpen = false) =>
  choices()[name] ?? (opened().includes(name) || defaultOpen)

export function setOpen(name: string, open: boolean) {
  const rest = opened().filter((item) => item !== name)
  try {
    localStorage.setItem(key, JSON.stringify(open ? [...rest, name] : rest))
    localStorage.setItem(`${key}:choices`, JSON.stringify({ ...choices(), [name]: open }))
  } catch {}
}
