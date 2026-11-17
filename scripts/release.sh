#!/usr/bin/env bash
# Propose a semantic version and push an annotated release tag.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean; commit or stash changes first" >&2
  git status --short
  exit 1
fi

branch="$(git branch --show-current)"
if [[ "$branch" != main ]]; then
  echo "error: release from main (current branch: ${branch:-detached HEAD})" >&2
  exit 1
fi

# Refresh both the version proposal and the branch we are about to release.
git fetch --quiet --tags origin
commit="$(git rev-parse HEAD)"
if [[ "$commit" != "$(git rev-parse refs/remotes/origin/main)" ]]; then
  echo "error: main must match origin/main; synchronize and push it first" >&2
  exit 1
fi

semver='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
latest=""
while IFS= read -r tag; do
  if [[ "$tag" =~ $semver ]]; then
    latest="$tag"
    break
  fi
done < <(git tag --list 'v*' --sort=-version:refname)

if [[ -z "$latest" ]]; then
  proposed="v0.1.0"
  echo "No existing version tags found."
else
  IFS=. read -r major minor patch <<<"${latest#v}"
  proposed="v${major}.${minor}.$((patch + 1))"
  echo "Latest tag: $latest"
fi

echo "Proposed next tag: $proposed"
printf 'Version to release [%s]: ' "$proposed"
IFS= read -r input
version="${input:-$proposed}"
[[ "$version" == v* ]] || version="v${version}"

if [[ ! "$version" =~ $semver ]]; then
  echo "error: version must look like v1.2.3 (got $version)" >&2
  exit 1
fi
if git show-ref --verify --quiet "refs/tags/$version"; then
  echo "error: tag $version already exists" >&2
  exit 1
fi

printf '\nTag: %s\nBranch: %s\nCommit: %s\nRemote: origin\n' "$version" "$branch" "$commit"
printf 'Proceed? [y/N] '
IFS= read -r confirm
case "$confirm" in
  y|Y|yes|YES) ;;
  *) echo "Aborted."; exit 1 ;;
esac

# Keep the reviewed commit pinned even if HEAD moves during the prompts.
git tag -a "$version" "$commit" -m "Release $version"
if ! git push origin "refs/tags/$version"; then
  printf 'Tag %s exists locally. After fixing the push, retry: git push origin refs/tags/%s\n' "$version" "$version" >&2
  exit 1
fi
printf '\nTagged and pushed %s. The Release workflow will publish the archives on GitHub.\n' "$version"
