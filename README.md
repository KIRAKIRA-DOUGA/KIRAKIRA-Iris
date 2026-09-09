# KIRAKIRA-Iris

面向 Node.js 的内容审核包。支持 TypeScript、三级关键词、Unicode 归一化和 OpenRouter AI 复核，运行时零第三方依赖。

- 同时匹配原文与归一化文本，返回全部命中、评论和两套位置。
- 风险等级为 `general`（一般）、`dangerous`（危险）、`extreme`（极度危险）。
- 关键词过滤、AI 过滤可以独立开关，也可在每次调用时覆盖。
- 默认使用 `nvidia/nemotron-3.5-content-safety:free`，支持切换 OpenRouter 模型。
- 输出 `keywordResult`、`aiResult` 和最终业务判断 `isIllegal`。
- 提供 ESM、CommonJS、类型声明、测试及 npm 发布工作流。

## 开发与安装

要求 Node.js 22 或以上。源码可立即构建使用：

```sh
git clone https://github.com/KIRAKIRA-DOUGA/KIRAKIRA-Iris.git
cd KIRAKIRA-Iris
npm ci
npm run check
node examples/basic.mjs
```

包名为 `kirakira-iris`，首个版本发布到 npm 后可安装：

```sh
npm install kirakira-iris
```

尚未发布时，也可以在仓库中执行 `npm pack`，然后在消费项目中安装生成的 `.tgz` 文件。

## 快速使用

```ts
import { createIris, type KeywordRule } from 'kirakira-iris';

// 示例规则仅演示 API。请使用适合自己业务的审核词库。
const keywords: KeywordRule[] = [
  { word: '示例提示词', severity: 'general', comment: '建议检查语气。' },
  { word: '示例危险词', severity: 'dangerous', comment: '请结合上下文判断。' },
  { word: '示例极危词', severity: 'extreme', category: 'custom', id: 'rule-3' },
];

const iris = createIris({
  keywords,
  keywordFilter: true,
  aiFilter: true,
  ai: {
    // 自动读取 OPENROUTER_API_KEY；也可显式传入 apiKey 字符串。
    model: 'nvidia/nemotron-3.5-content-safety:free',
  },
});

const result = await iris.moderate('这里有示例危\n-险词，需要结合语境审核。');
console.log(result.isIllegal, result.needsReview);
console.log(result.keywordResult.matches);
console.log(result.aiResult);
```

CommonJS：

```js
const { createIris } = require('kirakira-iris');
```

## 默认判断规则

`isIllegal: true` 表示应用应拒绝或拦截这段内容；这是业务审核结论。`aiResult.result: true` 同样表示不安全，`false` 表示安全，`null` 表示未得到完整 AI 结论。

| 情况 | 默认行为 |
| --- | --- |
| 命中一般关键词 | 记录命中与评论，不拦截，不触发 AI |
| 命中危险或极度危险关键词 | 发送完整原文给 AI；归一化后不同且非空时，再审核归一化文本 |
| 已配置词库，但没有达到危险等级 | 跳过 AI，使用关键词维度的判断 |
| 关闭关键词过滤，或词库为空 | AI 直接审核所有非空输入 |
| 关闭 AI 过滤 | 危险和极度危险关键词直接产生拒绝结果 |
| 两个过滤都关闭 | `isIllegal: false`，两个维度均为 `disabled` |
| AI 完整返回 | 默认以 AI 结论为准，可解除关键词误报 |
| AI 超时、缺少密钥、限流、响应异常 | 默认拦截，`needsReview: true`，AI 结果为 `null` |

原文和归一化文本的 AI 结论只要有一个不安全，AI 维度就判为不安全。默认最多两次请求，不自动重试、不切换到付费模型。`reviewNormalized: false` 可以只审原文。

若希望任意维度判为不安全就拒绝，设置 `decisionMode: 'any'`。若希望不依赖词库覆盖率，设置 `ai.trigger: 'always'`，每段非空内容都经过 AI。关键词触发模式的审核覆盖范围取决于调用者提供的词库。

## 返回结果与位置

```ts
const iris = createIris({
  aiFilter: false,
  keywords: [{ word: '危险词', severity: 'dangerous' }],
});

const source = '前危\n险词后';
const result = await iris.moderate(source);
```

关键字段如下，`matches` 包含全部命中：

```js
{
  isIllegal: true,
  needsReview: false,
  decisionSource: 'keyword',
  keywordResult: {
    enabled: true,
    status: 'completed',
    hit: true,
    hite: true,
    hitWord: '危险词',
    hiteWord: '危险词',
    isIllegal: true,
    severity: 'dangerous',
    comment: '命中危险关键词“危险词”。',
    normalizeString: '前危险词后',
    wordStartInSource: 1,
    wordEndInSource: 5,
    wordStartInNormalize: 1,
    wordEndInNormalize: 4,
    matches: [/* KeywordMatch：所有命中及各自的位置、等级、评论 */],
  },
  aiResult: {
    enabled: false,
    status: 'disabled',
    result: null,
    comment: 'AI 过滤已关闭。',
    model: 'nvidia/nemotron-3.5-content-safety:free',
    categories: [],
    assessments: [],
    skipReason: 'disabled',
    error: null,
  },
}
```

