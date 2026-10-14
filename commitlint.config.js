/** 精确匹配 pnpm version 自动生成的纯语义版本提交。 */
const VERSION_COMMIT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => VERSION_COMMIT.test(message.trim())],
  rules: {
    'subject-has-chinese': [2, 'always'],
  },
  plugins: [
    {
      rules: {
        // 英文 type/scope 与代码标识符可保留，但主题必须包含中文说明。
        'subject-has-chinese': ({ subject }) => [
          typeof subject === 'string' && /\p{Script=Han}/u.test(subject),
          '提交主题必须包含中文说明',
        ],
      },
    },
  ],
};
