import express from 'express';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openDb } from './data_access.js';

const execFileAsync = promisify(execFile);

const UPSTREAM_PREFIX = 'https://cdn.233.momobako.com/ygoimg/ygopro/';
const UPSTREAM_SUFFIX = '.webp!/format/webp/fw/400/quality/85';
const DOWNLOAD_TIMEOUT_MS = 30000;
const NOT_EXIST_TTL_SECONDS = 3600;

// ---- id parsing ----

function parseId(name) {
  if (!name.endsWith('.jpg')) return null;
  const s = name.slice(0, -'.jpg'.length);
  if (s.length > 0 && s.length <= 10 && /^[0-9]+$/.test(s)) return s;
  return null;
}

// ---- simple FIFO async queue (Chan equivalent) ----

function AsyncQueue() {
  let self = {
    items: [],
    waiters: [],
    push: function (item) {
      if (self.waiters.length > 0) {
        const resolve = self.waiters.shift();
        resolve(item);
      } else {
        self.items.push(item);
      }
    },
    pop: function () {
      if (self.items.length > 0) {
        return Promise.resolve(self.items.shift());
      }
      return new Promise((resolve) => self.waiters.push(resolve));
    },
  };
  return self;
}

// ---- app state ----

async function createAppState(opts = {}) {
  const cacheDir = opts.cacheDir ?? 'cache';
  const dbPath = opts.dbPath ?? 'ygo-pic-proxy.db';

  await fs.mkdir(cacheDir, { recursive: true });

  const db = openDb(dbPath);

  return {
    db,
    cacheDir,
    queue: AsyncQueue(),
  };
}

// ---- temp file helpers ----

function tempFilePath(prefix, ext) {
  const rand = crypto.randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `${prefix}-${rand}${ext}`);
}

async function removeQuietly(p) {
  try {
    await fs.unlink(p);
  } catch {
    // ignore, matches Haskell's removeQuietly (ignores IOException)
  }
}

async function fileExists(p) {
  try {
    await fs.access(p, fsSync.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---- upstream download ----

async function downloadWebp(cid, dest) {
  const url = `${UPSTREAM_PREFIX}${cid}${UPSTREAM_SUFFIX}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (resp.status === 404) return 'not-found';
  if (resp.status !== 200) return 'http-error';
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(dest, buf);
  return 'ok';
}

async function runMagick(src, dest) {
  await execFileAsync('magick', [src, dest]);
}

// ---- HTTP responses ----

function notFound(res) {
  res.status(404);
  res.set('Content-Length', String(Buffer.byteLength('not found')));
  res.end('not found');
}

function serverError(res, message) {
  res.status(500);
  res.set('Content-Length', String(Buffer.byteLength(message)));
  res.end(message);
}

async function sendCachedFile(res, cacheFile) {
  const stat = await fs.stat(cacheFile);
  res.status(200);
  res.set('Content-Type', 'image/jpeg');
  res.set('Content-Length', String(stat.size));
  await new Promise((resolve, reject) => {
    const stream = fsSync.createReadStream(cacheFile);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
}

function sendImage(res, buffer) {
  res.status(200);
  res.set('Content-Type', 'image/jpeg');
  res.set('Content-Length', String(buffer.length));
  res.end(buffer);
}

// ---- core request handling ----

async function handleImage(state, cid, res) {
  const cacheFile = path.join(state.cacheDir, `${cid}.jpg`);

  if (await fileExists(cacheFile)) {
    await sendCachedFile(res, cacheFile);
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = state.db.getNotExist(cid);
  if (ts !== null && now - ts < NOT_EXIST_TTL_SECONDS) {
    notFound(res);
    return;
  }

  const webpFile = tempFilePath(`ygo-${cid}`, '.webp');
  try {
    let result;
    try {
      result = await downloadWebp(cid, webpFile);
    } catch {
      serverError(res, 'internal error, download failed');
      return;
    }

    if (result === 'not-found') {
      state.db.setNotExist(cid, now);
      notFound(res);
      return;
    }
    if (result === 'http-error') {
      serverError(res, 'internal error, download http error');
      return;
    }

    const jpgFile = tempFilePath(`ygo-${cid}`, '.jpg');
    try {
      await runMagick(webpFile, jpgFile);
      const img = await fs.readFile(jpgFile);
      state.queue.push({ cid, jpgFile });
      sendImage(res, img);
    } catch {
      await removeQuietly(jpgFile);
      serverError(res, 'internal error, magick exception');
    }
  } finally {
    await removeQuietly(webpFile);
  }
}

// ---- express app ----

function createApp(state) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');

  app.use((req, res) => {
    const p = req.path.startsWith('/') ? req.path.slice(1) : req.path;
    if (p.includes('/')) {
      notFound(res);
      return;
    }
    const id = parseId(p);
    if (id === null) {
      notFound(res);
      return;
    }
    handleImage(state, id, res).catch(() => {
      if (!res.headersSent) {
        res.status(500);
      }
      res.end();
    });
  });

  return app;
}

// ---- background worker: moves converted temp files into the disk cache ----

async function worker(state) {
  for (;;) {
    const { cid, jpgFile } = await state.queue.pop();
    try {
      const cacheFile = path.join(state.cacheDir, `${cid}.jpg`);
      if (!(await fileExists(cacheFile))) {
        try {
          await fs.copyFile(jpgFile, cacheFile);
        } catch {
          // ignore, matches Haskell's ignoreIO
        }
      }
    } finally {
      await removeQuietly(jpgFile);
    }
  }
}

export { parseId, createAppState, createApp, worker };
