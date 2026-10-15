#!/usr/bin/env bash
# Tests for tools/bootstrap.sh disk gate and check-only mode.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail=0

out="$(MIN_FREE_GB=999999 "$here/bootstrap.sh" --check-only 2>&1)"; code=$?
if [[ $code -ne 3 ]]; then echo "FAIL: expected exit 3 on low disk, got $code"; fail=1; fi
if ! grep -q "need 999999 GB" <<<"$out"; then echo "FAIL: low-disk message missing: $out"; fail=1; fi

out="$(MIN_FREE_GB=0 "$here/bootstrap.sh" --check-only 2>&1)"; code=$?
if [[ $code -ne 0 ]]; then echo "FAIL: expected exit 0 in check-only with enough disk, got $code: $out"; fail=1; fi
if ! grep -q "check-only: no installs" <<<"$out"; then echo "FAIL: check-only did not announce itself"; fail=1; fi

[[ $fail -eq 0 ]] && echo "PASS" || exit 1
