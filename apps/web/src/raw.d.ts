declare module '*.md?raw' {
  const text: string;
  export default text;
}
declare module '*?url' {
  const url: string;
  export default url;
}

/** Stylesheets imported for their side effect (bundled by Vite). */
declare module '*.css';
