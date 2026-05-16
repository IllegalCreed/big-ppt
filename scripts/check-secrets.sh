#!/usr/bin/env bash
# Pre-commit secret scan: 拦截已知 throwaway test key + 通用 API key 模式入 git。
#
# 用法（一次性设置 hook）：
#   chmod +x scripts/check-secrets.sh
#   ln -sf ../../scripts/check-secrets.sh .git/hooks/pre-commit
#
# 跑测要用 key 时走环境变量，不要写进源码：
#   GLM_TEST_KEY=... OPENAI_IMAGE_TEST_KEY=... pnpm -F @big-ppt/e2e test
#
# 已知 throwaway key 前缀（memory `reference_test-api-keys.md`）+ 通用 sk-/api_key= 模式。
# 命中即 exit 1 阻止 commit；可临时绕过：git commit --no-verify。

set -e

# 1. 已知 throwaway test key 前缀（用户授权 throwaway，但绝不进 git）
KNOWN_PREFIXES='sk-UKU8|sk-vwuR|sk-DWtP|95f7bea3b8f149319df2266f95c0df0b'

# 2. 通用 LLM API key 模式（sk- 后跟 ≥20 字符 alphanumeric）+ 显式 api_key= 赋值
# 用 grep -E perl-style: 排除测试 placeholder（sk-fake / sk-test / sk-stub）
GENERIC_PATTERN='(sk-[A-Za-z0-9_-]{30,})|(api[_-]?key[[:space:]]*[:=][[:space:]]*["'\'']?[A-Za-z0-9_-]{30,})'

# 仅扫 staged diff 的 +added 行（避免误报已有 historical 文件）
# 跳过 scan 自身（含 detection patterns 字面量,自我引用是误报）
DIFF=$(git diff --cached --diff-filter=AM -- ':(exclude)scripts/check-secrets.sh')

if [ -z "$DIFF" ]; then
  exit 0
fi

# 已知前缀 hard 拦
KNOWN_HITS=$(echo "$DIFF" | grep -nE "^\+.*($KNOWN_PREFIXES)" || true)
if [ -n "$KNOWN_HITS" ]; then
  echo "❌ pre-commit: 检测到已知 throwaway test key 入 staging:"
  echo "$KNOWN_HITS"
  echo ""
  echo "解决:从 staged 文件移除该值,改用 env var (GLM_TEST_KEY / OPENAI_IMAGE_TEST_KEY)"
  echo "临时绕过(不推荐):git commit --no-verify"
  exit 1
fi

# 通用模式 soft 警告（排除明显 test placeholder）
GENERIC_HITS=$(echo "$DIFF" | grep -nE "^\+" | grep -E "$GENERIC_PATTERN" | grep -viE "sk-(fake|test|stub|placeholder|example|xxx)|api[_-]?key[[:space:]]*[:=][[:space:]]*[\"']?(test|fake|stub|your[_-]?key|xxx)" || true)
if [ -n "$GENERIC_HITS" ]; then
  echo "⚠️  pre-commit: 检测到可能的 API key 模式:"
  echo "$GENERIC_HITS"
  echo ""
  echo "如果是真 key → 删掉改 env var"
  echo "如果是 placeholder (sk-fake-... / sk-test-...) → 改名让 scanner 识别"
  echo "确认是误报 → git commit --no-verify"
  exit 1
fi

exit 0
