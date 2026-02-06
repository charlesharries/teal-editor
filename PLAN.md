# Plan: Teal Editor — Manage fm.teal.alpha.feed.play Records

## Overview
TypeScript CLI tools for managing `fm.teal.alpha.feed.play` records on your AT Protocol PDS. Two entry points: one for deleting records by time range, and one for analyzing the collection to detect suspicious bulk-scrobble patterns.

## File Structure
```
teal-editor/
├── package.json
├── tsconfig.json
├── .env              # Credentials (gitignored)
├── .env.example
└── src/
    ├── index.ts      # CLI entry point: delete by time range
    ├── analyze.ts    # CLI entry point: detect rapid-scrobble blocks
    ├── tid.ts        # TID → timestamp decoding
    ├── records.ts    # List and filter records (paginated)
    └── deleter.ts    # Delete with rate limiting and retries
```

## Shared Infrastructure

### TID Parsing (`src/tid.ts`)
TIDs encode microsecond timestamps in base32-sortable format. Decode the first 11 characters to get creation time. Provides `tidToDate()`, `tidInRange()`, and `formatTid()`.

### Record Listing (`src/records.ts`)
- `listAllRecords()` — async generator over `com.atproto.repo.listRecords`, paginated at 100/page
- `getRecordsInRange()` — collects records within a start/end time range
- `countRecords()` — counts total records in the collection

### Deletion (`src/deleter.ts`)
- `deleteRecords()` — deletes a list of records with progress reporting
- Rate limiting: stays under 4,500 deletions/hour (5,000 limit with buffer)
- Retries with exponential backoff; handles HTTP 429 via `ratelimit-reset` header
- Idempotent: treats already-deleted records as success

## CLI Tools

### Delete by Time Range (`npm start`)
Deletes all records whose TID falls within a given time range.

```bash
# Preview (always run first)
npm start -- --start=2024-03-01T00:00:00Z --end=2024-03-15T23:59:59Z --dry-run

# Delete for real
npm start -- --start=2024-03-01T00:00:00Z --end=2024-03-15T23:59:59Z
```

- Parses `--start`, `--end`, `--dry-run` flags
- Shows a preview of matching records before prompting for confirmation
- Displays progress during deletion

### Analyze Rapid-Scrobble Blocks (`npm run analyze`)
Read-only scan of the full collection to find clusters of consecutive records with suspiciously small gaps (e.g. bulk uploads).

```bash
# Default: blocks of >10 records with gaps ≤45s
npm run analyze

# Custom thresholds
npm run analyze -- --gap=30 --min-block=20
```

- Fetches all records and sorts by TID timestamp
- Walks sequentially, grouping consecutive records where the gap is within the threshold
- Reports each suspicious block: time range, record count, average gap, sample rkeys

## Dependencies
- `@atproto/api` — AT Protocol SDK
- `dotenv` — environment variables
- `tsx` — run TypeScript directly

## Notes
- App password required (generate in Bluesky settings, never use main password)
- Deletions are idempotent (safe to re-run if interrupted)
- For thousands of records, expect ~4,500/hour max due to rate limits
