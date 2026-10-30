# DSH Prompt Translation

中文 | [English](README.en.md)

适用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的插件：按需翻译用户提示词、模型返回的思考内容和回答。

在多语言对话中，输入语言、模型生成语言和阅读语言可能不同。本插件把翻译接入 DSH 的对话流程，并提供可随时修改的设置：

1. 在「插件 → dsh-prompt-translation」中配置原始语言、目标语言和翻译方式；
2. 分别选择是否翻译用户提示词、思考内容和输出内容；
3. 在输入框「权限」图标右侧使用「翻译」菜单，快捷启停翻译并切换语言。

插件由两半组成：Host 半端负责翻译接口、已有模型调用和对话拦截；Web 客户端半端提供设置卡片和快捷菜单。全部用户配置独立保存在 `~/.dsh/prompt-translation.yml`，文件顶层提供共享服务配置和新会话默认值；输入框快捷菜单按会话保存覆盖，修改后无需重启插件。Profile 的 `cordis.patch.yml` 仅用于插件组合和首次缺省回退，不承载用户修改。

## 为什么需要

不同任务对翻译的需求不同，单纯要求主模型“用某种语言回答”无法覆盖所有环节：

- **跨语言输入**：发送前将用户提示词转换成目标语言，同时保留系统提示词和附件结构。
- **阅读模型输出**：只翻译思考与回答，保留用户原始输入。
- **复用已有服务**：选择传统翻译 API，或使用 DSH 中已有的提供商、模型和推理强度配置。
- **临时切换语言**：在输入框直接调整，无需离开当前对话反复打开设置。

插件提供内容级开关，不需要修改 Agent loop 或在每条提示词里重复附加翻译指令。

## 特性

- **独立内容开关**：用户提示词、思考内容和输出内容分别控制，系统提示词不翻译。
- **自动检测语言**：原始语言支持自动检测；目标语言明确指定，提供常用语言选项。
- **传统翻译与智能体翻译**：支持百度、Google、DeepL、微软官方 API，以及 DSH 已配置的模型。
- **输入框快捷菜单**：「权限」右侧的翻译按钮支持启停和语言切换，每个会话独立保存。
- **独立持久化配置**：通过插件自有 API 读写独立 YAML，以 revision 检测冲突并在重读后重试一次；文件以 0600 权限原子替换。
- **原文展示与翻译对照**：聊天气泡显示用户原文；轨迹中的用户记录可在「预览」和「原始内容」查看原文、实际发送的译文及语言方向；助手记录中的思考和回答也分别显示翻译前后内容。
- **结构化内容保护**：工具调用参数、工具结果、注入上下文、图片和文件块保持原样。

## 安装

插件版本与 DSH 版本对应关系矩阵如下：

| 插件版本 | 适配的 DSH 版本 |
| --- | --- |
| 0.1.4 | `0.2.0-rc.x / 0.2.1-rc.1 / 0.2.1-rc.2 / 0.2.1-rc.3 / 0.2.1-rc.4 / 0.2.1-rc.5` |
| 0.1.3 | `0.2.0-rc.x / 0.2.1-rc.1 / 0.2.1-rc.2 / 0.2.1-rc.3 / 0.2.1-rc.4` |
| 0.1.2 | `0.2.0-rc.x / 0.2.1-rc.1 / 0.2.1-rc.2 / 0.2.1-rc.3` |
| 0.1.1 | `0.2.0-rc.x / 0.2.1-rc.1 / 0.2.1-rc.2` |
| 0.1.0 | `0.2.0-rc.x / 0.2.1-rc.1 / 0.2.1-rc.2` |

以下方式都将插件加入指定 Profile（以 `web` 为例）。本包包含 `cordis.patch.yml`，DSH 会自动挂载 Host 半端并加载 Web 客户端模块，无需另写组合配置。

### 从 npm 安装

包发布后执行：

```sh
dsh plugin --profile web add dsh-prompt-translation
```

### 从 GitHub 安装

仓库发布后执行：

```sh
dsh plugin --profile web add github:EPCN-fla/dsh-prompt-translation
```

