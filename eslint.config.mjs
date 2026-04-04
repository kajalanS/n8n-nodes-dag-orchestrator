import js from '@eslint/js';
import ts from 'typescript-eslint';

export default [
    {
        ignores: ['dist', 'node_modules', 'jest.config.js', 'scripts/**/*.js'],
    },
    js.configs.recommended,
    ...ts.configs.recommended,
    {
        files: ['**/*.ts'],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: 'module',
            parser: ts.parser,
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/explicit-function-return-types': 'off',
            'no-useless-assignment': 'off',
            'prefer-const': 'warn',
        },
    },
];