- 所有位置采用 **JavaScript UTF-16 下标，左闭右开 `[start, end)`**，可直接用于 `source.slice(start, end)`。Emoji 和其他辅助平面字符可能占两个下标。
- `hite` / `hiteWord` 为兼容原始接口草案保留的别名，新代码建议使用 `hit` / `hitWord`。
- 汇总字段取最高风险的命中；风险相同时取最靠前的位置。`matches` 按原文位置排序，保留重复出现和重叠命中。
- 同一规则、相同原文范围及相同归一化范围的双路命中会合并，`matchedIn` 为 `['source', 'normalized']`。
- 每条命中还包括 `ruleIndex`、`id`、`category`、`sourceText`、`normalizedText` 和 `comment`。
- 没有命中时，关键词为 `null`，位置均为 `-1`，列表为空。只包含符号的规则可通过原文命中，归一化位置为 `-1`。
- 兼容字符展开时，例如 `ﬃ` → `ffi`，多个归一化字符会对应同一个原文字符；不同归一化位置仍保留为不同命中。

## Normalize 细节

调用 `normalizeText(source)` 可独立得到 `{ source, normalizeString, sourceMap }`。`sourceMap` 为每个归一化 UTF-16 单元记录原文的 `{ start, end }`。

处理包含 NFKC 兼容归一化、小写化、Unicode 标点/符号/分隔符/控制字符/默认不可见字符的移除。先清除插入的间隔，再按字素组合，因而支持 `e + 零宽字符 + 组合重音`、被符号拆开的 Hangul，以及全角字符。词库中的关键词也采用相同归一化规则。

原文匹配为精确字面匹配；归一化匹配补充大小写、全角和间隔处理。保留有语言意义的重音与组合标记，不包含繁简转换、拼音/谐音替换或跨文字系统的形似字转换。去除所有符号及空白可能连接原本不同的词，因此建议保留 AI 语境复核。

```ts
import { normalizeText, mapNormalizedRange, mapSourceRange } from 'kirakira-iris';

const text = normalizeText('前危\n险词后');
const sourceSpan = mapNormalizedRange(text, 1, 4); // { start: 1, end: 5 }
const normalizedSpan = mapSourceRange(text, 1, 5); // { start: 1, end: 4 }
```

## 配置

| `IrisOptions` | 默认值 | 用途 |
| --- | --- | --- |
| `keywords` | `[]` | `KeywordRule[]`，没有内置生产黑名单 |
| `keywordFilter` | `true` | 开启关键词检查 |
| `aiFilter` | `true` | 开启 AI 检查；仅实际请求时需要密钥 |
| `blockSeverity` | `'dangerous'` | 关键词维度的拦截阈值 |
| `decisionMode` | `'ai-priority'` | `'ai-priority'` 或 `'any'` |
| `maxInputLength` | `100000` | 原文 UTF-16 长度上限；超限抛出 `RangeError` |
| `maxMatches` | `10000` | 命中数量上限；超限抛错，不返回被截断的审核结论 |

| `AIOptions`（`ai` 字段） | 默认值 | 用途 |
| --- | --- | --- |
| `apiKey` | `OPENROUTER_API_KEY` | OpenRouter token，仅从服务端使用 |
| `model` | `nvidia/nemotron-3.5-content-safety:free` | 任何适合审核的 OpenRouter 模型标识 |
| `protocol` | `'auto'` | NVIDIA 内容安全模型使用原生标签，其他模型使用 JSON；可显式指定 `'nemotron'` / `'json'` |
| `trigger` | `'keyword'` | `'always'` 可始终审核；关键词关闭或词库为空时也始终审核 |
| `minSeverity` | `'dangerous'` | 触发 AI 的关键词风险阈值，与 `blockSeverity` 独立 |
| `reviewNormalized` | `true` | 同时审核与原文不同的非空归一化文本 |
| `timeoutMs` | `30000` | 每次请求超时，覆盖获取响应和读取响应体 |
| `maxTokens` | `512` | 每次 AI 响应 token 上限；截断响应视为错误 |
| `onError` | `'block'` | `'block'` / `'keyword-only'` / `'throw'` |
| `policy` | 无 | JSON 协议的附加业务审核政策 |
| `structuredOutput` | `false` | 为支持该功能的 JSON 模型启用 JSON Schema |
| `fetch` | 全局 `fetch` | 注入测试或自定义传输，请求地址固定为 OpenRouter |

调用级开关和取消：

```ts
await iris.moderate('待审核内容', { keywordFilter: false, aiFilter: true });
await iris.moderate('待审核内容', { signal: AbortSignal.timeout(10_000) });

// 同步检查，绝不发起 AI 请求。
const keywordsOnly = iris.checkKeywords('待审核内容');
```

