# The DockWash crew handbook

*Dale, project guide:* “Get the crew together. We have boats to wash and a schedule to keep.”

DockWash is the Uber-but-for-boats project: marina managers find cleaners, schedule washes, and move work as plans change. Cleaners choose their availability and accept jobs. We use a light Step Brothers cast flavor in engineering docs and commit messages. Dialogue here is original project copy, not verified movie quotations.

## Every commit gets a version

*Derek, release desk:* “Every delivery goes in the ledger.”

Run `npm ci` after cloning. Its prepare script installs the tracked `.githooks` hooks for this checkout. If dependencies are already installed, run `npm run prepare`. This requires Git configuration access. An existing custom hooks directory is preserved: the installer refuses to replace it, so integrate the commit hook explicitly if you use one.

| Commit message | Version change |
| --- | --- |
| `feat: ...` or `feat(scope): ...` | Minor: `0.1.0` → `0.2.0` |
| `feat!: ...`, `fix(scope)!: ...`, or a `BREAKING CHANGE:` footer | Major: `0.2.0` → `1.0.0` |
| `fix`, `docs`, `test`, `chore`, or any other message | Patch: `0.2.0` → `0.2.1` |

After a new local commit, the post-commit hook immediately finalizes that commit with an automatic amendment, with hooks disabled to avoid recursion. The finalized commit updates `package.json`, both root version fields in `package-lock.json`, and `CHANGELOG.md` in the same commit. It appends a short cast-flavored line to the subject while preserving its technical description, body, and trailers. It refuses to overwrite unstaged edits to versioned files; stage those edits first. Versions come from the committed parent, so retrying a failed commit does not bump twice. Amending an unpublished commit recalculates its version from its parent; avoid amendments to published commits. Git may print the intermediate hash; `git log -1` shows the finalized hash. If finalization fails, the original commit remains and CI rejects it until fixed. Use ordinary staged commits, not `git commit --only`: finalization refuses to include unrelated staged files. No automatic npm publishing or Git tags occur.

```sh
npm run test:all
git add path/to/changed/files
git commit -m "feat(schedule): add recurring boat washes"
```

Resulting subject:

```text
feat(schedule): add recurring boat washes [Dale: More room for dockside activities.]
```

A version identifies each commit on its branch. Independent branches may select the same next version; resolve version/changelog conflicts before merging. GitHub squash commits and web edits bypass local hooks, so their version/message must be supplied explicitly. The CI version-history check rejects noncompliant commits after the original import. Use the local commit workflow to keep the same policy throughout history. Branch protection must be enabled in GitHub if you want passing checks to be mandatory.

## Cast and documentation

*Nancy, crew coordinator:* “The joke is a garnish. Everyone still needs to understand the plan.”

- Dale introduces product journeys and the README.
- Brennan introduces sharing, onboarding, and how-to documentation.
- Robert handles testing, evidence, and operational explanations.
- Derek handles versions, changelog entries, and release notes.
- Nancy explains coordination and contributor expectations.

Use a short original character-style opener or aside, followed by precise plain-English instructions. Keep commands, APIs, error descriptions, and acceptance criteria factual. Keep movie humor in engineering documentation and commit messages; product UI remains written for marina managers and cleaners. Do not treat the quotes collection as verified attribution.

## New-feature journey

*Robert, test lead:* “Show me that both people can finish the job.”

1. State the manager or cleaner outcome and the important failure case.
2. Implement the feature and update the relevant documentation.
3. Add focused rule tests and browser coverage when the UI changes.
4. Run `npm run test:all`; inspect the browser report if a journey fails.
5. Stage the work and commit with a clear Conventional Commit subject. The hook supplies versioning and cast flavor.

See [Testing DockWash](docs/testing.md) for isolated browser tests, failure traces, and the manual Google-login release check.
