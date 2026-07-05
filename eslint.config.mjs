import eslint from '@eslint/js';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      obsidianmd,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },
  {
    // Architectural invariant: the pure search engine never touches Obsidian.
    // Everything rank-relevant stays headless and vitest-testable.
    files: ['src/index/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'obsidian',
              message:
                'src/index/** must stay pure and headless. Keep Obsidian access in src/service/**, src/ui/**, or src/main.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    // Test files may use console freely and are not bound by the purity rule.
    files: ['src/**/*.test.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: ['main.js', 'node_modules/**'],
  },
);
