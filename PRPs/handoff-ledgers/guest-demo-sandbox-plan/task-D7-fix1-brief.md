# Task D7 — fix round 1 (from the Opus review of commit e1bc819)

Original brief: `task-D7-brief.md` (same folder). Spec: `PRPs/guest-demo-sandbox.md` D8. BFF only. The review CONFIRMED: real users cannot be selected (`IsGuest` is the only selector); `AccountTeardown` is a pure move (real account deletion unchanged); the BFF deletes nothing in storage and the worker actor filters `audio/demo/`; guests cannot self-delete. It REQUIRES the following. Files: `components/bff/src/Spectr.Bff/Services/RetentionSweepScheduler.cs` (guest pass ~106-175), `Services/AccountTeardown.cs` (61 lines), `tests/Spectr.Bff.Tests/GuestPurgeTests.cs` (329 lines).

## CRITICAL
C1. **Infinite loop.** The `while` exits only on an empty batch, and a guest whose teardown throws stays selected forever (stable `OrderBy(CreatedAt)`, no cursor) → a tight unbounded loop, a log flood, and `RunOnceAsync` never returns so the PeriodicTimer never ticks again (retention + warning emails dead for the process lifetime). Fix: exclude ids already attempted in THIS run from the next select, AND a hard cap on batches per run (50) that logs and returns, AND stop when a batch produced zero successes.
C2. **Poisoned DbContext.** One `AppDbContext` + `AccountTeardown` per BATCH is shared by up to 200 guests; when a teardown throws mid-way the ChangeTracker keeps the `Added` audit row and the `Deleted` user, and the NEXT guest's `SaveChanges` flushes them under the wrong transaction (duplicate/misattributed audit rows, or a concurrency exception that fails every remaining guest → feeds C1). Fix: a fresh DI scope PER GUEST (select the ids per batch, then resolve `AppDbContext` + `AccountTeardown` from a new scope for each id and reload that user inside it).

## IMPORTANT
I3. **Drop the device-row deletion entirely** (controller ruling). The same `spectr_device` row serves the anonymous `/analyze` funnel (`analysis_jobs.device_id` has no FK), so deleting it strands a visitor's in-flight anon analysis and mints them a new device id. Unclaimed devices are already sweepable elsewhere; the row is tiny. Remove that block and its test; replace the test with one asserting the guest's device row SURVIVES the purge.
I4. **A test reaches the LIVE worker.** `GuestPurgeTests.cs` ~113 (`A_Purged_Guests_Token_Stops_Working_Immediately`) calls `Build()` with no queue, so the real `DramatiqJobQueue` enqueues a real `sweep_retention` and a real `delete_account_data`. Use the recording queue in EVERY test in this file.
I5. **Tests run the real sweep with the real clock over the whole shared dev DB** (purging every expired guest there, sending due warning emails). Give the guest pass a test seam: an internal method taking `now` and an optional `IReadOnlyCollection<Guid> onlyUserIds` filter (production passes null), and have the tests call THAT with the ids they created — never `RunOnceAsync`. Remove the global device cleanup at ~323-324 (it deletes rows the test never created).
I6. **The two missing tests** (both must be written first and seen failing on the current code): (a) a guest whose teardown THROWS (use a seam — e.g. an `IAccountTeardown` interface or a delegate — not a mock of EF) → the NEXT guest in the same run is still purged, exactly one audit row per purged guest, none for the failed one, and the pass RETURNS (assert with a timeout, e.g. 20 s); (b) more guests than one batch — make the batch size injectable for the test (e.g. 2 with 5 guests) → all purged, bounded iterations.

## MINOR
- M1 the catch's log says "left for the next nightly run" — wrong when the teardown already committed and only the enqueue failed: log `LogCritical` "content orphaned; sweep_retention re-enqueues" for that case, as account deletion does.
- M2 WHY comment: the guest pass shares the `Retention:Enabled` kill switch — with it off, expired guests are never purged.
- M4 `Real_Users_Are_Never_Touched_By_The_Guest_Pass` must dispose its factory. M5 count a guest as purged once its teardown committed.
- Keep: NULL `guest_expires_at` = expired.

## Commit
ONE commit: `fix(bff): the guest purge cannot loop, cannot poison its context, never deletes a device row, and its tests never touch the live worker`
