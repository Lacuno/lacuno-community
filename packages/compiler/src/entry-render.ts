/**
 * Everything the scaffold's route imports. Deliberately excludes build.ts so the Astro bundle
 * never pulls in Astro's own Node build API.
 */
export { parseDocument } from '@miralo/schema'
export { imageResolverFrom, resolveAllImages } from './images.js'
export { assembleDocument, render } from './render.js'
export { enumerateRoutes } from './routes.js'
