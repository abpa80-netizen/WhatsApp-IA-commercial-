// Local asset declaration used by the Vite client entrypoint.
// Avoids depending on Vite's ambient type package during standalone tsc checks.
declare module '*.css' {
  const css: string;
  export default css;
}
