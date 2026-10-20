# DSH Prompt Translation

[中文](README.md) | English

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) that translates user prompts, model-provided reasoning, and responses on demand.

In multilingual conversations, the language you write, the language a model generates, and the language you prefer to read may differ. This plugin integrates translation into the DSH conversation flow with settings you can change at runtime:

1. Configure the source language, target language, and translation method under **Plugins → dsh-prompt-translation**;
2. Independently enable translation for user prompts, reasoning, and output;
3. Use the **翻译** (Translation) menu to the right of the permission control to toggle translation and switch languages.

The plugin has two halves: the Host handles translation APIs, existing-model calls, and conversation interception; the Web client contributes the settings card and quick menu. Configuration lives in the current DSH Profile's `cordis.patch.yml`, with no separate storage. Settings apply to every session in that Profile and take effect without restarting the plugin.

## Why

Different tasks require translation at different stages. Asking the main model to “answer in a particular language” does not cover every stage:

- **Cross-language input**: translate user prompts before sending them while preserving system prompts and attachment structure.
- **Reading model output**: translate reasoning and responses while keeping the user's original input.
- **Reusing existing services**: choose a traditional translation API or an existing DSH provider, model, and reasoning effort.
- **Switching languages temporarily**: adjust translation directly in the composer without repeatedly leaving the conversation for settings.

The plugin provides separate content switches without modifying the Agent loop or requiring translation instructions in every prompt.

## Features

- **Independent content switches**: control user prompts, reasoning, and output separately. System prompts are never translated.
- **Automatic language detection**: detect the source language automatically and explicitly choose a target from common language options.
- **Traditional and model translation**: use official Baidu, Google, DeepL, or Microsoft APIs, or models already configured in DSH.
- **Composer quick menu**: toggle translation and switch languages next to the permission control.
- **Persistent live settings**: save through DSH's settings service, with one read-and-retry attempt on concurrent-write conflicts.
- **Original prompts and translation comparisons**: chat bubbles display the original prompt; user records in Trajectory show the original, the actual sent translation, and direction in both Preview and Raw. Assistant records also compare original and translated reasoning and answers.
- **Preserved structured content**: tool arguments, tool results, injected context, images, and file blocks remain unchanged.

## Installation

The correspondence matrix between plugin versions and DSH versions is as follows:

| Plugin version | Compatible DSH versions |
| --- | --- |
| 0.1.0 | ≥0.2.0-rc.1 <0.2.0 \|\| ≥0.2.1-rc.1 <0.2.1 |

All methods below add the plugin to a selected Profile (`web` in these examples). The package includes `cordis.patch.yml`, so DSH mounts the Host plugin and loads its Web client module automatically; no additional composition configuration is required.

### From npm

After the package is published:

```sh
dsh plugin --profile web add dsh-prompt-translation
```

### From GitHub

After the repository is published:

```sh
dsh plugin --profile web add github:EPCN-fla/dsh-prompt-translation
```

Git-source installation requires the package manager to run `prepare`, install development dependencies, and build `lib/`. If installation scripts are disabled, use the prebuilt npm package or a tarball.

### From tarball

```sh
git clone https://github.com/EPCN-fla/dsh-prompt-translation.git
cd dsh-prompt-translation
npm ci --ignore-scripts
npm run build
npm pack
dsh plugin --profile web add ./dsh-prompt-translation-<version>.tgz
```

Alternatively, download the `release-package` artifact from GitHub Actions, extract the prebuilt tarball, and run the final installation command. CI does not create GitHub Releases.

### Local development

