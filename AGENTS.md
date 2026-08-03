# AGENTS.md

## Haskell 开发技巧

### 如何查看一个变量的类型签名

例如，我想看 Servant.Client 中 runClientM 的类型签名：

```
cat << EOF | ghci
import Servant.Client (runClientM)
:t runClientM
EOF
```

### 如何查看一个类型或者typeclass的元信息

和上面类似，但是使用 :i

```
cat << EOF | ghci
import Data.Text
:i Text
EOF
```
