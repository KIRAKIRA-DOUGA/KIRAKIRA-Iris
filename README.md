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
    // model: '供应商/模型ID', // 切换模型时填写；省略则使用默认安全模型
  },
});

const content = 'user-content';                  // 待审核内容
const both = await iris.moderate(content);       // 同时使用关键词与 AI 审查
const keyword = iris.keywordModerate(content);   // 只使用关键词审查
const ai = await iris.aiModerate(content);       // 只使用 AI 审查
```

`moderate` 函数始终使用关键词检查内容，如果在 `createIris` 时配置了 AI，也会使用 AI 审查命中关键词的内容（AI 仅审查原文，不审查归一化后的内容）。关键词只要命中，最终 `hit` 必定为 `true`，AI 不会推翻关键词判定的结果。

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

## 常用函数

| 调用 | 返回类型 | 用途 |
| --- | --- | --- |
| `createIris(options?: IrisOptions)` | `Iris` | 初始化并编译词库 |
| `iris.refreshKeywords(keywords: readonly string[])` | `void` | 同步全量替换词库，`[]` 清空 |
| `iris.keywordModerate(content: string)` | `KeywordResult` | 同步关键词匹配 |
| `iris.aiModerate(content: string, options?: ModerateOptions)` | `Promise<AIResult>` | 独立 AI 审查原文 |
| `iris.moderate(content: string, options?: ModerateOptions)` | `Promise<ModerationResult>` | 关键词命中后追加可选 AI 审查 |
| `iris.clearAIQueue()` | `number` | 清空等待队列，返回移除数量 |
| `iris.getAIQueueStats()` | `AIQueueStats` | 查询当前队列 |

常用初始化参数（词库只接受字符串数组，也接受只读数组；其余高级选项见[详细说明](docs/ai-and-cancellation.md#高级选项什么时候才需要)）：

```ts
interface IrisOptions {
  keywords?: readonly string[]; // 默认 []；调用者自行加载，初始化后复用
  maxInputLength?: number;      // 默认 100000，原文 content.length 的上限
  maxMatches?: number;          // 默认 10000，原文与其归一化文本一共最多可以匹配到的关键词数量
  ai?: {                       // 省略时不启用 AI
    apiKey: string;             // 必须显式传入，不读取环境变量
    model?: string;             // 默认下文的 NVIDIA 安全模型
    rateLimit?: { maxRequests: number; intervalMs: number }; // 默认最近 60000ms 内最多发出 20 次请求
    maxConcurrent?: number;     // 默认 3，同时执行的 AI 审核数量上限
    maxQueueSize?: number;      // 默认 100；0 表示不排队
    timeoutMs?: number;         // 默认 30000，仅计算实际请求耗时
    maxTokens?: number;         // 默认 512，最大输出 token 数
  };
}
```

数值配置为正整数，`maxQueueSize` 允许为 0。非法输入或配置抛出 `TypeError` / `RangeError`；超过长度或命中数上限也会抛出 `RangeError`，不会返回截断结果。

`maxInputLength` 与 JavaScript 的字符串 `.length` 一致：`"测试"` 是 2，`"test"` 是 4，`"😀"` 是 2，计量单位为 UTF-16 代码单元。`maxMatches` 按**命中次数**计数，不是去重后的词语种类：同一关键词在原文和归一化文本中各命中一次，共计 2 次。

## 关键词匹配与位置

同时匹配原文和归一化文本：NFKC、小写、去符号/空白/零宽字符，以及 [OpenCC](https://github.com/nk2028/opencc-js) 繁简字形折叠。输入和词库采用同一规则，例如 `危-險\n詞` 可命中 `危险词`。字形折叠可能合并多义字，不做地域词汇翻译（如“軟體”→“软件”）。

```ts
interface KeywordResult {
  hit: boolean;                        // 任一列表非空即为 true
  normalizeString: string;              // 完整归一化输入
  matchesInSource: KeywordMatch[];      // 在原文直接命中的结果
  matchesInNormalize: KeywordMatch[];   // 在归一化文本命中的结果
}

