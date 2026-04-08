# Repo AGENTS for CodexNamer

These rules supplement the global AGENTS bootstrap.

## VCS source of truth

- This repository is JJ-first because it contains `.jj/`.
- Use `jj` for routine local VCS work: status, diff, log, commit, rebase, workspace, bookmark, fetch, and push.
- Treat Git as the transport and interoperability layer for GitHub, CI, and Git-only tools.
- Avoid routine `git commit`, `git checkout`, `git switch`, `git branch`, `git rebase`, or `git push origin HEAD:main` unless the user explicitly asks for Git.

## Always inspect state first

Before mutating repo history or bookmarks, run:

```bash
jj st
jj workspace list
jj bookmark list
```

Also run `jj st` again after mutations.

## Default steady state

Keep the repository in this shape whenever possible:

- one long-lived bookmark: `main`
- one primary workspace: `default`
- current working-copy change `@` is an empty `next`

Do not leave behind extra workspaces, empty anonymous changes, or stale bookmarks unless the user explicitly wants them preserved.

## Workspace policy

If the current workspace has unrelated changes, belongs to another task, or the work may proceed in parallel, create a sibling JJ workspace instead of mixing changes into `default`:

```bash
jj workspace add ../codexnamer-<task> --name <task> -r main -m "<task>"
```

When the task is done and merged, clean up the temporary workspace:

```bash
jj workspace forget <task>
rm -rf ../codexnamer-<task>
```

## Commit policy

- Prefer small, reviewable logical changes.
- Name the current change before doing substantial work with `jj describe -m "..."`
- Finalize with `jj commit -m "..."`
- Immediately rename the new empty working copy to `next`:

```bash
jj describe -m "next"
```

Avoid leaving `(no description set)`, `wip`, or mixed multi-purpose commits.

## Bookmark and remote policy

- `main` is the only long-lived bookmark.
- Non-`main` bookmarks are temporary and should exist only for PRs, shared review, or temporary CI/debug branches.
- Remember that pushed bookmarks appear on GitHub as branches.

### Direct-to-main flow

Use this only when the user explicitly wants the work landed on `main` without a separate PR branch:

```bash
jj git fetch --remote origin
jj bookmark move main --to @-
jj git push --remote origin --bookmark main
```

### PR / review flow

Create a temporary bookmark only when the work needs a remote branch:

```bash
jj bookmark create <name> -r @-
jj git push --remote origin --bookmark <name>
```

After the PR merges, clean it up:

```bash
jj git fetch --remote origin
jj bookmark delete <name>
jj git push --remote origin --deleted
jj git export
```

## Validation before push

Before pushing `main` or any review bookmark, run the full CI-equivalent validation:

```bash
npm run lint
npm run build
npm run build:runtime
npm run web:build
npm test
```

Do not push if this sequence fails.

## Cleanup expectations

At the end of a task, verify:

```bash
jj st
jj workspace list
jj bookmark list
```

The expected end state is:

- no unintended file changes
- no stale temporary workspaces
- no stale remote-tracking bookmarks waiting to be deleted
- `@` renamed to `next`
