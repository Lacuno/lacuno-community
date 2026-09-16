const FREEZE = process.env.NODE_ENV !== 'production'

/** Recursively freezes in development and test so accidental mutation throws. No-op in production. */
export function deepFreeze<T>(value: T): T {
  if (!FREEZE) return value
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  return value
}
