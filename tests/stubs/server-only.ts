/**
 * Test stand-in for the `server-only` marker package.
 *
 * `server-only` exists to make a bundler refuse to pull a module into a client
 * component. It is provided by the framework at build time and it *throws* when
 * imported outside a react-server condition, which is exactly what happens under
 * vitest. Tests run in Node and are not a client bundle, so the marker has no
 * meaning here; aliasing it to this empty module keeps the guard in production
 * while letting tests import the same modules the app does.
 */
export {};
