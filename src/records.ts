import { AtpAgent } from '@atproto/api';
import { tidInRange, tidToDate } from './tid.js';

const COLLECTION = 'fm.teal.alpha.feed.play';
const PAGE_SIZE = 100;

export interface RecordRef {
  rkey: string;
  uri: string;
  createdAt: Date;
}

/**
 * Generator that yields all records from a collection, paginated
 */
export async function* listAllRecords(
  agent: AtpAgent,
  repo: string
): AsyncGenerator<{ uri: string; rkey: string }> {
  let cursor: string | undefined;

  while (true) {
    const response = await agent.com.atproto.repo.listRecords({
      repo,
      collection: COLLECTION,
      limit: PAGE_SIZE,
      cursor,
    });

    for (const record of response.data.records) {
      // Extract rkey from URI: at://did:plc:xxx/collection/rkey
      const rkey = record.uri.split('/').pop()!;
      yield { uri: record.uri, rkey };
    }

    cursor = response.data.cursor;
    if (!cursor || response.data.records.length < PAGE_SIZE) {
      break;
    }
  }
}

/**
 * Get all records within a time range
 * @param agent - Authenticated ATP agent
 * @param repo - DID or handle of the repo
 * @param start - Start of time range (inclusive)
 * @param end - End of time range (inclusive)
 * @param onProgress - Optional callback for progress updates
 */
export async function getRecordsInRange(
  agent: AtpAgent,
  repo: string,
  start: Date,
  end: Date,
  onProgress?: (scanned: number, matched: number) => void
): Promise<RecordRef[]> {
  const matches: RecordRef[] = [];
  let scanned = 0;

  for await (const record of listAllRecords(agent, repo)) {
    scanned++;

    try {
      if (tidInRange(record.rkey, start, end)) {
        matches.push({
          rkey: record.rkey,
          uri: record.uri,
          createdAt: tidToDate(record.rkey),
        });
      }
    } catch (err) {
      // Skip records with invalid TIDs (shouldn't happen but be defensive)
      console.warn(`Skipping record with invalid TID: ${record.rkey}`);
    }

    if (onProgress && scanned % 100 === 0) {
      onProgress(scanned, matches.length);
    }
  }

  // Final progress update
  if (onProgress) {
    onProgress(scanned, matches.length);
  }

  // Sort by creation time (oldest first)
  matches.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return matches;
}

/**
 * Count total records in the collection
 */
export async function countRecords(agent: AtpAgent, repo: string): Promise<number> {
  let count = 0;
  for await (const _ of listAllRecords(agent, repo)) {
    count++;
  }
  return count;
}