Point the CLI at a built working copy and run `npm run build` again after source changes:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-prompt-translation
```

Restart DSH Web and refresh the page after installation. Run `dsh --profile web --dump-config` and confirm that the output contains the plugin row with ID `prompt-translation`.

## Usage

### 1. Configure the translation method

Open **Plugins → dsh-prompt-translation**. Translation is disabled by default. Expand the translation card, choose a translation type, configure the service, then check **启用翻译** (Enable translation) and save. Use the card footer to save or discard changes.

| Traditional translation service | Required settings | API |
| --- | --- | --- |
| Baidu | App ID and secret key | Official General Translation API |
| Google | Cloud Translation API key | Basic v2 |
| DeepL | API key and Free / Pro selection | `/v2/translate` |
| Microsoft | Translator API key and resource region, where required | Translator v3 |

Credentials are sent to the Host through DSH settings and stored in a secret field; the browser never calls the provider directly. Leaving the key input blank preserves the existing value. Switching services requires a new service key. To delete credentials, clear `apiKey` in DSH's component configuration.

For **智能体** (Agent/model translation), enter an existing provider ID, model ID, and optional reasoning effort. Suggestions come from the DSH model catalog; existing IDs can also be entered manually. The effort must be supported by that model; leave it blank to use the model default. Auxiliary translation calls have no tools, do not recursively enter the translation pipeline, and incur additional model requests and costs. Automatic return translation also calls the selected service to detect the language of this turn’s user input: traditional services provide detection metadata, while model mode uses a separate language-detection request.

### 2. Select languages and content

Choose **source language → target language**, then independently select user prompts, reasoning, and output. The source language can be detected automatically.

**User prompts follow source → target; reasoning and responses are translated back into the source language.** For example, `Simplified Chinese → Japanese` sends Japanese prompts and translates selected reasoning and responses back into Chinese. Automatic source detection uses this turn’s user input to choose the return language, independently for each session. If detection is inconclusive, the turn reports an error; select an explicit source language. Disable user-prompt translation if you only need translated responses.

**Whether matching languages skip a translation call:** These rules apply to non-empty text when the corresponding translation switch is enabled.

| Scenario | Current behavior |
| --- | --- |
| Explicitly selecting the same source and target, such as `Simplified Chinese → Simplified Chinese` | User-prompt translation is skipped without calling a translation API or model. |
| Automatic source detection | The selected translation service is still called. Even if the detected language matches the target, that result does not currently skip subsequent prompt translation. |
| Return translation of reasoning and responses | Uses `automatic detection → this turn’s user language`. The translation service is still called even when the model already outputs that language. |

Identical text before and after translation does not prove that no request was made: the service may have returned the same text, still adding latency and potential costs.

Options include Simplified Chinese, Traditional Chinese, English, Japanese, Korean, French, German, Spanish, Russian, Portuguese, Italian, Arabic, and Hindi. Actual availability depends on the provider.

In an existing session, click the translation icon to the right of the permission control at the lower left of the composer. A slash indicates disabled translation; an unslashed icon indicates enabled translation. The popup places both language dropdowns on one row, separated by an arrow. Changes affect **all sessions in the current Profile**.

### 3. Effective timing and precedence

- After saving, the next user submission reads the new settings. Prompt translation and return translation share one snapshot for that turn; later edits cannot change the active answer’s service or return language.
- User prompts are translated during `agent/pre-step`, retaining their original message IDs. Historical prompts are not repeatedly translated during later tool steps.
- System prompts, tool arguments, tool results, injected context, images, and file blocks are not translated. Auxiliary model calls such as title generation and compaction do not enter this plugin's output translation.
- Reasoning and output are translated after a complete text block has been generated, then passed to DSH for display and persistence. Enabled content is no longer displayed token by token.
- If input translation or language detection fails, the original user message is still recorded and displayed, then an explicit error stops the turn before the main model is called. Cancellation propagates to translation calls; unloading removes listeners and cancels in-flight translations.

## Storage format

Both the settings namespace and Loader row ID are `prompt-translation`. User settings live in the row's `config` field in the current Profile's `cordis.patch.yml`, for example:

```yaml
- id: prompt-translation
  name: dsh-prompt-translation
  config:
    enabled: true
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
```

Replace the provider, model, and effort with supported values. Remove `reasoningEffort` to use the model default. Deployments can also seed configuration in the same plugin row's `config` field in the composition layer.

Traditional translation uses `type: traditional`, `engine` (`baidu` / `google` / `deepl` / `microsoft`), `apiKey`, and the service-specific `appId`, `region`, or `deeplFree`. Never commit real keys to the repository.

| Field | Default | Description |
| --- | --- | --- |
| `enabled` | `false` | Enable translation |
| `source` / `target` | `auto` / `en` | Source and target languages |
| `type` / `engine` | `traditional` / `google` | Translation type and traditional service |
| `userPrompt` / `reasoning` / `output` | `true` / `false` / `false` | Content switches |
| `timeoutMs` | `60000` | Total translation timeout per text block, from 1000 to 300000 milliseconds |
| `maxChars` | `2000` | Unicode characters per request, from 100 to 4000; Baidu also has a 6000-byte UTF-8 limit |

## Scope and known limitations

- Settings and quick controls are provided in the Web client. Other interfaces can use the Host translation pipeline but have no plugin quick menu. Windows and macOS have not been separately validated.
- Newly translated user prompts persist both the original and the actual sent translation. Chat shows the original, while the model and subsequent model history use the translation. Select a user record in Trajectory to compare both in Preview and Raw. Raw shows comparison text blocks; the exact persisted metadata can be inspected in Source. Older messages without original metadata cannot be reliably restored.
- Disabling/uninstalling the client restores the host’s default rendering of translated content. Original metadata remains in the log and is displayed again after re-enabling the plugin. Reasoning and answers remain stored as translated text.
- Newly completed assistant translations retain the original reasoning and answer text. Select an assistant record in Trajectory to compare both in Preview and Raw; expand Thinking in Preview if it is collapsed. Chat continues to show translated text only, and tool calls are not annotated. Untranslated blocks and older records without originals remain unchanged.
- Text changes clear provider replay metadata bound to the original content. Continuations that depend on native reasoning signatures have not been validated against real providers.
- Only reasoning actually returned by the provider can be translated; hidden internal reasoning is unavailable. Complete-block translation adds display latency.
- Long text is split preferentially at whitespace, sentence, or paragraph boundaries. Traditional APIs do not guarantee verbatim code or Markdown preservation. Model instructions request preservation of code, links, and placeholders, but quality still depends on the model.
- The quick control mounts through the official left composer slot and is positioned using the current composer's permission `data-slot` anchor. If that anchor disappears, it falls back to its original slot. Untested host versions may change the layout.
- Full Web tests for the four tested versions use real Host services with a deterministic external model adapter. They do not prove real-provider translation quality, rate limits, billing, or signature-based continuation.

Disable translation from the quick menu or disable the plugin on the Plugins page. To uninstall, run the following, restart the Profile, and refresh the page. Stored translations remain:

```sh
dsh plugin --profile web remove dsh-prompt-translation
```

## Development

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:scripts
npm run build
npm run pack:check
npm run test:browser

# Full Web validation: install an isolated exact-version host, then run it
npm run host:install -- 0.2.1-rc.2
npm run test:host -- 0.2.1-rc.2
```

