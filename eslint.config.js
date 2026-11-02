import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/', 'node_modules/']),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettier,
);
