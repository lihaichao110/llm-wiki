# Git GUI 通常不会加载 shell 配置；hook 需要自行启用项目指定的 Node 版本。
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo '提交校验需要 nvm。请先安装 nvm 并运行 nvm use。' >&2
  exit 1
fi
# nvm.sh 在没有默认版本时可能返回非零；以显式的 nvm use 结果为准。
set +e
. "$NVM_DIR/nvm.sh"
set -e
if ! command -v nvm >/dev/null 2>&1; then
  echo '无法加载 nvm，请检查 NVM_DIR。' >&2
  exit 1
fi
nvm use --silent
