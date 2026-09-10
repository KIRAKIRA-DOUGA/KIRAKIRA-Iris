# KIRAKIRA-Iris

以 Node.js 包分发的 KIRAKIRA 内容审核模块，支持 TypeScript、ESM 和 CommonJS，需要 Node.js 22 以上版本。

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
import { createIris } from 'kirakira-iris';

const keywords = ['badword1', 'badword2'];
const iris = createIris({
  keywords,
  ai: { // 可选的
    apiKey: 'your-openrouter-api-key',
    rateLimit: { maxRequests: 20, intervalMs: 60_000 },
    maxConcurrent: 1,
    maxQueueSize: 100,
  },
});

const content = 'user-content';                  // 待审核内容
const both = await iris.moderate(content);       // 同时使用关键词与 AI 审查
const keyword = iris.keywordModerate(content);   // 只使用关键词审查
const ai = await iris.aiModerate(content);       // 只使用 AI 审查
```

`moderate` 函数始终使用关键词检查内容，如果在 `createIris` 时配置了 AI，也会使用 AI 审查命中关键词的内容（AI 仅审查原文，不审查归一化后的内容）。关键词只要命中，最终 `isIllegal` 必定为 `true`，AI 不会推翻关键词判定的结果。

> [!TIP]
> moderate /ˈmɒdəɹeɪt/ [adj.] [v.] 温和的，适中的； 缓和。在互联网用语中也表示（内容）审核。

当词库更新时：

```ts
// 放在你的词库更新回调或管理接口中，按需调用。
// newKeywords 是全量关键词而不是新增部分。
function onKeywordsUpdated(newKeywords: string[]) {
  iris.refreshKeywords(newKeywords);
}
```

刷新是同步操作，校验和编译成功后才切换；失败时保留原词库。传入 `[]` 可清空。已提交或排队的审核保留原关键词结果，之后的调用使用新词库。

## 关键词匹配与位置

`iris.keywordModerate(content: string): KeywordResult` 是同步方法。词库接受 `string[]` / 只读数组，也可使用 `{ word, comment?, id?, category? }` 提供规则信息；初始化和刷新时编译，审核时复用。

同时匹配原文和归一化文本：NFKC、小写、去符号/空白/零宽字符，以及 [OpenCC](https://github.com/nk2028/opencc-js) 繁简字形折叠。输入和词库采用同一规则，例如 `危-險\n詞` 可命中 `危险词`。字形折叠可能合并多义字，不做地域词汇翻译（如“軟體”→“软件”）。

返回类型如下，文中类型均可从 `kirakira-iris` 导入：

```ts
interface KeywordResult {
  status: 'completed';
  hit: boolean;                 // 是否命中
  hite: boolean;                // hit 的兼容别名
  isIllegal: boolean;           // 恒等于 hit
  hitWord: string | null;       // 按原文位置排序后的首个命中词
  hiteWord: string | null;      // hitWord 的兼容别名
  comment: string;              // 首个命中的评论，或“未命中关键词。”
  normalizeString: string;      // 完整的归一化输入
  wordStartInSource: number;    // 首个命中在原文中的起点
  wordEndInSource: number;      // 原文终点，不含该位置
  wordStartInNormalize: number; // 首个命中在归一化文本中的起点
  wordEndInNormalize: number;   // 归一化终点，不含该位置
  matches: KeywordMatch[];      // 全部命中，未命中时为 []
}

