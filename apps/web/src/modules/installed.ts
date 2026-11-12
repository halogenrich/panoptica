import type { WebModule } from './types';

/**
 * The modules this build of the app has (0.43). The core never imports a module itself: when the app is built (or served for
 * development), vite.config.ts puts the list of modules in place of this file (all of those in modules/, or those named in
 * PANOPTICA_MODULES; none for the core alone). The server then says which are installed (`/api/version`); only those are shown.
 */
export const MODULES: WebModule[] = [];
