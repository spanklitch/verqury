const node = {
  console: 'readonly',
  process: 'readonly',
  URL: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
};

export default [
  {
    ignores: ['**/node_modules/**'],
  },
  {
    // ESM sources (core + app main/logic)
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: node,
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // CommonJS preload
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable' },
    },
    rules: { 'no-undef': 'error' },
  },
  {
    // Browser renderer (ES modules)
    files: ['app/renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
];
