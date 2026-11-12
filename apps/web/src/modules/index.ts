import type { WebModule } from './types';
import { devices } from './devices';

/**
 * The modules this build of the app has (0.42). The server says which are installed (`/api/version`); only those are shown. The
 * internal builder (0.44) will write this list for each lab's package.
 */
export const MODULES: WebModule[] = [devices];
