# AGENTS.md

## Commits — atomic

- One logical change per commit. One reason to revert.
- Each commit builds + passes tests. No WIP, no fixup in history.
- Split unrelated changes. Never mix feature + fix + refactor.
- Small diff. Reviewable in minutes.
- Rebase/squash WIPs before merge. Rewrite message on squash.

## Commit messages — Mitchell Hashimoto style

Format:

```
area: imperative lowercase summary

Body explaining what changed and why.
```

Rules:

- `area:` = component/path affected. Lowercase. Examples: `collector`, `collector/window`, `influx`, `grafana`, `compose`, `docs`, `discovery`.
- Multiple areas: `gtk,opengl:` or `collector,influx:`. Subpath with slash: `collector/config:`.
- No conventional-commit types as prefix. No `feat:`, `fix:`, `chore:`, `init:`. Area, not type.
- After colon: single space, lowercase imperative verb. `add`, `fix`, `remove`, `update`, `refactor`, `bump`.
- Subject <= 72 chars. No trailing period. No past tense. No `-ing`.
- Blank line between subject and body.
- Body: full sentences. Explain before/after, why, consequences. Wrap ~72 cols.
- No bare URLs or `Fixes #123` in subject. Put refs in body footer.

Good:

```
collector: add bucket-aligned window math

Buckets anchor at `from`. Unaligned `from` shifts timestamps,
causes duplicates on re-fetch. Floor from/to to bucket grid
so re-fetch is byte-identical.

collector/proemion: cache oauth token in memory

Token lives 3600s. Refresh 60s early to avoid 401 mid-poll.

compose: pin influxdb3-core image version

`latest` flips upstream. Pin for reproducible bootstrap.

grafana: add fleet overview dashboard with machine variable
```

Bad:

```
Add stuff. — vague, no area, capitalized, period.
collector: added window math — past tense.
collector: adding window math — -ing verb.
feat: add window math — type, not area.
collector: Add Window Math — capitalized words.
collector: fix memory leak Fixes #123 — ref belongs in body.
chore: rewrite plan — type, not area.
init: plan — type, not area.
```

Workflow:

- `git status`, `git diff` before commit. Stage only intended files.
- Never commit `.env` or secrets. Check `.gitignore`.
- Verify each commit: build/typecheck/test relevant to area.
