const FREEZE = process.env.NODE_ENV !== 'production'

/** A frozen deep copy, so a caller's value is neither mutated nor frozen. No-op in production. */
export function frozenCopy<T>(value: T): T {
  return FREEZE ? deepFreeze(structuredClone(value)) : value
}

/** Recursively freezes in development and test so accidental mutation throws. No-op in production. */
export function deepFreeze<T>(value: T): T {
  if (!FREEZE) return value
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  return value
}
