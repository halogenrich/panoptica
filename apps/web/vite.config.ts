import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url)),
  web = fileURLToPath(new URL('./src', import.meta.url));

/**
 * The modules in this build (0.43): every folder in modules/ with a web part, or those listed in PANOPTICA_MODULES ('' or
 * 'none' for the core alone). They take the place of src/modules/installed.ts, so the core's code never names a module.
 */
function modules(): Plugin {
  const present = readdirSync(join(root, 'modules')).filter((id) =>
      existsSync(join(root, 'modules', id, 'web/src/index.tsx')),
    ),
    env = process.env.PANOPTICA_MODULES,
    ids =
      env === undefined
        ? present
        : env
            .split(',')
            .map((x) => x.trim())
            .filter((x) => x && x !== 'none');
  for (const id of ids) if (!present.includes(id)) throw new Error(`module ${id} has no web part in modules/`);
  const installed = join(web, 'modules/installed.ts').replace(/\\/g, '/').toLowerCase();
  let replaced = false;
  return {
    name: 'panoptica-modules',
    enforce: 'pre',
    load(id) {
      if (id.replace(/\\/g, '/').toLowerCase() !== installed) return null;
      replaced = true;
      return (
        ids
          .map(
            (m, i) =>
              `import m${i} from ${JSON.stringify(join(root, 'modules', m, 'web/src/index.tsx').replace(/\\/g, '/'))};`,
          )
          .join('\n') + `\nexport const MODULES = [${ids.map((_, i) => 'm' + i).join(', ')}];\n`
      );
    },
    // a build says which modules it has (tools/package.mjs checks it), and fails if the list was not put in place
    generateBundle() {
      if (!replaced) this.error('the module list (src/modules/installed.ts) was not replaced');
      this.emitFile({ type: 'asset', fileName: 'modules.json', source: JSON.stringify(ids) + '\n' });
    },
  };
}

export default defineConfig({
  plugins: [modules(), react()],
  // modules' screens import the core's pieces as @web/… (lib/ui, api, views/Calendar …)
  resolve: { alias: { '@web': web }, dedupe: ['react', 'react-dom'] },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3000' }, fs: { allow: [root] } },
});