interface KeywordMatch {
  ruleIndex: number;            // 词库数组中的下标，从 0 开始
  id: string | null;            // 调用者提供的规则 ID
  category: string | null;      // 调用者提供的分类
  hitWord: string;              // 词库中未经归一化的原词
  hiteWord: string;             // hitWord 的兼容别名
  comment: string;              // 规则评论，未提供时自动生成命中提示
  matchedIn: Array<'source' | 'normalized'>; // 命中的文本维度，可同时存在
  sourceText: string;           // 原文命中片段，包含中间被移除的间隔
  normalizedText: string;       // 对应归一化片段；无对应位置时为 ''
  wordStartInSource: number;
  wordEndInSource: number;
  wordStartInNormalize: number;
  wordEndInNormalize: number;
}
```

`matches` 保留重叠命中；同一规则在两种文本维度的位置完全一致时合并。先按原文起点、终点排序，再按词库下标和归一化起点排序，汇总字段取第一个命中。下标均为 **UTF-16、左闭右开**，可直接用于 `slice(start, end)`。未命中时词为 `null`、下标为 `-1`；只在原文命中的纯符号词也可能没有归一化位置，此时归一化下标为 `-1`。

词库创建时编译为 **Aho–Corasick** 自动机，扫描为 `O(n + z)`（文本长度与命中数），位置映射和结果排序另有开销。重复使用同一实例。运行 `npm run bench` 可与逐词 `indexOf` 比较；小词库不保证 AC 更快。

## AI 审查与队列

默认模型：[`nvidia/nemotron-3.5-content-safety:free`](https://openrouter.ai/nvidia/nemotron-3.5-content-safety:free)。通过 `ai.model` 切换模型；NVIDIA 安全模型解析原生标签，其他模型默认解析 JSON。

调用签名：`iris.aiModerate(content: string, options?: ModerateOptions): Promise<AIResult>`；`iris.moderate(content: string, options?: ModerateOptions): Promise<ModerationResult>`。`content` 为原文，空字符串或纯空白跳过 AI。

```ts
interface ModerateOptions {
  signal?: AbortSignal; // 取消本次排队、等待限速或正在执行的 AI 请求
}
```

初始化时的 `ai` 类型为 `AIOptions`，除 `apiKey` 外均可省略：

| 配置 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `ai.apiKey` | `string` | 必填 | 显式传入非空 OpenRouter token，不读取环境变量 |
| `ai.model` | `string` | 上述 NVIDIA 免费模型 | OpenRouter 模型 ID |
| `ai.protocol` | `'auto' \| 'nemotron' \| 'json'` | `'auto'` | 自动按模型 ID 选择响应解析格式，也可指定 |
| `ai.rateLimit` | `{ maxRequests: number; intervalMs: number }` | `{ maxRequests: 20, intervalMs: 60000 }` | 滑动窗口，按每次实际 HTTP 请求计数 |
| `ai.maxConcurrent` | `number` | `1` | 同时执行的审核数，含等待限速额度的审核 |
| `ai.maxQueueSize` | `number` | `100` | 等待队列上限，不含正在执行的审核；0 表示不排队 |
| `ai.timeoutMs` | `number` | `30000` | 每次请求超时，不含排队或等待限速的时间，单位毫秒 |
| `ai.maxTokens` | `number` | `512` | 模型最大输出 token 数 |
| `ai.policy` | `string` | 无 | 追加应用审核规则，仅支持 JSON 协议 |
| `ai.structuredOutput` | `boolean` | `false` | 启用 JSON Schema，需要 JSON 协议及兼容模型 |
| `ai.fetch` | `typeof globalThis.fetch` | `globalThis.fetch` | 自定义请求实现，便于接入代理或测试 |

实例级 `maxInputLength: number` / `maxMatches: number` 默认 `100000` / `10000`，分别限制原文 UTF-16 长度和关键词命中数，超过抛出 `RangeError`。数值配置必须为正整数，只有 `maxQueueSize` 允许为 0；非法类型或配置会抛出 `TypeError` / `RangeError`。

AI 响应与组合响应：

```ts
interface AIResult {
  status: 'completed' | 'skipped' | 'disabled' | 'error' | 'dropped';
  result: boolean | null;      // true 不安全，false 安全，null 尚无结论
  needsReview: boolean;        // error / dropped 时为 true
  comment: string;             // 审核结论或跳过、失败、丢弃原因
  model: string;               // 配置的模型 ID，未指定时为默认模型
  categories: string[];        // AI 返回的风险分类，无分类时为 []
  assessments: AIAssessment[];  // 成功时恰有一个原文结果，否则为 []
  skipReason: 'not-configured' | 'empty-input' | 'no-keyword-hit' | 'queue-full' | 'queue-cleared' | null;
  error: AIErrorInfo | null;    // 失败或丢弃详情，其余为 null
}

