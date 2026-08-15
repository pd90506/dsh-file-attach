/** ESM loader stub: swallow CSS side-effect imports (used by bundle-render.mjs). */
export async function load(url, context, next) {
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {}', shortCircuit: true }
  }
  return next(url, context)
}