Git 源安装需要允许包管理器执行 `prepare`，安装开发依赖并构建 `lib/`。若禁止安装脚本，请使用预构建的 npm 包或 tarball。

### 从 tarball 安装

```sh
git clone https://github.com/EPCN-fla/dsh-prompt-translation.git
cd dsh-prompt-translation
npm ci --ignore-scripts
npm run build
npm pack
dsh plugin --profile web add ./dsh-prompt-translation-<version>.tgz
```

CI 不上传安装包或测试证据，也不创建 GitHub Release；需要本地安装包时请按上述步骤构建。

### 本地开发

开发期可以指向已构建的工作副本，每次修改源码后重新执行 `npm run build`：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-prompt-translation
```

安装后重启 DSH Web 并刷新页面。执行 `dsh --profile web --dump-config`，确认输出包含 ID 为 `prompt-translation` 的插件行。

## 使用

### 1. 配置翻译方式

打开「插件 → dsh-prompt-translation」。插件默认关闭翻译；翻译卡片固定展开，可直接选择翻译类型并配置服务。卡片中的「启用翻译」和语言选项是新会话及未单独设置会话的 全局默认值；保存服务配置不会覆盖已有会话的快捷选择。卡片底部可保存设置或放弃修改。

| 传统翻译服务 | 所需配置 | 接口 |
| --- | --- | --- |
| 百度 | App ID、密钥 | 官方通用翻译 API |
| Google | Cloud Translation API Key | Basic v2 |
| DeepL | API Key、Free / Pro 选择 | `/v2/translate` |
| 微软 | Translator API Key、资源区域（按资源要求） | Translator v3 |

密钥通过插件自有 API 交给 Host 并以 0600 权限保存在独立 YAML 中；浏览器只读取脱敏值，不直接调用供应商。密钥输入框留空保留已有值，切换服务时必须填写新服务的密钥。删除凭据可将文件中的 `apiKey` 设为空字符串。

选择「智能体」时，填写已有提供商 ID、模型 ID，以及可选的推理强度。候选项来自 DSH 模型目录，也支持手动填写已有 ID。推理强度必须受该模型支持，留空使用模型默认值。辅助翻译调用不提供工具，不会再次进入翻译链路，会产生额外模型请求和费用。自动回译会额外调用所选服务检测本轮用户语言；传统 API 读取检测元数据，模型模式使用独立语言检测请求。

### 2. 选择语言和翻译内容

选择「原始语言 → 目标语言」，再独立勾选用户提示词、思考内容和输出内容。原始语言可设为自动检测。

**用户提示词按“原始 → 目标”翻译，思考与回答译回原始语言。** 例如 `简体中文 → 日本語` 会把输入译成日语，并把选中的思考、回答译回中文。原始语言为自动检测时，使用本轮用户输入确定回译语言；不同会话互不影响。无法可靠检测时会报错，请明确选择原始语言。只需要回译时可以关闭用户提示词翻译。

**同语言时是否调用翻译服务：** 以下规则适用于已启用相应翻译开关的非空文本。

| 场景 | 当前行为 |
| --- | --- |
| 显式选择相同原始和目标语言，例如 `简体中文 → 简体中文` | 用户提示词直接跳过翻译，不调用翻译 API 或模型。 |
| 原始语言为自动检测 | 仍会调用所选翻译服务；即使检测结果与目标语言相同，目前也不会据此跳过后续提示词翻译。 |
| 思考与回答回译 | 使用 `自动检测 → 本轮用户语言`，即使模型已经使用该语言输出，仍会调用翻译服务。 |

翻译前后文本相同不代表没有调用服务：可能已经发出请求，只是返回了相同文本，仍可能产生延迟和费用。

语言选项包括简体中文、繁体中文、英语、日语、韩语、法语、德语、西班牙语、俄语、葡萄牙语、意大利语、阿拉伯语和印地语；实际可用性取决于供应商。

在已有会话的输入框左下角，点击「权限」右侧的翻译图标，可以快捷启停和切换语言。图标划线表示关闭，无划线表示开启；弹窗使用“语言下拉框 → 语言下拉框”单行布局。修改只作用于**当前会话**，按 DSH `sessionId` 持久化，切换会话或重启宿主后仍保留；其他会话不受影响，新会话继承 全局默认值。

### 3. 生效时机与优先级

- 保存成功后，下一次用户提交读取新配置；一轮提示词与回译共用该轮的配置快照，正在生成的回答不会被后续编辑切换服务或回译语言。
- 用户提示词在 `agent/pre-step` 阶段翻译，保留原消息 ID；历史提示词不会在后续工具步骤重复翻译。
- 系统提示词、工具调用参数、工具结果、注入上下文、图片和文件块不参与翻译。标题生成、压缩等辅助模型调用不进入本插件的输出翻译。
- 思考与输出在完整文本块生成后翻译，再交给 DSH 展示和持久化；启用的内容不再逐 token 展示。
- 输入翻译或语言检测失败时，原始用户消息仍会记录并显示，然后在调用主模型前明确报错；不会静默将原文继续发送。取消会传播到翻译调用，卸载会撤销监听器并取消进行中的翻译。

## 配置存储格式

设置命名空间和 Loader 行 ID 均为 `prompt-translation`。全部用户设置统一保存在 `~/.dsh/prompt-translation.yml`，例如：

```yaml
enabled: false
source: auto
target: zh
type: agent
provider: your-existing-provider
model: your-existing-model
reasoningEffort: low
userPrompt: false
reasoning: true
output: true
timeoutMs: 60000
maxChars: 2000
sessionOverrides:
  <session-id>:
    enabled: true
    source: auto
    target: en
