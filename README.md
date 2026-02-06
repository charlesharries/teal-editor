# pds-editor

CLI tools for managing `fm.teal.alpha.feed.play` records on your AT Protocol PDS, particularly if you're affected by [this issue](https://github.com/teal-fm/piper/issues/56) on Piper with Apple Music.

## Setup

Requires Node.js.

```bash
npm install
```

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

You'll need:

- **BLUESKY_HANDLE** — your Bluesky handle (e.g. `alice.bsky.social`)
- **BLUESKY_APP_PASSWORD** — an app password ([generate one here](https://bsky.app/settings/app-passwords); never use your main password)
- **PDS_URL** — optional, defaults to `https://bsky.social`

## Usage

### Delete records by time range

Delete all records whose TID falls within a given time range.

Always preview first with `--dry-run`:

```bash
npm start -- --start=2024-03-01T00:00:00Z --end=2024-03-15T23:59:59Z --dry-run
```

Then delete for real:

```bash
npm start -- --start=2024-03-01T00:00:00Z --end=2024-03-15T23:59:59Z
```

You'll see a preview of matching records and be prompted for confirmation before anything is deleted.

### Analyze for bulk-scrobble patterns

Read-only scan of the full collection to find clusters of consecutive records with suspiciously small gaps (e.g. bulk uploads).

The idea being that if there are more than 10 records all bunched up together with less than 45-ish seconds between them, then this is probably a case of accidentally repeated scrobbles rather than legitimate listens.

```bash
npm run analyze
```

Custom thresholds:

```bash
# Blocks of >20 records with gaps <=30s
npm run analyze -- --gap=30 --min-block=20
```

Defaults: blocks of >10 records with gaps of 45 seconds or less.

## Rate limits

Deletions are rate-limited to stay under the PDS limit of 5,000/hour (uses a 4,500/hour buffer). For large collections, expect deletions to take a while. The tool handles retries and HTTP 429 responses automatically.

Deletions are idempotent, so it's safe to re-run if interrupted.
