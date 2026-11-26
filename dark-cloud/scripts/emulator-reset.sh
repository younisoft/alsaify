#!/usr/bin/env bash
# Wipes ONLY the local emulators (never a real project) and re-creates the GM invitation for testing.
set -euo pipefail
curl -s -X DELETE "http://127.0.0.1:8085/emulator/v1/projects/demo-darkcloud/databases/(default)/documents" >/dev/null
curl -s -X DELETE "http://127.0.0.1:9099/emulator/v1/projects/demo-darkcloud/accounts" >/dev/null
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 node "$(dirname "$0")/bootstrap-owner.mjs" --project demo-darkcloud --email gm@example.test --name "المهندس توهيب السيفي"
