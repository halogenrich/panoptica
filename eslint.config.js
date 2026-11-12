// Lint rules: the recommended JavaScript and TypeScript sets, React hooks rules for the web app, and the line between the core
// and the modules.
// `any` is allowed for now (the server's request handlers use it); see docs/architecture.md, "Known debts".
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'backups/**', 'config/**', 'updates/**', 'out/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-redeclare': 'off', // TypeScript itself reports real redeclarations; the rule misreads a type and a value of the same name
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'modules/*/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'off' },
  },
  {
    files: [
      'apps/server/**/*.{ts,cjs}',
      'modules/*/server/**/*.ts',
      'modules/*/shared/**/*.ts',
      'tools/**/*.{js,mjs,cjs}',
      'packages/**/*.ts',
      '*.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // the boundary (0.43): the core never imports a module. Modules are found by their folder (modules/<id>) and put in place
    // by the build; a module imports the core only through @psc/server/api (server) and @web/… (web)
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/*/**', '@psc/devices', '@psc/devices/*', '@psc/devices-*'],
              message: 'the core does not import a module',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['modules/*/server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/server/**', '@psc/server/*', '!@psc/server/api'],
              message: 'a module uses the core through @psc/server/api',
            },
          ],
        },
      ],
    },
  },
  {
    // browser tests: code passed to page.evaluate runs in the page
    files: ['tools/browser.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
