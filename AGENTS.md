# AGENTS.md

## Nix 开发环境（强制要求）

本项目基于 Nix Flake 管理开发环境。**所有**开发相关命令必须在 nix 环境中运行：

- 构建项目：`nix build .#default`
- 进入开发环境：`nix develop`
- 在开发环境中构建：`nix develop --command cabal build`
- 在开发环境中运行测试：`nix develop --command cabal test`
- 在开发环境中运行 ghci：`nix develop --command ghci`
- 运行项目：`nix run .#default`
- 检查 flake 配置：`nix flake check`

**禁止**直接调用系统全局安装的 ghc、cabal、ghci 等工具，必须通过 `nix develop --command ...` 或 `nix build` 等方式在 nix 环境中执行。

## Haskell 开发技巧

### 如何查看一个变量的类型签名

例如，我想看 Servant.Client 中 runClientM 的类型签名：

```
cat << EOF | nix develop --command ghci
import Servant.Client (runClientM)
:t runClientM
EOF
```

### 如何查看一个类型或者typeclass的元信息

和上面类似，但是使用 :i

```
cat << EOF | nix develop --command ghci
import Data.Text
:i Text
EOF
```
