import { AtpAgent } from '@atproto/api';
import type { RecordRef } from './records.js';

const COLLECTION = 'fm.teal.alpha.feed.play';

// Rate limit: 5000 deletions per hour, stay under with buffer
const MAX_DELETIONS_PER_HOUR = 4500;
const HOUR_MS = 60 * 60 * 1000;

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

interface DeleteProgress {
  current: number;
  total: number;
  rkey: string;
  success: boolean;
  error?: string;
}

interface RateLimitState {
  deletionsThisWindow: number;
  windowStart: number;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delete a single record with retries
 */
async function deleteWithRetry(
  agent: AtpAgent,
  repo: string,
  rkey: string
): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo,
        collection: COLLECTION,
        rkey,
      });
      return; // Success
    } catch (err: any) {
      lastError = err;

      // Handle rate limiting (HTTP 429)
      if (err.status === 429) {
        const resetHeader = err.headers?.['ratelimit-reset'];
        const waitMs = resetHeader
          ? (parseInt(resetHeader, 10) * 1000 - Date.now())
          : 60000;

        console.log(`\nRate limited. Waiting ${Math.ceil(waitMs / 1000)}s...`);
        await sleep(Math.max(waitMs, 1000));
        continue;
      }

      // Record doesn't exist - treat as success (idempotent)
      if (err.status === 400 && err.message?.includes('not found')) {
        return;
      }

      // For other errors, exponential backoff
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(`\nRetrying in ${delay}ms after error: ${err.message}`);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Delete failed after retries');
}

/**
 * Check and enforce rate limits
 */
async function enforceRateLimit(state: RateLimitState): Promise<void> {
  const now = Date.now();

  // Reset window if hour has passed
  if (now - state.windowStart >= HOUR_MS) {
    state.deletionsThisWindow = 0;
    state.windowStart = now;
  }

  // If we're at the limit, wait for window to reset
  if (state.deletionsThisWindow >= MAX_DELETIONS_PER_HOUR) {
    const waitMs = HOUR_MS - (now - state.windowStart);
    console.log(
      `\nRate limit approaching. Waiting ${Math.ceil(waitMs / 60000)} minutes for rate limit window to reset...`
    );
    await sleep(waitMs + 1000); // Add 1s buffer
    state.deletionsThisWindow = 0;
    state.windowStart = Date.now();
  }
}

/**
 * Delete records with rate limiting and progress reporting
 * @param agent - Authenticated ATP agent
 * @param repo - DID or handle of the repo
 * @param records - Records to delete
 * @param onProgress - Progress callback
 */
export async function deleteRecords(
  agent: AtpAgent,
  repo: string,
  records: RecordRef[],
  onProgress?: (progress: DeleteProgress) => void
): Promise<{ deleted: number; failed: number; errors: string[] }> {
  const rateLimit: RateLimitState = {
    deletionsThisWindow: 0,
    windowStart: Date.now(),
  };

  let deleted = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Enforce rate limits before each deletion
    await enforceRateLimit(rateLimit);

    try {
      await deleteWithRetry(agent, repo, record.rkey);
      deleted++;
      rateLimit.deletionsThisWindow++;

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: records.length,
          rkey: record.rkey,
          success: true,
        });
      }
    } catch (err: any) {
      failed++;
      const errorMsg = `Failed to delete ${record.rkey}: ${err.message}`;
      errors.push(errorMsg);

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: records.length,
          rkey: record.rkey,
          success: false,
          error: err.message,
        });
      }
    }

    // Small delay between deletions to be gentle on the server
    await sleep(50);
  }

  return { deleted, failed, errors };
}