`checkKeywords` 遵循实例上的 `keywordFilter`。实例可复用，词库在创建时编译，修改词库后应重新创建实例。

## AI 协议和错误

默认模型已在 2026-09-09 通过 [OpenRouter 模型目录](https://openrouter.ai/nvidia/nemotron-3.5-content-safety:free)及模型 API 确认有免费端点。免费端点的可用性和限流由提供商管理。

按照 [NVIDIA 模型说明](https://huggingface.co/nvidia/Nemotron-3.5-Content-Safety)，原生模式直接发送 `user` 文本，并解析 `User Safety`、可选的 `Response Safety`、`Safety Categories`。仅 `User Safety` 决定这段输入的判断。原生标签没有自由评论时，包会根据标签和类别生成中文说明。

默认免费模型不支持强制 JSON Schema，因此不向其发送 `response_format`。切换到普通聊天模型时，包使用系统审核指令和 JSON 输入，并验证 `{ result: boolean, comment: string, categories?: string[] }`。需要自定义政策时，请选择适合指令跟随的模型；原生协议不接受 `policy` 或 `structuredOutput`，避免配置被静默忽略。[OpenRouter 结构化输出说明](https://openrouter.ai/docs/guides/features/structured-outputs)

`aiResult.status` 为 `completed` / `skipped` / `disabled` / `error`；`skipReason` 区分关闭、未达阈值与空输入。已完成的每个 AI 审核记录保留在 `assessments` 中，包括输入版本、实际模型、请求 ID、类别和评论。

错误码包括 `MISSING_API_KEY`、`HTTP_ERROR`、`API_ERROR`、`INVALID_RESPONSE`、`TIMEOUT`、`ABORTED`、`NETWORK_ERROR`。不将提供商错误体、token 或未解析的模型输出放入错误信息。

- `onError: 'block'`：默认 `isIllegal: true`、`needsReview: true`。
- `onError: 'keyword-only'`：回退关键词判断，仍为 `needsReview: true`；先前输入版本已被 AI 确认不安全时仍会拦截。
- `onError: 'throw'`：抛出带 `code`、`status`、`retryable` 的 `IrisAIError`。

AI 结果为 `null` 或 `needsReview: true` 时，调用方应按自己的复核流程处理。输入及关键词会保存在返回值中；库不会自行记录日志。启用 AI 会将全文及可选归一化文本发送给 OpenRouter。实际审核准确率需要使用业务样本评估；本仓库的自动化测试模拟 API，不需要真实 token。

## 构建、验证和 npm 发布

```sh
npm run build          # dist/esm、dist/cjs 及各自的类型声明
npm run check          # 构建 + ESM/CJS 类型消费验证 + 自动化测试
npm pack --dry-run     # 查看 npm 包实际包含的文件
```

仅 `dist`、README、许可证及 npm 必需元数据进入发布包，源码、测试、工作流和环境文件不打包。CI 在 Ubuntu / Windows 与 Node 22 / 24 的四种组合下检查。

### 本地一键发布

首次发布前，使用有权发布 `kirakira-iris` 的 npm 账号登录：

```sh
npm login
npm run release
```

`release` 执行公开 npm 发布，发布前自动构建、检查类型并测试。不需要 OpenRouter token。后续版本先修改版本号，例如 `npm version patch`，然后再次运行 `npm run release`。包名如需变更，也应同步更新 `package.json`、锁文件、文档和类型测试中的导入名。

### GitHub Actions 发布

已提供 `.github/workflows/publish.yml`，支持发布 GitHub Release 自动触发，或在 Actions 页面手动运行。

推荐配置 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)：

1. 首次从本地发布包后，在 npm 包设置中添加 GitHub Actions trusted publisher。
2. Organization / user 填 `KIRAKIRA-DOUGA`，Repository 填 `KIRAKIRA-Iris`，Workflow filename 填 `publish.yml`。本工作流不设置 GitHub environment，Environment 留空。允许直接 `npm publish`。
3. 将版本提交到 `main`，创建与 `package.json` 完全一致的版本 tag，例如 `v0.1.0`，然后发布对应 GitHub Release；也可在 Actions 手动选择该 tag 运行。

工作流使用 Node 24（附带支持 OIDC 的 npm）、`id-token: write`，无需保存长期 npm token。也支持配置仓库 Secret `NPM_TOKEN` 作为首次发布或无法使用 OIDC 时的回退；需要具有目标包发布权限的 npm granular access token，并符合账号的 2FA 要求。公开包从私有 GitHub 仓库发布时，不强制生成不受支持的 provenance。

发布前检查 tag 与版本号是否一致，只接受稳定版本；默认分支上直接点运行会因 tag 不匹配而停止。发布已存在的版本也会被 npm 拒绝。创建源码仓库和提交代码不会自动发布到 npm。

## License

BSD-3-Clause。
