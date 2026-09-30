/** Inspector sections start closed; the ones opened by hand stay open, across selections and reloads. */
const key = 'lacuno:open-sections'

const opened = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]')
  } catch {
    return []
  }
}

export const isOpen = (name: string) => opened().includes(name)

export function setOpen(name: string, open: boolean) {
  const rest = opened().filter((item) => item !== name)
  try {
    localStorage.setItem(key, JSON.stringify(open ? [...rest, name] : rest))
  } catch {}
}
