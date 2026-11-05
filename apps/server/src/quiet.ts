// node:sqlite prints an "experimental" warning on Node 22; it is stable enough for this app. Imported first so it runs before node:sqlite loads.
const emit = process.emitWarning.bind(process);
process.emitWarning = ((w: string | Error, ...rest: any[]) => { if (String((w as Error)?.message ?? w).includes('SQLite')) return; (emit as any)(w, ...rest); }) as typeof process.emitWarning;
export {};
