// A separate entry point so importing the render-only surface of `@lacuno/compiler` (its
// default export, or `@lacuno/compiler/render`) does not pull in Astro or sharp: `build`
// imports `astro` and `@astrojs/sitemap`, and `writeFixtureSite` imports `sharp`.
export { type BuildOptions, type BuildResult, build } from './build.js'
export { fixtureAssetBytes, writeFixtureSite } from './fixture-site.js'
