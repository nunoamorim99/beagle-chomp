---
description: Start building an idea from the Idea-Ledger — opens it, plans, waits for go-ahead.
argument-hint: IDEA-xxx
---

Run the `idea-ledger` skill's **build** operation for `$ARGUMENTS`.

1. Open `$ARGUMENTS` in `Idea-Ledger/Backlog.md` and confirm it exists. Run an awareness check in
   case the work overlaps something already delivered.
2. **Dependency gate:** if the idea lists any `[[IDEA-00Y]]` dependency that is not yet in Delivered,
   stop and warn the user — name it and ask whether to proceed anyway or build the dependency first.
3. **Move** the entry from `Backlog` → `In progress 🔨` (physically move it; don't just swap the
   emoji).
4. Propose a **short plan** and **wait for the user's go-ahead**. Do NOT start writing code before
   that confirmation — confirm before any big push.
5. If git execution is enabled for this project, offer to create the feature branch
   (default `feat/$ARGUMENTS-short-slug`, or the project's own convention).
6. After building, leave changes **unstaged** and ask the user to test — that diff is their review
   moment. Staging, commit, merge, and branch deletion happen only on explicit confirmation
   (merge and delete-branch **always** need a yes).

Record to `/ship` once the user confirms the work is good.
