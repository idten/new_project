import js from '@eslint/js';
import html from 'eslint-plugin-html';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  { ignores: ['dist/', 'node_modules/'] },
  {
    // index.html 안의 인라인 <script>
    files: ['**/*.html'],
    plugins: { html, js },
    extends: ['js/recommended'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  {
    files: ['**/*.js'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['**/*.mjs'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
]);
