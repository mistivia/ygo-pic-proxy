# ygo-pic-proxy (JavaScript / Express 版)

一个轻量的游戏王（Yu-Gi-Oh!）卡片图片代理服务，是 [ygo-pic-proxy](../ygo-pic-proxy)（Haskell 实现）的 JavaScript 重写版，功能完全一致。

上游 CDN 只提供 **webp** 格式的图片，本服务拉取后将 **webp 转为 jpg** 再返回给客户端，并带有本地磁盘缓存与"不存在的卡片"记忆，减少对上游的重复请求。

## 上游 CDN

本服务依赖的上游 CDN 是 `cdn.233.momobako.com`，它提供游戏王卡图的 webp 镜像。URL 格式为：

```
https://cdn.233.momobako.com/ygoimg/ygopro/<id>.webp!/format/webp/fw/400/quality/85
```

其中 `<id>` 为卡片 ID。该 CDN 只输出 webp 格式，因此本服务需要下载后转换为 jpg 再返回给客户端。

## 环境要求

- [Node.js](https://nodejs.org/) 22+
- 运行时需要 [ImageMagick](https://imagemagick.org/) 的 `magick` 命令（**webp → jpg 转换**依赖它）
- SQLite（通过 `better-sqlite3` 库访问，无需单独安装服务）

## 构建与运行

```bash
npm install
npm start
```

首次启动会自动创建：

- `cache/` —— 图片缓存目录
- `ygo-pic-proxy.db` —— SQLite 数据库（记录"不存在的卡片"）

## 配置

配置文件为 `config.ini`，参考 `config.ini.example`：

```ini
[server]
host = 0.0.0.0
port = 8080
```

| 键   | 说明             | 默认值 |
| ---- | ---------------- | ------ |
| host | 监听地址         | 0.0.0.0 |
| port | 监听端口（1-65535） | 8080 |

## 使用示例

```bash
# 请求 ID 为 12345 的卡片图片
curl -o card.jpg http://localhost:8080/12345.jpg
```

## 行为说明

- 路径必须形如 `/<数字id>.jpg`，其中 id 为 1~10 位纯数字，否则返回 404。
- 命中磁盘缓存 `cache/<id>.jpg` 时直接返回，`Content-Type: image/jpeg`。
- 未命中缓存时，先查询 SQLite 中的"不存在"记忆表：若一小时内曾确认该卡片不存在，直接返回 404，不请求上游。
- 否则请求上游 CDN（30 秒超时）：
  - 上游 404 → 记录"不存在"（附时间戳）并返回 404。
  - 上游返回非 200/404 → 返回 500（`internal error, download http error`）。
  - 下载过程异常（网络错误等）→ 返回 500（`internal error, download failed`）。
  - 下载成功 → 用 `magick` 将 webp 转为 jpg：
    - 转换失败 → 返回 500（`internal error, magick exception`）。
    - 转换成功 → 立即返回 jpg 内容，并异步将其写入磁盘缓存（不阻塞响应）。

## 测试

```bash
# 单元测试（parseId 校验逻辑）
npm test

# 集成测试（启动真实 HTTP 服务，覆盖缓存命中/未命中/非法 id 等场景；
# 部分用例会访问真实上游 CDN，无网络时自动跳过）
npm run test:integration

# 全部测试
npm run test:all
```

## Lint

代码风格用 ESLint 强制检查（ES Module，禁止 `==`/`!=`，只能用 `===`/`!==`）：

```bash
npm run lint
```
