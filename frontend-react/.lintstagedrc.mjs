// lint-staged 多配置：frontend-react/ 下的暂存文件归本配置管，
// 任务以本目录为 cwd 执行，npx 解析到本工程的 node_modules/.bin
export default {
  '*.{ts,tsx}': ['npx eslint --fix', 'npx prettier --write'],
  '*.{js,mjs,cjs}': ['npx prettier --write'],
  '*.{json,md,css,yml,yaml,html}': ['npx prettier --write'],
};
