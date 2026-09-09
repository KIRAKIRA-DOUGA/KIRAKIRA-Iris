# KIRAKIRA-Iris

Node.js 22+ 内容审核包，支持 TypeScript、ESM 和 CommonJS。无内置屏蔽词库，无关键词分级。

## 使用

包发布后安装：`npm install kirakira-iris`。源码开发：`npm ci && npm run check`。

```ts
import { readFileSync } from 'node:fs';
import { createIris } from 'kirakira-iris';

// 从你选择的开源词库取得文件；一行一词。也可直接传 string[]。
const keywords = readFileSync('./keywords.txt', 'utf8')
  .split(/\r?\n/).map(word => word.trim()).filter(Boolean);

const iris = createIris({
  keywords,
  ai: { // 不需要 AI 时省略整个 ai 配置。
    apiKey: 'your-openrouter-token', // 必须传字符串，不读取环境变量。
    rateLimit: { maxRequests: 20, intervalMs: 60_000 },
    maxConcurrent: 1,
    maxQueueSize: 100,
  },
});

const content = '待审核内容';
const both = await iris.moderate(content);       // 查关键词，命中后追加 AI
const keyword = iris.keywordModerate(content);  // 只查关键词，同步
const ai = await iris.aiModerate(content);       // 只查 AI，不依赖关键词命中
```

- **关键词只要命中，`isIllegal` 必定为 `true`，AI 无权推翻。** 没有关闭关键词的开关。
- `moderate` 返回 `{ isIllegal, needsReview, keywordResult, aiResult }`；无关键词命中时不调用 AI。空词库同样不会触发 AI，需要全文 AI 审核时调用 `aiModerate`。
- `keywordModerate` 返回 `KeywordResult`；`aiModerate` 返回 `AIResult`。`ai.result` 的 `true` / `false` 分别表示不安全 / 安全，`null` 表示未得到完整结论。
- AI 超时、失败或被丢弃时返回明确状态，`needsReview: true`；原有关键词命中始终保留。
- 关键词也可传 `{ word, comment?, id?, category? }`，词库由调用者选择和加载，库不自动下载或更新。

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
| `ai.reviewNormalized` | `true` | 原文与归一化文本不同时分别审核，最多两次请求 |
| `ai.timeoutMs` | 30000 | 每次请求超时，不含排队或等待限速额度的时间 |
| `maxInputLength` / `maxMatches` | 100000 / 10000 | 输入长度 / 命中数上限，超过抛出 `RangeError` |

队列按实例共享，`moderate` 与 `aiModerate` 均受约束；不同实例/进程不共享额度。先进先出，满额时**丢弃新提交的审核**，返回 `status: 'dropped'`、`error.code: 'QUEUE_FULL'`、`result: null`，不发请求。使用 `iris.getAIQueueStats()` 查看队列，使用第二个参数 `{ signal }` 取消等待或请求。

每段文本的多个 AI 判断采用“任一不安全即不安全”。不自动重试或切换付费模型。完整高级选项见 TypeScript 类型；AI 会将原文及可选归一化文本发送到 OpenRouter。

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
