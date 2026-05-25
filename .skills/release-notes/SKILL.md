---
name: release-notes
description: Generate release notes by finding the last release tag, reviewing every commit and diff after that tag, and turning the changes into a concise user-facing changelog.
---

# Release Notes

Use this skill when asked to draft release notes, changelog text, GitHub Release notes, npm release notes, or "what changed since the last release" for this repository.

## Goal

Generate accurate release notes from the git history since the previous release. Prefer user-facing impact over commit-by-commit narration.

## Workflow

1. Work from the repository root and check state first:

   ```bash
   git status --short
   git branch --show-current
   git tag --sort=-creatordate | head -20
   ```

2. Refresh tags if the environment allows network access and the user did not ask for offline-only work:

   ```bash
   git fetch --tags --prune
   ```

3. Choose the comparison base:

   - If the user provided a tag, commit, or range, use that exactly.
   - Otherwise use the newest reachable release tag matching `v*`:

     ```bash
     BASE_TAG="$(git describe --tags --match 'v[0-9]*' --abbrev=0)"
     ```

   - If `HEAD` itself is tagged and the user wants notes for that tagged release, compare against the previous release tag:

     ```bash
     CURRENT_TAG="$(git describe --tags --exact-match HEAD 2>/dev/null || true)"
     PREVIOUS_TAG="$(git describe --tags --match 'v[0-9]*' --abbrev=0 HEAD^)"
     BASE_TAG="$PREVIOUS_TAG"
     ```

4. Gather the evidence before writing:

   ```bash
   git log --reverse --date=short --pretty=format:'%h%x09%ad%x09%s' "$BASE_TAG..HEAD"
   git diff --stat "$BASE_TAG..HEAD"
   git diff --name-status "$BASE_TAG..HEAD"
   git diff "$BASE_TAG..HEAD" -- package.json package-lock.json README.md docs src rust scripts .github
   ```

5. Inspect public API and behavior carefully. For this repo, prioritize changes in:

   - `src/index.ts`, `src/node-wreq.ts`, `src/client/`, `src/http/`, `src/websocket/`, and `src/types/`
   - `rust/src/transport/`, `rust/src/napi/`, and `rust/src/emulation/`
   - `README.md`, `docs/`, package metadata, build scripts, and GitHub Actions
   - tests that reveal intended behavior, especially under `src/test/`

6. Classify changes into the sections that apply:

   - `Added`
   - `Changed`
   - `Fixed`
   - `Performance`
   - `Docs`
   - `Tests`
   - `Build & CI`
   - `Dependencies`
   - `Breaking Changes`

7. Write release notes in this shape unless the user requests another format:

   ```markdown
   ## <version or "Unreleased">

   Compared with `<base tag>`.

   ### Added
   - ...

   ### Fixed
   - ...

   ### Build & CI
   - ...
   ```

## Writing Rules

- Do not invent impact from commit messages alone. Verify with diffs when a commit is ambiguous.
- Omit empty sections.
- Put breaking changes near the top and call out migration steps when visible from the diff.
- Merge dependency-only Dependabot commits into one short bullet unless they materially affect runtime behavior.
- Mention internal-only test, lint, formatting, and CI work only under `Tests` or `Build & CI`.
- Keep bullets concrete and scoped: name the API, feature, platform, or workflow affected.
- Include the compared range and base tag in the final answer.
- If the range is empty, say no changes were found after the selected release tag.
- If tags are missing or ambiguous, stop and ask for the intended base release instead of guessing.
