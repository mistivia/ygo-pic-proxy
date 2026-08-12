# AGENTS.md

## 代码风格偏好

### 不要用 class

用普通 function 以工厂函数的方式创建对象，内部方法通过 `self.xxx` 互相引用，例如：

```js
function MyType(x, y) {
    let self = {
        x,
        y,
        method: function(arg) {
            return self.x + arg;
        }
    };
    return self;
}
```

### 不要用下划线开头命名字段/变量

例如私有字段不要写成 `_items`、`_waiters`，直接用 `items`、`waiters` 即可。

### 模块系统统一用 ES Module

用 `import` / `export`，不要用 CommonJS 的 `require` / `module.exports`。`package.json` 中 `"type"` 保持为 `"module"`。（之前改成过 CommonJS，后来又改回了 ES Module——就用这个，不要再切回 CommonJS 了。）

ES Module 本身就是严格模式，不需要也不要手写 `'use strict';`（ESLint 的 `strict` 规则设成了 `["error", "never"]`，写了反而会报错）。

### SQL 语句集中管理

所有 SQL 语句放在 `src/data_access.js` 一个文件里，其他模块只调用这里导出的函数（如 `openDb`），不直接拼 SQL 或直接操作数据库连接。

### 只用 `===` / `!==`，不要用 `==` / `!=`

### 禁止 `throw`，报错用 Haskell 风格的 `Either`（`Left`/`Right`）表示

我们自己写的代码不允许用 `throw` 抛错，一律返回一个 `Left`（失败）或 `Right`（成功）包装值：

```js
function Left(value) {
  return { type: Left, value };
}

function Right(value) {
  return { type: Right, value };
}
```

`Left`/`Right` 定义在 `src/utils.js`，谁要用就从那里 import，不要在别的文件里重新定义。`type` 字段存的就是 `Left`/`Right` 函数本身（用函数引用当 tag），调用方用 `result.type === Left` 判断失败分支，`result.value` 拿负载（错误信息或成功值，两种情况都叫 `value`，不分 `error`/`value` 两个字段名）。要判断哪个分支，调用方需要 import `Left`（有时也需要 `Right`）。参考 `src/config.js`（`loadSettings`/`parseSettings`/`parsePort`/`parseLogLevel` 都是这个写法）和 `server.js` 里对 `loadSettings` 返回值的检查方式。

这条规则针对的是**我们自己写的代码**：像 `fs.readFileSync`、`better-sqlite3`、`fetch`、`child_process` 这些第三方/内置 API 依然会抛异常，遇到时仍然要用 try/catch 接住并转成 `Left(...)` 返回值（`config.js` 里 `fs.readFileSync` 的 try/catch 就是这种情况），而不是放任它们的异常经手往上冒。

### 用 lint 固化这些规则

规则通过 ESLint（`eslint.config.js`）强制检查，运行 `npm run lint`。目前启用的规则：

- `strict: ["error", "never"]` —— ES Module 下禁止写 `'use strict'` 编译指令（多余）
- `eqeqeq: ["error", "always"]` —— 禁止 `==`/`!=`，只能用 `===`/`!==`
- `no-restricted-syntax` 禁止 `ThrowStatement` —— 不准写 `throw`，报错用 `Left`/`Right` 表示

新增代码风格约束时，优先加进 `eslint.config.js` 里用规则强制，而不是只写在文档里靠自觉遵守。

## 每次改完代码要跑的验证

改完代码后，按下面的顺序跑一遍，全部通过才算完成：

1. **Lint**：`npm run lint`。有 lint 错误直接算失败，先修完再往下走。
2. **单元测试**：`npm test`（只跑 `test/parseId.test.js`，跑得快，覆盖 `parseId` 之类的纯函数逻辑）。
3. **集成测试**：`npm run test:integration`（跑 `test/integration.test.js`，会真起一个 HTTP server，覆盖缓存命中/未命中、`notexist` 记忆、非法 id、真实上游 CDN 下载转换缓存等场景）。也可以直接用 `npm run test:all` 一次跑完单元 + 集成测试。
   - 集成测试里有几个用例会真的访问上游 CDN（`cdn.233.momobako.com`），没网络时会自动打印 `SKIP` 跳过，不算失败；但如果本来有网络却被跳过了，要留意是不是环境出了问题。
   - 每次跑之前/跑完之后记得 `rm -rf cache ygo-pic-proxy.db*` 清理掉本地测试残留的缓存目录和 SQLite 文件，不然可能带着上次的状态干扰下一次验证（这些文件本身在 `.gitignore` 里，不会被提交，但会污染本地这次验证的结果）。
4. **改动涉及 server.js / 启动流程 / 配置解析时，额外手动起一次真实服务验证**：
   - 用 `node server.js`（或 `npm run start`）在后台起服务，确认能正常监听且不会秒退（例如端口被占用会走 `httpServer.on('error', ...)`，报错退出而不是静默退出）。
   - 用 `curl` 打几个请求验证：非法 id（如 `/abc.jpg`）应该 404；一张真实存在的卡片 id（如 `/46986414.jpg`）第一次应该下载转换成功返回 200 且是合法 jpg（可以用 `file` 命令确认），稍等一下 `cache/` 目录下应该出现对应的 `.jpg` 文件，再请求一次应该直接命中缓存。
   - 验证完记得杀掉起的服务进程，并清理 `cache/`、`ygo-pic-proxy.db*`。
   - 涉及 `config.ini` 的 `log_level`/`host`/`port` 校验逻辑时，额外测一下非法值（比如错误的 `log_level`）能不能在启动时就报出清晰的错误并以非零退出码结束，而不是静默失败。
