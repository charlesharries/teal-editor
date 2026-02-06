import { AtpAgent } from '@atproto/api';
import { config } from 'dotenv';
import { createInterface } from 'readline';
import { getRecordsInRange } from './records.js';
import { deleteRecords } from './deleter.js';
import { formatTid } from './tid.js';

// Load environment variables
config();

interface CliArgs {
  start: Date;
  end: Date;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let start: Date | undefined;
  let end: Date | undefined;
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--start=')) {
      start = new Date(arg.slice(8));
      if (isNaN(start.getTime())) {
        console.error(`Invalid start date: ${arg.slice(8)}`);
        process.exit(1);
      }
    } else if (arg.startsWith('--end=')) {
      end = new Date(arg.slice(6));
      if (isNaN(end.getTime())) {
        console.error(`Invalid end date: ${arg.slice(6)}`);
        process.exit(1);
      }
    }
  }

  if (!start || !end) {
    console.error('Usage: npm start -- --start=<ISO8601> --end=<ISO8601> [--dry-run]');
    console.error('');
    console.error('Examples:');
    console.error('  npm start -- --start=2024-03-01T00:00:00Z --end=2024-03-15T23:59:59Z --dry-run');
    console.error('  npm start -- --start=2024-03-01 --end=2024-03-15');
    process.exit(1);
  }

  if (start > end) {
    console.error('Error: start date must be before end date');
    process.exit(1);
  }

  return { start, end, dryRun };
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

async function main() {
  const { start, end, dryRun } = parseArgs();

  // Check environment variables
  const handle = process.env.BLUESKY_HANDLE;
  const appPassword = process.env.BLUESKY_APP_PASSWORD;
  const pdsUrl = process.env.PDS_URL || 'https://bsky.social';

  if (!handle || !appPassword) {
    console.error('Error: Missing credentials');
    console.error('Create a .env file with BLUESKY_HANDLE and BLUESKY_APP_PASSWORD');
    console.error('See .env.example for reference');
    process.exit(1);
  }

  console.log(`\nPDS Editor - Delete fm.teal.alpha.feed.play records`);
  console.log('='.repeat(50));
  console.log(`Handle: ${handle}`);
  console.log(`PDS: ${pdsUrl}`);
  console.log(`Time range: ${start.toISOString()} to ${end.toISOString()}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  console.log('');

  // Authenticate
  console.log('Authenticating...');
  const agent = new AtpAgent({ service: pdsUrl });

  try {
    await agent.login({
      identifier: handle,
      password: appPassword,
    });
  } catch (err: any) {
    console.error(`Authentication failed: ${err.message}`);
    process.exit(1);
  }

  const repo = agent.session!.did;
  console.log(`Authenticated as: ${repo}`);
  console.log('');

  // Find matching records
  console.log('Scanning records...');
  const records = await getRecordsInRange(agent, repo, start, end, (scanned, matched) => {
    process.stdout.write(`\rScanned: ${scanned}, Matched: ${matched}`);
  });
  console.log('\n');

  if (records.length === 0) {
    console.log('No records found in the specified time range.');
    process.exit(0);
  }

  // Show preview
  console.log(`Found ${records.length} records to delete:`);
  console.log('-'.repeat(50));

  // Show first 10 and last 5 if there are many
  const previewCount = Math.min(records.length, 10);
  for (let i = 0; i < previewCount; i++) {
    console.log(`  ${formatTid(records[i].rkey)}`);
  }

  if (records.length > 15) {
    console.log(`  ... (${records.length - 15} more)`);
    for (let i = records.length - 5; i < records.length; i++) {
      console.log(`  ${formatTid(records[i].rkey)}`);
    }
  } else if (records.length > 10) {
    for (let i = 10; i < records.length; i++) {
      console.log(`  ${formatTid(records[i].rkey)}`);
    }
  }

  console.log('-'.repeat(50));
  console.log(`Time range: ${records[0].createdAt.toISOString()} to ${records[records.length - 1].createdAt.toISOString()}`);
  console.log('');

  if (dryRun) {
    console.log('DRY RUN complete. No records were deleted.');
    console.log('Run without --dry-run to delete these records.');
    process.exit(0);
  }

  // Confirm deletion
  const confirmed = await confirm(
    `\nAre you sure you want to delete ${records.length} records? This cannot be undone.`
  );

  if (!confirmed) {
    console.log('Aborted.');
    process.exit(0);
  }

  // Delete records
  console.log('\nDeleting records...');
  const startTime = Date.now();

  const result = await deleteRecords(agent, repo, records, (progress) => {
    const percent = ((progress.current / progress.total) * 100).toFixed(1);
    const status = progress.success ? 'Deleted' : 'FAILED';
    process.stdout.write(
      `\r[${progress.current}/${progress.total}] (${percent}%) ${status}: ${progress.rkey}    `
    );
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n');
  console.log('='.repeat(50));
  console.log(`Completed in ${duration}s`);
  console.log(`  Deleted: ${result.deleted}`);
  console.log(`  Failed: ${result.failed}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of result.errors.slice(0, 10)) {
      console.log(`  - ${error}`);
    }
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`);
    }
  }

  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
