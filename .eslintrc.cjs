'use strict';
module.exports = {
  settings: {
    react: {
      pragma: 'React',
      version: '16.12.0',
    }
  },
  env: {
    browser: true,
    es6: true,
    node: true,
  },
  'extends': ['eslint:recommended', 'plugin:react/recommended'],
  parser: '@babel/eslint-parser',
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 8,
    requireConfigFile: false,
    babelOptions: {
      presets: ['@babel/preset-react']
    },
  },
  ignorePatterns: ['*bundle*.js'],
  rules: {
    // Possible errors
    indent: 'off',
    'no-cond-assign': 'off',
    'no-constant-condition': 'off',
    'no-console': 'off',
    'no-control-regex': 'warn',
    'no-extra-parens': 'error',
    'no-func-assign': 'warn',
    'no-inner-declarations': 'off',
    'no-negated-in-lhs': 'warn',
    'no-sparse-arrays': 'warn',
    'no-unexpected-multiline': 'warn',
    'use-isnan': 'warn',
    'valid-typeof': 'warn',
    'no-shadow': 'off',
    'no-restricted-globals': ['error', 'event'],
    // Best practices
    'block-scoped-var': 'warn',
    'no-case-declarations': 'warn',
    'no-else-return': 'warn',
    'no-empty': 'off',
    'no-empty-pattern': 'warn',
    'no-extra-bind': 'error',
    'no-extra-label': 'error',
    'no-fallthrough': 'off',
    'no-iterator': 'error',
    'no-lone-blocks': 'warn',
    'no-multi-spaces': 'error',
    'no-multi-str': 'error',
    'no-proto': 'error',
    'no-self-compare': 'warn',
    'no-unmodified-loop-condition': 'warn',
    'no-useless-call': 'error',
    'no-useless-concat': 'error',
    // Variables
    'no-label-var': 'error',
    'no-undef': 'error',
    'no-unused-vars': ['error', {args: 'none'}],
    // Stylistic issues
    'array-bracket-spacing': 'error',
    'block-spacing': 'error',
    // XXX yuval vadiml: last element ',' for objs and arrays.
    // 'comma-dangle': ['error', 'always-multiline'],
    'comma-spacing': 'error',
    'eol-last': 'error',
    'key-spacing': 'error',
    'keyword-spacing': ['error', {
        overrides: {'catch': {after: false}, 'this': {before: false}},
    }],
    'linebreak-style': 'error',
    'max-len': ['error', 79, 8, {
        ignoreUrls: true,
        ignorePattern: '/.+/',
    }],
    'no-mixed-spaces-and-tabs': 'off',
    'no-multiple-empty-lines': ['error', {max: 2}],
    'no-spaced-func': 'error',
    'no-trailing-spaces': 'error',
    'space-before-blocks': ['error', {functions: 'never',
        keywords: 'never', classes: 'always'}],
    'no-whitespace-before-property': 'error',
    quotes: ['error', 'single', {
        avoidEscape: true,
        allowTemplateLiterals: true,
    }],
    semi: ['error', 'always'],
    'space-before-function-paren': ['error', 'never'],
    'space-in-parens': 'error',
    'spaced-comment': ['error', 'always', {
        markers: ['eslint-env', 'global'],
    }],
    'object-curly-spacing': 'warn',
    // ECMAScript 6
    'generator-star-spacing': ['error', {before: false, after: false}],
    'require-yield': 'off',
    'arrow-parens': ['warn', 'as-needed'],
    'no-template-curly-in-string': 'warn',
    // React
     'react/prop-types': 'off'
  },
};
