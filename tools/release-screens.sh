#!/bin/bash
# Releases screens/ to PRODUCTION (docs/modules/SCREENS_ON_HOSTING.md):
#   tools/release-screens.sh              write, verify and activate a release
#   tools/release-screens.sh list         releases, newest first (* = active)
#   tools/release-screens.sh rollback ID  make an earlier release active again
#   tools/release-screens.sh compare      does the active release match screens/? (exit 3 if not)
# Every user gets the new screens on their next screen open. The last 10
# releases are kept. Deploy changed functions FIRST, so a screen never goes
# live before the functions it calls. Record releases in docs/DEPLOY_LOG.md.
cd "$(dirname "$0")/.." || exit 1
P=erp1-8f4cd
unset FIRESTORE_EMULATOR_HOST   # this script is for production only

case "$1" in
  list|rollback|compare) exec node tools/screen-release.js "$@" --project $P ;;
  "") ;;
  *) echo "usage: tools/release-screens.sh [list | rollback RELEASE_ID | compare]"; exit 1 ;;
esac

# The release is built from the working copy; it must match a commit.
if [ -n "$(git status --porcelain)" ]; then
  echo "STOP: working copy not clean — commit or 'git stash push -u' first:"; git status --short; exit 1
fi
node tools/screen-release.js release --project $P
