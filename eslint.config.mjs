// Dependency direction is enforced here, not by convention.
//   kernel → store → {parse, graph, history, semantic} → intent → compiler → govern → daemon → {serve-mcp, cli, extension, eval}
// An upward or sideways import fails `pnpm lint`, and therefore CI.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

// Workspace packages are imported as @riaf/<name> (or `riaf`), which pnpm links from node_modules; both
// the source tree and the linked path must map to the same element.
const pkg = (name) => ({ type: name, pattern: [`packages/${name}/**`, `node_modules/@riaf/${name}/**`, `**/node_modules/@riaf/${name}/**`], mode: 'full' });

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['packages/**/*.ts'],
      'boundaries/elements': [
        pkg('kernel'), pkg('store'),
        pkg('parse'), pkg('graph'), pkg('history'), pkg('semantic'),
        pkg('intent'), pkg('compiler'), pkg('govern'),
        pkg('models'), pkg('daemon'),
        pkg('serve-mcp'), pkg('cli'), pkg('extension'), pkg('eval'),
      ],
      'boundaries/dependency-nodes': ['import', 'dynamic-import'],
      'import/resolver': { typescript: { project: ['packages/*/tsconfig.json'], alwaysTryTypes: true, noWarnOnMultipleProjects: true } },
    },
    rules: {
      'boundaries/no-unknown': 'error',
      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          { from: 'kernel', allow: ['kernel'] },
          { from: 'store', allow: ['store', 'kernel'] },
          { from: 'parse', allow: ['parse', 'kernel', 'store'] },
          { from: 'graph', allow: ['graph', 'kernel', 'store', 'parse'] },
          { from: 'history', allow: ['history', 'kernel', 'store', 'graph'] },
          { from: 'semantic', allow: ['semantic', 'kernel', 'store', 'graph', 'history'] },
          { from: 'intent', allow: ['intent', 'kernel', 'store', 'graph', 'semantic'] },
          { from: 'compiler', allow: ['compiler', 'kernel', 'store', 'graph', 'history', 'semantic', 'intent'] },
          { from: 'govern', allow: ['govern', 'kernel', 'store', 'graph', 'semantic', 'compiler'] },
          { from: 'models', allow: ['models', 'kernel'] },
          { from: 'daemon', allow: ['daemon', 'kernel', 'store', 'parse', 'graph', 'history', 'semantic', 'intent', 'compiler', 'govern', 'models'] },
          { from: 'serve-mcp', allow: ['serve-mcp', 'kernel', 'daemon', 'compiler'] },
          { from: 'cli', allow: ['cli', 'kernel', 'daemon', 'serve-mcp', 'eval', 'compiler'] },
          { from: 'extension', allow: ['extension', 'kernel', 'daemon', 'models', 'compiler'] },
          { from: 'eval', allow: ['eval', 'kernel', 'daemon', 'compiler'] },
        ],
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Tests may build fixture indexes with the lower pipeline (parse → graph → history → semantic) even
  // where production code may not import it; nothing above the importing layer is ever allowed.
  {
    files: ['packages/*/test/**/*.ts'],
    rules: {
      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          { from: 'kernel', allow: ['kernel'] },
          { from: 'store', allow: ['store', 'kernel'] },
          { from: 'parse', allow: ['parse', 'kernel', 'store'] },
          { from: 'graph', allow: ['graph', 'kernel', 'store', 'parse'] },
          { from: 'history', allow: ['history', 'kernel', 'store', 'parse', 'graph'] },
          { from: 'semantic', allow: ['semantic', 'kernel', 'store', 'parse', 'graph', 'history'] },
          { from: 'intent', allow: ['intent', 'kernel', 'store', 'parse', 'graph', 'history', 'semantic'] },
          { from: 'compiler', allow: ['compiler', 'kernel', 'store', 'parse', 'graph', 'history', 'semantic', 'intent'] },
          { from: 'govern', allow: ['govern', 'kernel', 'store', 'parse', 'graph', 'history', 'semantic', 'compiler'] },
          { from: 'models', allow: ['models', 'kernel'] },
          { from: 'daemon', allow: ['daemon', 'kernel', 'store', 'parse', 'graph', 'history', 'semantic', 'intent', 'compiler', 'govern', 'models'] },
          { from: 'serve-mcp', allow: ['serve-mcp', 'kernel', 'daemon', 'compiler'] },
          { from: 'cli', allow: ['cli', 'kernel', 'daemon', 'serve-mcp', 'eval', 'compiler'] },
          { from: 'extension', allow: ['extension', 'kernel', 'daemon', 'models', 'compiler'] },
          { from: 'eval', allow: ['eval', 'kernel', 'daemon', 'compiler'] },
        ],
      }],
    },
  },
  { ignores: ['**/dist/**', '**/node_modules/**', 'fixtures/**', 'tooling/**'] },
);
