import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.changeset/**',
      '**/*.d.ts',
      // THE THREE A NUXT BUILD WRITES, ADDED AT `T061` AND THE SAME CLASS AS `dist`. `.output` is
      // the deployment Nitro assembles, `.nuxt` is what Nuxt generates to build it, and `.openref`
      // is what the module writes for Nitro to compile. All three are build output rather than
      // source, and linting somebody else's bundle reports on rules this configuration does not
      // even define.
      '**/.output/**',
      '**/.nuxt/**',
      '**/.openref/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // THE NUXT EXAMPLE'S OWN FILES ARE NOT IN A TYPESCRIPT PROJECT THIS REPOSITORY OWNS. A Nuxt
    // application's `tsconfig.json` extends the one Nuxt generates into `.nuxt`, which exists only
    // after a build, so type aware linting here would depend on build output being present. What
    // typechecks these two files is `nuxt build` itself, which the integration suite runs.
    files: ['examples/nuxt-reference/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { projectService: false, project: false } },
  },
  {
    files: ['**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'module',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  prettier,
);
