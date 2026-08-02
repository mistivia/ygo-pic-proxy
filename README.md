# ygo-pic-proxy

一个轻量的游戏王（Yu-Gi-Oh!）卡片图片代理服务。

上游 CDN 只提供 **webp** 格式的图片，本服务拉取后将 **webp 转为 jpg** 再返回给客户端，并带有本地磁盘缓存与“不存在的卡片”记忆，减少对上游的重复请求。

## 上游 CDN

本服务依赖的上游 CDN 是 `cdn.233.momobako.com`，它提供游戏王卡图的 webp 镜像。URL 格式为：

```
https://cdn.233.momobako.com/ygoimg/ygopro/<id>.webp!/format/webp/fw/400/quality/85
```

其中 `<id>` 为卡片 ID。该 CDN 只输出 webp 格式，因此本服务需要下载后转换为 jpg 再返回给客户端。

## 环境要求

- [Nix](https://nixos.org/)（含 flakes），项目内 Haskell 依赖通过 Nix 管理
- 运行时需要 [ImageMagick](https://imagemagick.org/) 的 `magick` 命令（**webp → jpg 转换**依赖它）
- SQLite（通过 `sqlite-simple` 库访问，无需单独安装服务）

## 构建与运行

```bash
# 构建
nix build .#default

# 运行（直接以 nix run 启动）
nix run .#default

# 或在开发环境中运行
nix develop --command cabal run
```

首次启动会自动创建：

- `cache/` —— 图片缓存目录
- `tmp/` —— 下载/转换的临时目录
- `ygo-pic-proxy.db` —— SQLite 数据库（记录“不存在的卡片”）

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

## 测试

```bash
nix develop --command cabal test
```
