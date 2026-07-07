---
description: Plan a new product version in the Idea-Ledger by bundling chosen ideas into a release.
argument-hint: <ideas to include, or describe the version>
---

Run the `idea-ledger` skill's **plan-version** operation.

1. From `$ARGUMENTS` (and by reading the backlog), identify the IDEAs to bundle into the next
   version. If anything is ambiguous, confirm the list with the user.
2. Decide the number: **Major** (e.g. v2.0) for a group of new features; **Minor** (e.g. v2.1)
   for an increment to an existing feature.
3. Write a `📌 Planned` entry in `VersionControl.md` as a checklist of the chosen IDEAs (planned
   template). Flag any dependency that would force build order.
4. Explain the path: build each item (`/buildi`), they collect in `🚧 Unreleased` as they ship
   (`/ship`), and when the checklist is complete the plan is cut into a numbered release with an
   absolute date — clearing the matching Unreleased lines.

This is forward-looking: Planned = "intend to ship these"; Unreleased = "already shipped, not yet
bundled into a numbered release."
