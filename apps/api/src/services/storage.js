import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Local-disk object storage behind a tiny interface: every route that stores a
 * file goes through these helpers so no path/unlink logic lives in route files.
 * When uploads move to S3, this module is the adapter boundary — a matching
 * `uploads/storageKey/discard/serve` implementation replaces it, and routes
 * keep working unchanged.
 */

const dirs = new Map();

/** Resolve (and create) the directory that holds uploads; `sub` namespaces files, e.g. 'documents'. */
export function uploadDir(sub = '') {
  if (!dirs.has(sub)) {
    const dir = path.resolve(env.uploadDir, sub);
    fs.mkdirSync(dir, { recursive: true });
    dirs.set(sub, dir);
  }
  return dirs.get(sub);
}

/** Multer `diskStorage` targeting `uploadDir(sub)`, with random storage keys. */
export function diskStorage(sub = '') {
  return {
    destination: uploadDir(sub),
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname || '').slice(0, 10)),
  };
}

/** On-disk path for a storage key; `basename` strips any traversal from the stored key. */
export const storagePath = (storageKey, sub = '') => path.join(uploadDir(sub), path.basename(storageKey || ''));

/** Delete a stored file, ignoring errors (never let cleanup failures break a request). */
export const discard = (fileOrPath) => fs.promises.unlink(fileOrPath?.path || fileOrPath).catch(() => {});
