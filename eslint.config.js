import globals from 'globals';

export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      strict: ['error', 'never'],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ThrowStatement',
          message: 'Do not throw; return Left(error) or Right(value) instead. See AGENTS.md.',
        },
      ],
    },
  },
];
