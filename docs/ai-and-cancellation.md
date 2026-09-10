# AI 模型格式与取消审核

## 只传 API key 和模型名即可

```ts
const iris = createIris({
  keywords: ['示例关键词'],
  ai: {
    apiKey: 'your-openrouter-api-key',
    model: '供应商/模型ID', // 替换为实际可用的 OpenRouter 模型 ID
  },
});
```

使用默认安全模型时可以省略 `model`。切换普通聊天模型无需自行编写审核提示词、选择解析器或实现网络请求。Iris 自动选择响应格式、发送审核指令并校验结果；关键词、队列和 `pass / block / drop` 返回结构保持一致。

普通模型需要支持文本聊天，并能遵循审核指令和 JSON 输出要求。只支持向量嵌入、图片生成，或具有另一套固定标签格式的专用模型，不能仅靠模型名保证兼容。模型返回无法解析的内容时为 `drop` / `INVALID_RESPONSE`。

## 高级选项什么时候才需要？

普通接入可省略以下全部选项；它们不是切换模型的必填条件。

| 参数 | 作用 | 需要设置的情况 |
| --- | --- | --- |
| `protocol` | 手动选择标签或 JSON 解析；默认自动选择 | 模型别名无法识别，或需要覆盖自动选择 |
| `policy` | 在默认审核指令后追加应用规则，仅用于 JSON 路径 | 例如额外要求“屏蔽广告”；关键词匹配不受影响 |
| `structuredOutput` | 要求支持此功能的模型按 JSON Schema 输出 | 确定模型及服务端点支持，且需要约束输出格式 |
| `fetch` | 替换底层网络请求函数 | 接入自定义代理或编写不发真实请求的测试 |

`structuredOutput` 默认关闭，避免普通接入依赖额外的服务端能力；即使关闭，Iris 仍会提示返回 JSON 并校验结果。`fetch` 默认使用 Node.js 自带实现。下面说明这些默认适配为何存在。

## 为什么 NVIDIA 安全模型使用标签，其他模型使用 JSON？

OpenRouter 的 HTTP 请求和响应外层都是 JSON。这里讨论的是响应中 `choices[0].message.content` 的内容格式：它可能是一段标签文本，也可能是一段 JSON 字符串。

`nvidia/nemotron-3.5-content-safety:free` 是经过内容安全任务微调的专用模型。它已经学会接收待审核文本并输出安全标签，标准格式由 NVIDIA 定义，例如：

```text
User Safety: unsafe
Response Safety: safe
Safety Categories: Violence
```

`User Safety` 对应用户输入，`Response Safety` 对应被提交审核的模型回复，分类标签是可选信息。Iris 只提交用户原文，因此读取 `User Safety`：`safe` 转为 `pass`，`unsafe` 转为 `block`；不会用 `Response Safety` 推翻它，也不返回分类字段。参考 [NVIDIA 官方模型说明](https://huggingface.co/nvidia/Nemotron-3.5-Content-Safety#output)。

普通聊天模型通常没有这一套固定的审核标签格式。Iris 会提供审核指令，并明确要求返回：

```json
{"status":"pass","comment":"内容通过审核。"}
```

这是 **Iris 为普通聊天模型约定的格式**。不能理解为“所有非 NVIDIA 模型天生都返回 JSON”，也不是所有 NVIDIA 模型都使用安全标签。`protocol: 'auto'` 按模型 ID 中的 NVIDIA `content-safety` 命名选择标签解析，其余使用 JSON；可通过 `ai.protocol` 指定解析方式，但所选模型必须能遵循该方式。

两条路径都只把原文交给 AI。JSON 路径把原文放入 `content` 字段作为待审数据；转义换行等字符只是 JSON 传输编码，不会删除或归一化这些内容。

仅提示“返回 JSON”并不能保证任何模型都正确遵循。Iris 会校验 `status` 必须为 `pass` / `block`，且有非空说明；响应截断、缺字段或无法解析时返回 `drop` / `INVALID_RESPONSE`，不会推断为通过。可以对兼容模型开启 `ai.structuredOutput`，让请求携带 JSON Schema，并要求路由到支持相应参数的端点。支持程度取决于具体模型和服务端点，详见 [OpenRouter 结构化输出](https://openrouter.ai/docs/guides/features/structured-outputs)。

NVIDIA 模型本身也有自定义安全策略能力；当前 Iris 的标签路径使用其标准格式。Iris 的 `ai.policy` 和 `structuredOutput` 选项仅接入 JSON 路径，这属于本包的接口范围，不代表 NVIDIA 模型本身没有这些能力。

`assessments` 原本用于容纳多次审核的明细。现在一次调用仅审查一次原文，结论和说明直接位于 `AIResult`，因此不再保留这个数组。

## signal 在哪里使用？

`AbortSignal` 是 JavaScript / Node.js 的标准取消通知。调用者创建 `AbortController`，将它的 `signal` 传给审核函数；之后调用 `controller.abort()`，Iris 就收到取消通知。这个参数可省略，不是 API key，也不是回调函数。参考 [Node.js AbortController 文档](https://nodejs.org/api/globals.html#class-abortcontroller)。

```ts
// iris 是已经初始化的实例。
const controller = new AbortController();
const pending = iris.aiModerate('待审核原文', {
  signal: controller.signal,
});

// 在撤回按钮、服务端收到取消请求等事件中调用：
controller.abort();

const response = await pending;
// response.status === 'drop'
// response.error?.code === 'ABORTED'
```

适用场景包括用户撤回评论、内容被新版本替换、服务端发现客户端已断开，或应用不愿继续等待过期任务。页面关闭不会自动通知另一个进程中的 Iris；需要你的服务端把断开或取消事件连接到 `abort()`。

| 取消时所在阶段 | Iris 的处理 |
| --- | --- |
| 等待执行槽 | 移出队列，释放等待容量，不发送 AI 请求 |
| 已占用执行槽，等待限速额度 | 停止等待并释放执行槽，不发送 AI 请求 |
| 正在请求 AI 或读取响应 | 通知底层请求取消，结束本地等待并返回 `drop` |
| 已经完成 | 已返回的结果不受影响 |

已经发送给服务端的请求可能仍在服务端执行；本地取消不保证能撤销服务端处理或费用。同步关键词匹配不会被 `signal` 中断，`moderate` 已经取得的关键词命中也不会被取消清除。

还可以给整个等待过程设置期限：

```ts
const response = await iris.aiModerate('待审核原文', {
  signal: AbortSignal.timeout(5_000),
});
```

这个信号从创建时开始计时，包含排队、等待限速及请求过程。相比之下，`ai.timeoutMs` 从实际请求开始计时，不包含排队。外部 `signal` 超时在 Iris 中仍属于调用者取消，返回 `ABORTED`；`ai.timeoutMs` 到期返回 `TIMEOUT`，两者的 `status` 都是 `drop`。

一个信号取消后不能恢复；下一次独立审核应创建新控制器。若希望一组审核一起取消，可以让它们共用同一个信号。`clearAIQueue()` 则是批量清除这个实例的等待队列，不负责取消正在执行的审核。