```

提供商、模型和推理强度需要替换成实际支持的值；使用默认推理强度时删除 `reasoningEffort`。部署方也可以在组合层同一插件行的 `config` 中预置静态回退配置。独立文件不存在时读取该回退；文件存在后，文件是唯一用户配置来源，所有修改都只写入该文件，不会写回 Profile。测试或启动器可通过 `DSH_HOME` 隔离此文件。`sessionOverrides` 的键是实际 DSH `sessionId`，每个条目保存该会话完整的 `enabled` / `source` / `target` 快捷快照。删除某会话的条目可让它重新继承全局默认值；已删除会话留下的条目不影响其他会话，可以手动清理。

传统翻译配置使用 `type: traditional`，并填写 `engine`（`baidu` / `google` / `deepl` / `microsoft`）、`apiKey`，以及对应服务的 `appId`、`region` 或 `deeplFree`。不要将真实密钥提交到仓库。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 新会话及未覆盖会话默认是否启用翻译 |
| `sessionOverrides` | `{}` | 按 `sessionId` 保存当前会话的 `enabled` / `source` / `target` 快捷覆盖 |
| `source` / `target` | `auto` / `en` | 原始语言与目标语言 |
| `type` / `engine` | `traditional` / `google` | 翻译类型与传统服务 |
| `userPrompt` / `reasoning` / `output` | `true` / `false` / `false` | 三类内容开关 |
| `timeoutMs` | `60000` | 单个文本块翻译的总超时，范围 1000–300000 毫秒 |
| `maxChars` | `2000` | 单次请求 Unicode 字符上限，范围 100–4000；百度还受 6000 UTF-8 字节上限约束 |

## 支持范围与已知限制

- Web 界面提供设置和快捷按钮。其他界面可使用 Host 翻译链路，但没有本插件的快捷菜单；Windows/macOS 未单独验收。
- 新处理的用户提示词同时保存原文与实际发送的译文。聊天气泡显示原文，主模型及后续模型历史仍使用译文；轨迹选择用户记录后，「预览」和「原始内容」显示两者。「原始内容」是该记录的文本块对照，精确持久化结构可在来源数据中查看。旧消息未保存原文，不能事后可靠恢复。
- 禁用/卸载客户端后，宿主默认渲染器会显示模型侧译文；原文元数据仍留在日志，重新启用后恢复原文展示。已生成的思考、回答依旧持久化为译文。
- 新完成翻译的助手思考和回答块会保存原文，轨迹选择「助手」记录后，可在「预览」和「原始内容」查看翻译前后内容；预览中的思考区域可能需要展开。聊天继续只展示译文，工具调用不增加翻译对照。没有翻译或旧记录未保存原文时保持原样。
- 文本变化后会清除与原文绑定的供应商 replay 元数据。依赖原生推理签名的模型续聊尚未进行真实供应商验证。
- 只翻译供应商实际返回的思考文本，无法获取未公开的内部推理。完整块翻译会增加展示延迟。
- 长文本优先按空白、句子或段落边界分段。传统 API 不保证代码和 Markdown 逐字不变；模型提示会要求保留代码、链接和占位符，但质量仍取决于模型。
- 快捷按钮通过官方左侧插槽挂载，再按当前输入框的权限 `data-slot` 锚点定位；锚点缺失时回退到原插槽。其他未验证的宿主版本可能改变布局。
- 六个已验证版本的完整 Web 测试使用真实宿主服务，仅外部模型为确定性适配器，不证明真实供应商的翻译质量、限流、账单或签名续聊。

可以在快捷菜单关闭当前会话的翻译，或在 Plugins 页面禁用插件。卸载后重启 Profile 并刷新页面，已保存的译文会保留：

```sh
dsh plugin --profile web remove dsh-prompt-translation
```

## 开发

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:scripts
npm run build
npm run pack:check
npm run test:browser

# 完整 Web 验证：安装精确版本的隔离宿主，再运行
npm run host:install -- 0.2.1-rc.5
npm run test:host -- 0.2.1-rc.5
```

