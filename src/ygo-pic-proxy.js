import express from 'express';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openDb } from './data-access.js';
import { makeLogger } from './logger.js';

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

// ---- simple FIFO async channel (size <= 0 is unbounded, otherwise bounded) ----

function Chan(size) {
  const capacity = size ?? 0;
  let self = {
    items: [],
    recvWaiters: [],
    sendWaiters: [],
    send: function (item) {
      return new Promise((cont) => {
        function deliver() {
          if (self.recvWaiters.length > 0) {
            const recvCont = self.recvWaiters.shift();
            recvCont(item);
          } else {
            self.items.push(item);
          }
          cont();
        }
        if (capacity > 0 && self.items.length >= capacity && self.recvWaiters.length === 0) {
          self.sendWaiters.push(deliver);
        } else {
          deliver();
        }
      });
    },
    recv: function () {
      if (self.items.length > 0) {
        const item = self.items.shift();
        if (self.sendWaiters.length > 0) {
          const sendCont = self.sendWaiters.shift();
          sendCont();
        }
        return Promise.resolve(item);
      }
      return new Promise((cont) => self.recvWaiters.push(cont));
    },
  };
  return self;
}

// ---- app state ----

async function makeAppRt(opts = {}) {
  const cacheDir = opts.cacheDir ?? 'cache';
  const dbPath = opts.dbPath ?? 'ygo-pic-proxy.db';
  const logger = makeLogger(opts.logLevel ?? 'info');

  await fs.mkdir(cacheDir, { recursive: true });

  const db = openDb(dbPath);

  return {
    db,
    cacheDir,
    logger,
    chan: Chan(),
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
  } catch {}
}

async function withFile(filePath, fn) {
  try {
    return await fn(filePath);
  } finally {
    await removeQuietly(filePath);
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
  const sendFile = promisify(res.sendFile.bind(res));
  await sendFile(path.resolve(cacheFile), { headers: { 'Content-Type': 'image/jpeg' } });
}

function sendImage(res, buffer) {
  res.status(200);
  res.set('Content-Type', 'image/jpeg');
  res.set('Content-Length', String(buffer.length));
  res.end(buffer);
}

// ---- core request handling ----

async function handleImage(appRt, cid, res) {
  const cacheFile = path.join(appRt.cacheDir, `${cid}.jpg`);

  if (await fileExists(cacheFile)) {
    appRt.logger.debug(`cid=${cid} cache hit, serving ${cacheFile}`);
    await sendCachedFile(res, cacheFile);
    return;
  }
  appRt.logger.debug(`cid=${cid} cache miss`);

  const now = Math.floor(Date.now() / 1000);
  const ts = appRt.db.getNotExist(cid);
  if (ts !== null && now - ts < NOT_EXIST_TTL_SECONDS) {
    appRt.logger.debug(`cid=${cid} remembered as not-exist (ts=${ts}), skipping upstream`);
    notFound(res);
    return;
  }

  await withFile(tempFilePath(`ygo-${cid}`, '.webp'), async (webpFile) => {
    let result;
    try {
      appRt.logger.debug(`cid=${cid} downloading webp -> ${webpFile}`);
      result = await downloadWebp(cid, webpFile);
      appRt.logger.debug(`cid=${cid} download result=${result}`);
    } catch (err) {
      appRt.logger.warn(`cid=${cid} download failed: ${err.message}`);
      serverError(res, 'internal error, download failed');
      return;
    }

    if (result === 'not-found') {
      appRt.db.setNotExist(cid, now);
      notFound(res);
      return;
    }
    if (result === 'http-error') {
      serverError(res, 'internal error, download http error');
      return;
    }

    const jpgFile = tempFilePath(`ygo-${cid}`, '.jpg');
    try {
      appRt.logger.debug(`cid=${cid} converting webp -> jpg ${jpgFile}`);
      await runMagick(webpFile, jpgFile);
      const img = await fs.readFile(jpgFile);
      appRt.logger.debug(`cid=${cid} conversion ok, queueing ${jpgFile} for caching`);
      await appRt.chan.send({ cid, jpgFile });
      sendImage(res, img);
    } catch (err) {
      appRt.logger.warn(`cid=${cid} magick failed: ${err.message}`);
      await removeQuietly(jpgFile);
      serverError(res, 'internal error, magick exception');
    }
  });
}

// ---- express app ----

function makeApp(appRt) {
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
    handleImage(appRt, id, res).catch(() => {
      if (!res.headersSent) {
        res.status(500);
      }
      res.end();
    });
  });

  return app;
}

// ---- background worker: moves converted temp files into the disk cache ----

async function worker(appRt) {
  for (;;) {
    const { cid, jpgFile } = await appRt.chan.recv();
    await withFile(jpgFile, async (file) => {
      const cacheFile = path.join(appRt.cacheDir, `${cid}.jpg`);
      if (!(await fileExists(cacheFile))) {
        try {
          await fs.copyFile(file, cacheFile);
        } catch {}
      }
    });
  }
}

export { parseId, makeAppRt, makeApp, worker };
