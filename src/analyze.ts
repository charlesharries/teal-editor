import { AtpAgent } from '@atproto/api';
import { config } from 'dotenv';
import { listAllRecords } from './records.js';
import { tidToDate } from './tid.js';

config();

interface CliArgs {
  gap: number;
  minBlock: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let gap = 45;
  let minBlock = 10;

  for (const arg of args) {
    if (arg.startsWith('--gap=')) {
      gap = parseInt(arg.slice(6), 10);
      if (isNaN(gap) || gap <= 0) {
        console.error(`Invalid gap value: ${arg.slice(6)}`);
        process.exit(1);
      }
    } else if (arg.startsWith('--min-block=')) {
      minBlock = parseInt(arg.slice(12), 10);
      if (isNaN(minBlock) || minBlock <= 0) {
        console.error(`Invalid min-block value: ${arg.slice(12)}`);
        process.exit(1);
      }
    }
  }

  return { gap, minBlock };
}

interface Record {
  rkey: string;
  timestamp: Date;
}

function reportBlock(block: Record[], index: number) {
  const first = block[0];
  const last = block[block.length - 1];
  const spanMs = last.timestamp.getTime() - first.timestamp.getTime();
  const avgGap = block.length > 1 ? (spanMs / (block.length - 1) / 1000).toFixed(1) : '0.0';
  const sampleRkeys = block.slice(0, 5).map((r) => r.rkey);

  console.log(`Block #${index}: ${block.length.toLocaleString()} records`);
  console.log(`  From: ${first.timestamp.toISOString()}`);
  console.log(`  To:   ${last.timestamp.toISOString()}`);
  console.log(`  Avg gap: ${avgGap}s`);
  console.log(`  First ${sampleRkeys.length} rkeys: ${sampleRkeys.join(', ')}`);
  console.log('');
}

async function main() {
  const { gap, minBlock } = parseArgs();

  const handle = process.env.BLUESKY_HANDLE;
  const appPassword = process.env.BLUESKY_APP_PASSWORD;
  const pdsUrl = process.env.PDS_URL || 'https://bsky.social';

  if (!handle || !appPassword) {
    console.error('Error: Missing credentials');
    console.error('Create a .env file with BLUESKY_HANDLE and BLUESKY_APP_PASSWORD');
    process.exit(1);
  }

  console.log(`\nAnalyze fm.teal.alpha.feed.play — rapid-scrobble detection`);
  console.log('='.repeat(55));
  console.log(`Handle: ${handle}`);
  console.log(`PDS: ${pdsUrl}`);
  console.log(`Gap threshold: ${gap}s`);
  console.log(`Min block size: ${minBlock}`);
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

  // Collect all records with their timestamps
  console.log('Fetching records...');
  const records: Record[] = [];

  for await (const record of listAllRecords(agent, repo)) {
    try {
      records.push({ rkey: record.rkey, timestamp: tidToDate(record.rkey) });
    } catch {
      // Skip records with unparseable TIDs
    }

    if (records.length % 500 === 0) {
      process.stdout.write(`\rFetched: ${records.length}`);
    }
  }

  console.log(`\rFetched: ${records.length} total\n`);

  if (records.length === 0) {
    console.log('No records found.');
    process.exit(0);
  }

  // Sort by timestamp (oldest first)
  records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Walk through and detect rapid-scrobble blocks
  const gapMs = gap * 1000;
  let currentBlock: Record[] = [records[0]];
  let blockIndex = 1;
  let foundAny = false;

  for (let i = 1; i < records.length; i++) {
    const delta = records[i].timestamp.getTime() - records[i - 1].timestamp.getTime();

    if (delta <= gapMs) {
      currentBlock.push(records[i]);
    } else {
      if (currentBlock.length >= minBlock) {
        reportBlock(currentBlock, blockIndex++);
        foundAny = true;
      }
      currentBlock = [records[i]];
    }
  }

  // Check final block
  if (currentBlock.length >= minBlock) {
    reportBlock(currentBlock, blockIndex++);
    foundAny = true;
  }

  if (!foundAny) {
    console.log('No suspicious rapid-scrobble blocks found.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
