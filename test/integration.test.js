import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { makeAppRt, makeApp, worker } from '../src/ygo-pic-proxy.js';
import { openDb } from '../src/data-access.js';

async function withServer(fn) {
  const dir = path.join(
    os.tmpdir(),
    `ygo-pic-proxy-it-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
  );
  await fs.mkdir(dir, { recursive: true });

  const prevCwd = process.cwd();
  process.chdir(dir);

  let server;
  try {
    const app = await makeAppRt();
    worker(app).catch(() => {});

    const expressApp = makeApp(app);
    server = http.createServer(expressApp);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    await fn({ port, dir });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    process.chdir(prevCwd);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function request(port, reqPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: reqPath }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks),
            contentType: res.headers['content-type'],
          }),
        );
      })
      .on('error', reject);
  });
}

// 1. 已缓存的卡片：直接命中磁盘缓存
test('cached card is served from disk cache', async () => {
  await withServer(async ({ port, dir }) => {
    const cacheDir = path.join(dir, 'cache');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, '1111111.jpg'), 'fake-jpeg-cache-data');

    const r1 = await request(port, '/1111111.jpg');
    assert.equal(r1.status, 200);
    assert.equal(r1.body.toString(), 'fake-jpeg-cache-data');
    assert.equal(r1.contentType, 'image/jpeg');

    const r2 = await request(port, '/1111111.jpg');
    assert.equal(r2.status, 200);
  });
});

// 2. 数据库里已记住的不存在的卡片：直接 404，不访问上游
test('known-missing card returns 404 without hitting upstream', async () => {
  await withServer(async ({ port, dir }) => {
    const db = openDb(path.join(dir, 'ygo-pic-proxy.db'));
    const now = Math.floor(Date.now() / 1000);
    db.setNotExist('999999999', now);

    const r = await request(port, '/999999999.jpg');
    assert.equal(r.status, 404);
    assert.equal(r.body.toString(), 'not found');
  });
});

// 3. 从未请求过的不存在的卡片：访问上游 CDN 后 404，并记住结果
test('new missing card triggers upstream fetch, 404s, then remembers', async () => {
  await withServer(async ({ port }) => {
    let reachable = true;
    try {
      const probe = await fetch(
        'https://cdn.233.momobako.com/ygoimg/ygopro/46986414.webp!/format/webp/fw/400/quality/85',
        { signal: AbortSignal.timeout(3000) },
      );
      reachable = probe.status !== 404;
    } catch {
      reachable = false;
    }

    if (!reachable) {
      console.log('SKIP: no network access to upstream CDN');
      return;
    }

    const r1 = await request(port, '/9999999999.jpg');
    assert.equal(r1.status, 404);
    assert.equal(r1.body.toString(), 'not found');

    const r2 = await request(port, '/9999999999.jpg');
    assert.equal(r2.status, 404);
  });
});

// 4. 非法 ID：非数字 / 缺后缀 / 超长 / 空
test('invalid ids return 404', async () => {
  await withServer(async ({ port }) => {
    for (const p of ['/abc.jpg', '/12345', '/12345678901.jpg', '/.jpg']) {
      const r = await request(port, p);
      assert.equal(r.status, 404, p);
    }
  });
});

// 5. 根路径与深层路径
test('root and nested paths return 404', async () => {
  await withServer(async ({ port }) => {
    const r1 = await request(port, '/');
    assert.equal(r1.status, 404);

    const r2 = await request(port, '/foo/1234.jpg');
    assert.equal(r2.status, 404);
  });
});

// 6. 真实存在的卡片：完整走一遍下载 -> webp 转 jpg -> 响应 -> 异步写入缓存
test('existing card downloads, converts to jpg, and gets cached', async () => {
  await withServer(async ({ port, dir }) => {
    let reachable = true;
    try {
      const probe = await fetch(
        'https://cdn.233.momobako.com/ygoimg/ygopro/46986414.webp!/format/webp/fw/400/quality/85',
        { signal: AbortSignal.timeout(3000) },
      );
      reachable = probe.status === 200;
    } catch {
      reachable = false;
    }

    if (!reachable) {
      console.log('SKIP: no network access to upstream CDN');
      return;
    }

    const r1 = await request(port, '/46986414.jpg');
    assert.equal(r1.status, 200);
    assert.equal(r1.contentType, 'image/jpeg');
    assert.ok(r1.body.length > 0);
    // JPEG magic bytes
    assert.equal(r1.body[0], 0xff);
    assert.equal(r1.body[1], 0xd8);

    // 缓存写入是异步的（后台 worker），等待其落盘
    const cacheFile = path.join(dir, 'cache', '46986414.jpg');
    for (let i = 0; i < 50; i += 1) {
      try {
        await fs.access(cacheFile);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const cached = await fs.readFile(cacheFile);
    assert.deepEqual(cached, r1.body);
  });
});
