# DB Lifecycle

This document describes the operational model for multiple SQLite databases in one ICPDB canister.

## Identity Model

The database unit is `database_id`.

Principals are attached through `database_members`:

- `owner`: all operations, including grant, revoke, delete, archive, restore, quota, and billing reads
- `writer`: SQL reads and SQL writes
- `reader`: SQL reads

One database can have multiple principals. One principal can belong to multiple databases.
Grant anonymous reader access with principal `2vxsx-fae` only when public SQL reads are intended.

## Memory Layout

Stable-memory mount IDs are partitioned by purpose:

- `0..9`: WASI filesystem memory for tmp files and directory metadata
- `10`: index DB
- `11..=32767`: user DB slots
- `32768..=65534`: reserved

The index DB tracks database metadata, membership, quota, billing, tokens, payments, and usage events.
Each user DB is a raw SQLite file owned by one mount slot.

Hot, archiving, or restoring DBs consume one active user DB slot. Archived and deleted DBs release their active mount, but v1 does not recycle stable-memory mount IDs for another database.

## Status

Databases move through five statuses:

- `hot`: mounted and usable for SQL read/write according to role and billing state
- `archiving`: mounted for chunk export; SQL operations rejected until finalize or cancel succeeds
- `archived`: not mounted, active mount released, snapshot metadata retained
- `deleted`: not mounted, active mount released, not restorable unless an external archive was taken first
- `restoring`: mounted for chunk import; SQL operations rejected until finalize succeeds

Only `hot` DBs are available to normal SQL APIs.

## Size Tracking

`logical_size_bytes` tracks the SQLite file size for a database.

It is updated after SQL writes and restore finalization. It is useful for visibility and quota checks, but it is not a stable-memory shrink metric.

Deleting or archiving a DB releases the active mount. It does not imply that canister stable memory shrinks or that the stable-memory mount ID is reused.

## Usage Ledger

`usage_events` records update calls and charged SQL query calls.

Each event stores method, database ID when present, caller principal, success flag, observed cycle delta, error text, and timestamp.
The cycle delta is an operational observation from canister balance before and after the call, not a guaranteed one-to-one IC billing statement.
Only the latest 100,000 events are retained.

## Delete

`delete_database` is owner-only.

Delete is a soft delete in the index:

- status becomes `deleted`
- active mount ID is cleared
- logical size is set to `0`
- the stable-memory mount ID is not reused by another DB in v1

Delete is treated as irreversible. If recovery is required, archive first and store the exported bytes outside the canister.

## Archive

Archive is a low-level snapshot byte export flow:

1. `begin_database_archive(database_id)` moves the DB to `archiving`, updates `updated_at_ms`, and returns the current DB file size.
2. `read_database_archive_chunk(database_id, offset, max_bytes)` exports file bytes by range.
3. Caller stores the bytes outside the canister.
4. `finalize_database_archive(database_id, snapshot_hash)` verifies the SHA-256 digest, marks the DB archived, and releases the active mount.

The canister does not persist archive bytes. The caller owns external storage and retry behavior.

`snapshot_hash` must be the 32-byte SHA-256 digest of the exported SQLite bytes.
If hash verification fails, the DB stays `archiving`; the caller can reread bytes and retry finalize or call `cancel_database_archive(database_id)` to return the DB to `hot`.
`cancel_database_archive` is owner-only and only valid while the DB is `archiving`.
Archive reads reject chunks larger than 1 MiB.
Finalize computes the digest by reading the whole SQLite file in one update. Large DBs can increase instruction and cycle cost.

## Restore

Restore is a low-level snapshot byte import flow:

1. `begin_database_restore(database_id, snapshot_hash, size_bytes)` moves an archived or deleted DB to `restoring` and allocates a new slot.
2. `write_database_restore_chunk(database_id, offset, bytes)` writes imported bytes.
3. `finalize_database_restore(database_id)` checks file size and SHA-256 digest, verifies the SQLite file opens, and returns the DB to `hot`.

Restore can only begin from `archived` or `deleted`. It cannot begin from `hot` or while already `restoring`.
If the canister cannot mount the newly allocated DB file during begin, the DB rolls back to its previous `archived` or `deleted` state. The failed mount ID remains in mount history and is not reused.

If finalize fails because the file size is wrong, the DB stays `restoring`. The caller can write missing bytes and retry finalize.
Restore rejects chunks larger than 1 MiB and declared DB sizes larger than `i64::MAX`.
Restore finalize also hashes the whole restored SQLite file in one update.

## Current Limits

- At most 32757 lifetime user DB slots per canister: mount IDs `11..=32767`.
- Archive export and restore import chunks are limited to 1 MiB.
- Declared restore DB size must fit the runtime database size limit, currently `i64::MAX`.
- v1 does not treat archived or deleted slots as reusable concurrent capacity.
