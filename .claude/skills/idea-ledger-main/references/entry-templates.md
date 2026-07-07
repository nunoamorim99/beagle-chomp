# Entry templates

Use these exact shapes so the ledger stays consistent. Resolve dates to absolute `YYYY-MM-DD`.

## Inbox capture (what `/idea` writes — minimal, no ID)
```
- (YYYY-MM-DD) <the user's raw text, verbatim>
```

## Idea (Backlog — open)
```
### IDEA-00X — <short title> 💡
- **Priority:** 🟡
- **Area:** <optional short tag — e.g. auth, maps, billing — for slicing the backlog>
- **Registered:** YYYY-MM-DD
- **Description:** what it is and why — in the human's voice, keep their reasoning and context.
- **Notes:** details, examples, links, decisions already made.
- **Dependencies:** other ideas/features if any — link as [[IDEA-00Y]]
```

## Delivered (keeps Notes + Dependencies; one `vN` line per iteration, oldest first)
```
### IDEA-00X — <title> ✅
- **Description:** ...
- **Notes:** preserved from the idea — details, decisions, context. Keep this on delivery; the
  reasoning behind a shipped feature is worth as much as the history of it.
- **Dependencies:** [[IDEA-00Y]] (preserved as registered, even after both have shipped)
- **History:**
  - **v1** (YYYY-MM-DD) — first version: what was done. _(commit/PR if any)_
  - **v2** (YYYY-MM-DD) — improvement: what changed. _(commit/PR if any)_
```

## Paused / Discarded (the reason is mandatory)
```
### IDEA-00X — <title> ❄️   (or 🗑️ for discarded)
- **Status:** Paused on YYYY-MM-DD   (or: Discarded on YYYY-MM-DD)
- **Reason:** why it was paused/rejected — this is the whole point of keeping it.
- **Description:** ... (preserved as registered)
```

## Release (VersionControl — Version history)
```
### v2.0 — <short release name> (YYYY-MM-DD)
One-line summary of the version's theme.
- **IDEA-0xx** — short description of what landed.
- **IDEA-0yy** — short description of what landed.
```

## Minor release (an increment to an existing feature)
```
### v2.1 — <what improved> (YYYY-MM-DD)
- **IDEA-0zz vN** — short description of the increment.
```

## Planned (VersionControl — Planned section, a checklist)
```
### v2.0 — <working name> [planned]
Intended theme of the release.
- [ ] IDEA-0xx — <title>
- [ ] IDEA-0yy — <title>
```

## Unreleased line (what `/ship` drops)
```
- (YYYY-MM-DD) IDEA-0xx vN — what shipped.
```
