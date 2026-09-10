# KIRAKIRA-Iris

KIRAKIRA 的内容审核模块，以 Node.js 包分发。支持 TypeScript、ESM 和 CommonJS。需要 Node.js 22 以上版本。

出于安全考虑，不提供屏蔽词库，您可以在以下开源存储库中自行获取。  
| 存储库 | 网址 |
|---|---|
| Konsheng/Sensitive-lexicon | https://github.com/Konsheng/Sensitive-lexicon |
| 57ing/Sensitive-word | https://github.com/57ing/Sensitive-word |
| fwwdn/sensitive-stop-words | https://github.com/fwwdn/sensitive-stop-words |

作为最佳实践，您可以像 KIRAKIRA 主站一样，在一个持久化的数据库（例如 MongoDB）中托管关键词库，并允许管理员随时修改。

## 使用

安装：
``` shell
npm install kirakira-iris
```

使用：
```ts
import { readFileSync } from 'node:fs';
import { createIris } from 'kirakira-iris';

const keywords = ['badword1', 'badword2']
const iris = createIris({
  keywords,
  ai: { // 可选的
    apiKey: 'your-openrouter-token',
    rateLimit: { maxRequests: 20, intervalMs: 60_000 },
    maxConcurrent: 1,
    maxQueueSize: 100,
  },
});

const content = 'user-content';                 // 待审核内容
const both = await iris.moderate(content);      // 同时使用关键词与 AI 审查
const keyword = iris.keywordModerate(content);  // 只使用关键词审查
const ai = await iris.aiModerate(content);      // 只使用 AI 审查

```
更新词库时
```ts
// 放在你的词库更新回调或管理接口中，按需调用。
function onKeywordsUpdated(newKeywords: string[]) {
  iris.refreshKeywords(newKeywords);
}
```

刷新是同步操作，校验和编译成功后才切换；失败时保留原词库。传入 `[]` 可清空。已提交或排队的审核保留原关键词结果，之后的调用使用新词库。

## 匹配与位置

同时匹配原文和归一化文本：NFKC、小写、去符号/空白/零宽字符，以及 [OpenCC](https://github.com/nk2028/opencc-js) 繁简字形折叠。输入和词库采用同一规则，例如 `危-險\n詞` 可命中 `危险词`。字形折叠可能合并多义字，不做地域词汇翻译（如“軟體”→“软件”）。

`keywordResult.matches` 保留全部重叠命中、评论及两套位置；汇总取原文中第一个命中。下标均为 UTF-16、左闭右开，可直接用于 `slice(start, end)`。未命中时词为 `null`、下标为 `-1`。`hit` / `hitWord` 兼容别名 `hite` / `hiteWord`。

词库创建时编译为 **Aho–Corasick** 自动机，扫描为 `O(n + z)`（文本长度与命中数），位置映射和结果排序另有开销。重复使用同一实例。运行 `npm run bench` 可与逐词 `indexOf` 比较；小词库不保证 AC 更快。

## AI 与队列

默认模型：[`nvidia/nemotron-3.5-content-safety:free`](https://openrouter.ai/nvidia/nemotron-3.5-content-safety:free)。通过 `ai.model` 切换模型；NVIDIA 安全模型解析原生标签，其他模型默认解析 JSON。

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `ai.rateLimit` | 20 次 / 60 秒 | 滑动窗口，按每次实际 HTTP 请求计数 |
| `ai.maxConcurrent` | 1 | 同时执行的审核数，含等待下一次请求额度的审核 |
| `ai.maxQueueSize` | 100 | 等待审核上限，不含正在执行的审核；0 表示不排队 |
| `ai.timeoutMs` | 30000 | 每次请求超时，不含排队或等待限速额度的时间 |
| `maxInputLength` / `maxMatches` | 100000 / 10000 | 输入长度 / 命中数上限，超过抛出 `RangeError` |

队列按实例共享，`moderate` 与 `aiModerate` 均受约束；不同实例/进程不共享额度。先进先出，满额时**丢弃新提交的审核**，返回 `status: 'dropped'`、`error.code: 'QUEUE_FULL'`、`result: null`，不发请求。使用 `iris.getAIQueueStats()` 查看队列，使用第二个参数 `{ signal }` 取消等待或请求。

AI **只审核原文**，每次审核最多发送一次请求；归一化仅用于关键词匹配。不自动重试或切换付费模型。完整高级选项见 TypeScript 类型。

## 构建与发布

```sh
npm run check       # 构建、类型检查和测试
npm pack            # 生成可安装的 tgz
npm login
npm run release     # 验证后发布 npm
```

也可配置 npm [Trusted Publisher](https://docs.npmjs.com/trusted-publishers/)：组织 `KIRAKIRA-DOUGA`、仓库 `KIRAKIRA-Iris`、工作流 `publish.yml`，允许直接发布；或配置仓库 Secret `NPM_TOKEN`。创建与包版本一致的 `vX.Y.Z` GitHub Release 后自动发布，Actions 手动运行需选择对应 tag。

0.2.0 移除了分级、过滤开关、环境变量读取和旧 `checkKeywords` 方法。关键词调用请改为 `keywordModerate`。

BSD-3-Clause。
