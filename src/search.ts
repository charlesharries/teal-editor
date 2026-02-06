import { AtpAgent } from '@atproto/api';
import { config } from 'dotenv';
import { listAllRecords } from './records.js';

config();

interface CliArgs {
  artistName?: string;
  albumName?: string;
  trackName?: string;
  count: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let artistName: string | undefined;
  let albumName: string | undefined;
  let trackName: string | undefined;
  let count = false;

  for (const arg of args) {
    if (arg.startsWith('--artistName=')) {
      artistName = arg.slice('--artistName='.length);
    } else if (arg.startsWith('--albumName=')) {
      albumName = arg.slice('--albumName='.length);
    } else if (arg.startsWith('--trackName=')) {
      trackName = arg.slice('--trackName='.length);
    } else if (arg === '--count') {
      count = true;
    }
  }

  if (!artistName && !albumName && !trackName) {
    console.error('Error: Provide at least one filter: --artistName=, --albumName=, --trackName=');
    process.exit(1);
  }

  return { artistName, albumName, trackName, count };
}

/**
 * Convert a glob-style pattern to a RegExp.
 * Supports `*` as a wildcard for any sequence of characters.
 * Matching is case-insensitive.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${withWildcards}$`, 'i');
}

function matches(value: string | undefined, pattern: string): boolean {
  if (value == null) return false;
  return globToRegex(pattern).test(value);
}

async function main() {
  const { artistName, albumName, trackName, count } = parseArgs();

  const handle = process.env.BLUESKY_HANDLE;
  const appPassword = process.env.BLUESKY_APP_PASSWORD;
  const pdsUrl = process.env.PDS_URL || 'https://bsky.social';

  if (!handle || !appPassword) {
    console.error('Error: Missing credentials');
    console.error('Create a .env file with BLUESKY_HANDLE and BLUESKY_APP_PASSWORD');
    process.exit(1);
  }

  console.log(`\nSearch fm.teal.alpha.feed.play records`);
  console.log('='.repeat(40));
  console.log(`Handle: ${handle}`);
  console.log(`PDS: ${pdsUrl}`);
  if (artistName) console.log(`Artist: ${artistName}`);
  if (albumName) console.log(`Album: ${albumName}`);
  if (trackName) console.log(`Track: ${trackName}`);
  console.log('');

  console.log('Authenticating...');
  const agent = new AtpAgent({ service: pdsUrl });

  try {
    await agent.login({ identifier: handle, password: appPassword });
  } catch (err: any) {
    console.error(`Authentication failed: ${err.message}`);
    process.exit(1);
  }

  const repo = agent.session!.did;
  console.log(`Authenticated as: ${repo}\n`);

  console.log('Searching...');
  let matched = 0;
  let scanned = 0;

  for await (const record of listAllRecords(agent, repo)) {
    scanned++;

    const v = record.value as any;
    const recordArtist = v?.artists?.[0]?.artistName;
    const recordAlbum = v?.releaseName;
    const recordTrack = v?.trackName;

    if (artistName && !matches(recordArtist, artistName)) continue;
    if (albumName && !matches(recordAlbum, albumName)) continue;
    if (trackName && !matches(recordTrack, trackName)) continue;

    matched++;

    if (!count) {
      const playedAt = v?.playedTime ?? 'unknown';
      console.log(`${recordTrack} — ${recordArtist} — ${recordAlbum} (${playedAt})`);
    }

    if (scanned % 500 === 0) {
      process.stdout.write(`\rScanned: ${scanned}`);
    }
  }

  console.log(`\nScanned ${scanned.toLocaleString()} records, ${matched.toLocaleString()} matched.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
