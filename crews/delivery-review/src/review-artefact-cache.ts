import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface ReviewArtefactCacheFile {
  entries: Record<string, { summary: string }>;
}

function cacheFilePath(dbPath: string): string {
  return `${dbPath}.review-artefacts.json`;
}

function readCache(dbPath: string): ReviewArtefactCacheFile {
  const path = cacheFilePath(dbPath);
  if (!existsSync(path)) {
    return { entries: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ReviewArtefactCacheFile;
    if (parsed.entries && typeof parsed.entries === 'object') {
      return parsed;
    }
  } catch {
    // Corrupt cache — treat as empty.
  }
  return { entries: {} };
}

function writeCache(dbPath: string, cache: ReviewArtefactCacheFile): void {
  const path = cacheFilePath(dbPath);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(cache, null, 0), 'utf8');
}

/** Persist the tech-lead review summary between PM HITL pause and merge resume. */
export function saveReviewArtefact(dbPath: string, issueKey: string, summary: string): void {
  const cache = readCache(dbPath);
  cache.entries[issueKey] = { summary };
  writeCache(dbPath, cache);
}

export function loadReviewArtefact(dbPath: string, issueKey: string): string | undefined {
  return readCache(dbPath).entries[issueKey]?.summary;
}

export function clearReviewArtefact(dbPath: string, issueKey: string): void {
  const cache = readCache(dbPath);
  if (!(issueKey in cache.entries)) {
    return;
  }
  delete cache.entries[issueKey];
  writeCache(dbPath, cache);
}