`npm run check` combines type checking, tests, builds, and package inspection. Build outputs live in `lib/`; packages and evidence live in `artifacts/`. Override the default Chrome executable with `CHROME_PATH`. `.npmrc` sets `legacy-peer-deps=true`; the host installation script fills required peers from exact-version manifests to avoid mixing DSH prerelease versions.

| File | Coverage |
| --- | --- |
| `tests/translation.test.ts` | Four API protocols, language mapping, splitting, redaction, model calls, and cancellation |
| `tests/direction.test.ts` | Return direction, provider language detection, session isolation, failed-input retention, and cancellation |
| `tests/presentation.test.ts` | Persisted originals, trajectory comparisons, legacy messages, and presentation teardown |
| `tests/pipeline.test.ts` | User-source filtering, message identity, streamed text blocks, and tool-data preservation |
| `tests/client.test.tsx` | Settings writes, conflict retries, credential protection, async races, and control cleanup |
| `tests/loader.test.ts` | Built-entry loading through the real Cordis Loader, translation, and unloading |
| `scripts/release-*.test.mjs` | Version policy, registry failures, and artifact-integrity release gates |
| `scripts/browser-smoke.mjs` | Built browser module, control placement, desktop and mobile viewports |
| `scripts/full-host-smoke.mjs` | Exact-version full Web cold starts, settings reload, and a user turn |

CI validates Node 22/24 and runs full Web checks against the four tested DSH versions. PRs, `main` pushes, and manual runs only validate. A `v*` tag publishes the same tested artifact through npm OIDC after all checks pass. It does not create a GitHub Release; the package and checksum remain available as Actions artifacts.

## License

[MIT](LICENSE)
