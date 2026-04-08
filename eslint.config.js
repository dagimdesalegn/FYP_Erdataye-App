// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

// Find the TS config object that has the @typescript-eslint plugin
const tsConfig = (Array.isArray(expoConfig) ? expoConfig : [expoConfig])
  .find(c => c.plugins && c.plugins['@typescript-eslint']);

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  // Override unused-vars to allow _ prefix
  ...(tsConfig ? [{
    plugins: tsConfig.plugins,
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        vars: 'all',
        args: 'none',
        ignoreRestSiblings: true,
        caughtErrors: 'all',
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  }] : []),
]);
