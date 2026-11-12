#!/usr/bin/env bash
# Deploys the board to GitHub Pages: source on main, built dist/ (with main's HEAD sha) on gh-pages.
# Recordings in ../published-media/ are served next to the board at <pages url>/media/<file>.
# First run creates the public repo and turns Pages on. Usage (from board/): bash scripts/deploy.sh
set -euo pipefail
REPO="Wojciech12131/mega-dev-s03e04"
cd "$(dirname "$0")/.."
GIT_ID=(-c user.name="Wojciech12131" -c user.email="Wojciech12131@users.noreply.github.com")

if [ -n "$(git status --porcelain)" ]; then echo "uncommitted changes — commit first"; git status --short; exit 1; fi

if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public --description "MEGA.dev S03E04 - show me when: sched-prod incident board"
fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
git push -u origin main

SHA=$(git rev-parse HEAD)
node scripts/build.mjs
if [ -d ../published-media ]; then mkdir -p dist/media && cp ../published-media/* dist/media/; fi
(
  cd dist
  rm -rf .git
  git init -q -b gh-pages
  git add -A
  git "${GIT_ID[@]}" commit -q -m "Deploy $SHA"
  git push -q -f "https://github.com/$REPO.git" gh-pages
  rm -rf .git
)

if ! gh api "repos/$REPO/pages" >/dev/null 2>&1; then
  gh api "repos/$REPO/pages" -X POST -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null
fi
echo "deployed $SHA -> https://wojciech12131.github.io/mega-dev-s03e04/"
