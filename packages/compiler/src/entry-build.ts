// A separate entry point so importing the render-only surface of `@miralo/compiler` (its
// default export, or `@miralo/compiler/render`) does not pull in Astro or sharp: `build`
// imports `astro` and `@astrojs/sitemap`, and `writeFixtureSite` imports `sharp`.
export { type BuildOptions, type BuildResult, build } from './build.js'
export { fixtureAssetBytes, writeFixtureSite } from './fixture-site.js'
