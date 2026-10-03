#!/usr/bin/env bash
# Fail if the vendored upstream trees drift from their import commits. The engine/ tree in particular
# is hosted unmodified by services/engine-demo and MUST stay byte-identical to its import (R0-10).
# Import SHAs are recorded in UPSTREAM.md. Any intended platform/ edit is tracked there; engine/ edits
# are not permitted.
set -euo pipefail

ENGINE_IMPORT_SHA="${ENGINE_IMPORT_SHA:-4162146}"

fail=0
if ! git cat-file -e "${ENGINE_IMPORT_SHA}^{commit}" 2>/dev/null; then
  echo "drift-check: cannot resolve engine import commit ${ENGINE_IMPORT_SHA}; fetch full history" >&2
  exit 2
fi

changed="$(git diff --name-only "${ENGINE_IMPORT_SHA}" HEAD -- engine/ || true)"
if [ -n "${changed}" ]; then
  echo "drift-check: engine/ has drifted from import ${ENGINE_IMPORT_SHA}; it must stay byte-identical:" >&2
  echo "${changed}" >&2
  fail=1
else
  echo "drift-check: engine/ is byte-identical to import ${ENGINE_IMPORT_SHA}. OK"
fi

exit "${fail}"
