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

### 用 lint 固化这些规则

规则通过 ESLint（`eslint.config.js`）强制检查，运行 `npm run lint`。目前启用的规则：

- `strict: ["error", "never"]` —— ES Module 下禁止写 `'use strict'` 编译指令（多余）
- `eqeqeq: ["error", "always"]` —— 禁止 `==`/`!=`，只能用 `===`/`!==`

新增代码风格约束时，优先加进 `eslint.config.js` 里用规则强制，而不是只写在文档里靠自觉遵守。