interface KeywordMatch {
  hitWord: string;              // 词库中未经归一化的关键词
  wordStartInSource: number;    // 原文起点
  wordEndInSource: number;      // 原文终点，不含该位置
  wordStartInNormalize: number; // 归一化文本起点
  wordEndInNormalize: number;   // 归一化文本终点，不含该位置
}
```

两组列表独立保留重叠和重复词条命中，分别按各自文本的起点、终点排序；同一位置可出现在两组中，未命中的列表为 `[]`。下标均为 **UTF-16、左闭右开**，可直接用于 `slice(start, end)`。归一化命中也提供对应的原文范围，便于高亮；原文中的纯符号词没有归一化位置时，两个归一化下标为 `-1`。

词库初始化和刷新时编译为 **Aho–Corasick** 自动机，扫描为 `O(n + z)`，位置映射和排序另有开销。重复使用同一实例。`npm run bench` 可与逐词 `indexOf` 比较；小词库不保证 AC 更快。

## AI 审查与队列

默认模型：[`nvidia/nemotron-3.5-content-safety:free`](https://openrouter.ai/nvidia/nemotron-3.5-content-safety:free)。**普通接入只需 `apiKey`，切换模型再提供 `model`。** 提示词、输出格式选择和解析由 Iris 处理，返回类型保持一致。模型支持情况、高级选项及取消示例见[详细说明](docs/ai-and-cancellation.md)。

```ts
interface ModerateOptions {
  signal?: AbortSignal; // 可选取消通知；例如 controller.signal 或 AbortSignal.timeout(5000)
}

interface AIResult {
  status: 'pass' | 'block' | 'drop'; // 通过 / 未通过 / 未完成审核
  comment: string;                 // 审核说明，或未审核的原因
  model: string;                   // 实际响应模型 ID；无响应时为配置值或默认值
  skipReason: 'not-configured' | 'empty-input' | 'no-keyword-hit' | 'queue-full' | 'queue-cleared' | null;
  error: AIErrorInfo | null;        // 失败详情；正常通过、未通过或主动跳过时为 null
}

interface ModerationResult {
  hit: boolean; // keywordResult.hit || aiResult.status === 'block'；AI 不会推翻关键词命中
  keywordResult: KeywordResult;
  aiResult: AIResult;
}

interface AIQueueStats {
  active: number;        // 已占用执行槽的审核，包含等待限速的审核
  queued: number;        // 等待执行槽的审核数
  maxConcurrent: number;
  maxQueueSize: number;
}
```

`pass` / `block` 表示 AI 已完成判断。空输入、未配置 AI、`moderate` 未命中关键词、取消、超时、请求失败、队列满或被清空，均为 `drop`，**不表示 AI 判定通过**。`skipReason` 说明主动跳过或队列丢弃原因；`error` 包含 `code`、`message`、HTTP `status`（可为 null）和 `retryable`，供失败排查，完整类型可在编辑器中查看。

`moderate` 未命中时不会进入 AI 队列；`aiModerate` 不要求关键词命中。AI 始终只审查原文，每次最多一次请求。归一化仅用于关键词匹配。

队列按实例共享，先进先出；不同实例/进程不共享限额。满额时丢弃新审核，返回 `drop` / `QUEUE_FULL`。`clearAIQueue()` 同步移除所有 `queued`，对应 Promise 返回 `drop` / `QUEUE_CLEARED`；已有关键词结果保留，`active` 继续执行，限速记录不重置。空队列返回 0，之后仍可提交新审核。

`intervalMs` 是限速统计窗口，单位毫秒。有可用额度和空闲执行位置时立即发请求，**不需要固定等待 60 秒**。例如最近 60 秒已经发满 20 次，就等最早那次请求移出统计窗口后再发送；大量消息积压时，等待可能超过 60 秒。

`maxConcurrent` 控制同时执行多少次 AI 审核：1 表示逐个执行，3 表示最多同时执行 3 个，其余排队。已经取得执行位置、但正在等待限速额度的审核也占用这个数量。提高并发数不会提高 `rateLimit` 的请求额度。

`signal` 由调用者控制，可用于用户撤回、请求断开或给整个排队和审查过程设置期限。取消后返回 `drop` / `ABORTED`。`ai.timeoutMs` 仅限制实际请求耗时，超时为 `drop` / `TIMEOUT`。库不自动重试或切换付费模型。

## 构建与发布

```sh
npm run check       # 构建、类型检查和测试
npm pack            # 生成可安装的 tgz
npm login
npm run release     # 验证后发布 npm
```

也可配置 npm [Trusted Publisher](https://docs.npmjs.com/trusted-publishers/)：组织 `KIRAKIRA-DOUGA`、仓库 `KIRAKIRA-Iris`、工作流 `publish.yml`，允许直接发布；或配置仓库 Secret `NPM_TOKEN`。创建与包版本一致的 `vX.Y.Z` GitHub Release 后自动发布，Actions 手动运行需选择对应 tag。

BSD-3-Clause。