`npm run check` 汇总类型检查、测试、构建和安装包检查。构建输出在 `lib/`，安装包与证据在 `artifacts/`。Chrome 默认路径可通过 `CHROME_PATH` 覆盖，Playwright channel 可通过 `CHROME_CHANNEL` 覆盖。`.npmrc` 使用 `legacy-peer-deps=true`，宿主安装脚本按精确版本补齐必需 peer，避免混装 DSH 预发布版本。

| 文件 | 覆盖 |
| --- | --- |
| `tests/translation.test.ts` | 四家 API 协议、语言映射、分段、脱敏、模型调用和取消 |
| `tests/direction.test.ts` | 回译方向、供应商语言检测、会话隔离、失败保留与取消 |
| `tests/presentation.test.ts` | 原文持久化、轨迹对照、历史消息兼容与显示适配器卸载 |
| `tests/pipeline.test.ts` | 用户来源过滤、消息身份、流式文本块和工具数据保护 |
| `tests/client.test.tsx` | 配置保存、会话独立性、冲突重试、密钥保护、异步竞态与控件清理 |
| `tests/loader.test.ts` | 真实 Cordis Loader 加载构建入口、翻译链路和卸载 |
| `scripts/ci.test.mjs` | CI 矩阵、依赖版本选择、失败汇总和触发策略 |
| `scripts/release-*.test.mjs` | 发布版本策略、标签匹配与注册表错误门禁 |
| `scripts/browser-smoke.mjs` | 构建后的浏览器模块、按钮位置、桌面与移动视口 |
| `scripts/full-host-smoke.mjs` | 精确版本的完整 Web 冷启动、独立 YAML 重载、双会话独立开关和用户回合 |

CI 仅在 PR 和 `v*` 标签推送时触发，普通分支推送不运行。PR 从 `package.json` 的 `dshCompatibility` 读取精确版本矩阵，每个 DSH 版本独立一个 job，选择对应 DSH/Cordis 开发依赖后依次验证 Node 22、24（复用同一份锁文件）；包含类型检查、单元及脚本测试、构建、安装包和浏览器检查，并在 Node 22 上运行完整 Web 宿主检查。Node 22 失败不会阻止 Node 24 验证，结果写入 Actions Summary。`v*` 标签独立执行版本门禁、构建和 npm OIDC 发布，不运行测试，也不依赖 PR job；打标签前应确保对应提交的 PR 检查通过。预发布使用 `next`，稳定版使用 `latest` 并禁止版本回退。CI 不上传 artifacts，也不创建 GitHub Release；临时安装包和测试证据仅留在 runner。

## 许可证

[MIT](LICENSE)
