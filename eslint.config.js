// ESLint (npm run lint), flat config. ESLint's recommended rules, like the front-end's
// config, with Node's globals for the app and scripts and Vitest's in the tests. It
// checks for real mistakes (undefined names, unused variables, unreachable code, ...);
// formatting is left as it is.

import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'

export default defineConfig([
  globalIgnores(['node_modules', 'coverage']),
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // `const { id, ...rest } = row` drops `id` on purpose, to keep the rest; that's not
      // an unused variable. Anything else unused is still an error.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
])