interface AIAssessment {
  input: 'source';
  result: boolean;
  comment: string;
  categories: string[];
  model: string;               // 服务端返回的实际模型 ID；缺失时回退到配置值
  requestId: string | null;     // 服务端请求 ID
}

interface AIErrorInfo {
  code: AIErrorCode;
  message: string;             // 错误说明，不包含 token 或服务端原始错误正文
  status: number | null;       // HTTP 状态码；非 HTTP 错误为 null
  retryable: boolean;          // 是否适合由调用方稍后重试；库不自动重试
}

type AIErrorCode =
  | 'MISSING_API_KEY'  // 未配置 AI 却调用 aiModerate
  | 'HTTP_ERROR'       // 非成功 HTTP 响应
  | 'API_ERROR'        // 服务端返回 API 错误
  | 'INVALID_RESPONSE' // 模型返回缺失、截断或无法解析的结论
  | 'TIMEOUT'          // 请求超时
  | 'ABORTED'          // 调用者通过 signal 取消
  | 'NETWORK_ERROR'    // 网络或请求实现异常
  | 'QUEUE_FULL'       // 队列满，丢弃新审核
  | 'QUEUE_CLEARED';   // 调用 clearAIQueue，丢弃等待中的审核

interface ModerationResult {
  isIllegal: boolean;          // keywordResult.hit || aiResult.result === true
  needsReview: boolean;        // 等于 aiResult.needsReview
  keywordResult: KeywordResult;
  aiResult: AIResult;
}
```

`completed` 表示得到 AI 结论；`skipped` 表示空输入或 `moderate` 未命中关键词；`disabled` 表示 `moderate` 未配置 AI；`error` 表示审核失败或取消；`dropped` 表示队列已满或被清空。除 `completed` 外，`result` 均为 `null`。`isIllegal: false` 且 `needsReview: true` 表示尚未发现违规，但 AI 未完成审核，不能视作完整通过。

配置 AI 后，`moderate` 对非空、未命中关键词的输入返回 `skipReason: 'no-keyword-hit'`、`needsReview: false`，不会进入 AI 队列或消耗请求额度；空词库同样如此。`aiModerate` 独立审查原文，不要求关键词命中。

队列按实例共享，`moderate` 与 `aiModerate` 均受约束；不同实例/进程不共享额度。先进先出，满额时**丢弃新提交的审核**，返回 `status: 'dropped'`、`error.code: 'QUEUE_FULL'`、`skipReason: 'queue-full'`，不发请求。

```ts
const removed: number = iris.clearAIQueue(); // 同步清空等待队列，返回移除数量
const stats: AIQueueStats = iris.getAIQueueStats();

interface AIQueueStats {
  active: number;        // 已占用执行槽的审核，包含等待限速额度的审核
  queued: number;        // 等待执行槽的审核数
  maxConcurrent: number;
  maxQueueSize: number;
}
```

清空后，被移除调用的 Promise 会正常返回 `status: 'dropped'`、`error.code: 'QUEUE_CLEARED'`、`skipReason: 'queue-cleared'`、`result: null`、`needsReview: true`，已完成的关键词结果保留。`clearAIQueue()` 只移除 `queued`，不取消 `active`（包括等待限速的审核），不重置限速记录；空队列返回 0，之后仍可提交新审核。需要取消执行中的某次审核时，使用该调用的 `{ signal }`。

AI **只审核原文**，每次审核最多发送一次请求；归一化仅用于关键词匹配。不自动重试或切换付费模型。

## 构建与发布

```sh
npm run check       # 构建、类型检查和测试
npm pack            # 生成可安装的 tgz
npm login
npm run release     # 验证后发布 npm
```

也可配置 npm [Trusted Publisher](https://docs.npmjs.com/trusted-publishers/)：组织 `KIRAKIRA-DOUGA`、仓库 `KIRAKIRA-Iris`、工作流 `publish.yml`，允许直接发布；或配置仓库 Secret `NPM_TOKEN`。创建与包版本一致的 `vX.Y.Z` GitHub Release 后自动发布，Actions 手动运行需选择对应 tag。

BSD-3-Clause。
