export { createContext, type PlanContext, type Warning } from './context.js'
export { defineOperation, type OperationDef } from './define.js'
export { type PlanResult, planBatch } from './engine.js'
export {
  documentErrorResponse,
  OperationError,
  PatchError,
  StaleRevisionError,
} from './errors.js'
export { deepFreeze } from './freeze.js'
export { allIds } from './ids.js'
export { OPERATIONS, OPERATIONS_BY_TYPE, Operation } from './operations/index.js'
export { partialPatches } from './partial.js'
export { applyPatches, invertPatches, Patch, type Path, type PathSegment } from './patch.js'
export { MemoryPersistence, type Persistence } from './persistence.js'
export * from './references.js'
export { serializeDocument } from './serialize.js'
export { type ApplyResult, type Batch, DocumentStore, kindForMime } from './store.js'
export { stageUpload, UploadInput } from './upload.js'
