---
description: Audit the Idea-Ledger for inconsistencies (duplicate IDs, dangling links, drift). Reports; fixes only on request.
argument-hint: (none)
---

Run the `idea-ledger` skill's **ledger-check** operation. Read both files (and `Delivered.md` if it
exists) and **report** problems — don't fix anything unless the user asks.

Check for:
- Duplicate `IDEA-` ids.
- A `[[IDEA-xxx]]` cross-link that points to no existing entry.
- The same id appearing in more than one section.
- A line in `🚧 Unreleased` with no matching Delivered entry.
- `Next free ID` lower than the highest id actually present (the counter drifted).
- A delivered idea missing its `History` / `vN` lines.
- Dates that aren't absolute `YYYY-MM-DD`.

List each finding with the id and section involved. End by offering to fix them, and only edit if the
user confirms.
