# DSH Prompt Translation

[中文](README.md) | English

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) that translates user prompts, model-provided reasoning, and responses on demand.

In multilingual conversations, the language you write, the language a model generates, and the language you prefer to read may differ. This plugin integrates translation into the DSH conversation flow with settings you can change at runtime:

1. Configure the source language, target language, and translation method under **Plugins → dsh-prompt-translation**;
2. Independently enable translation for user prompts, reasoning, and output;
3. Use the **翻译** (Translation) menu to the right of the permission control to toggle translation and switch languages.

The plugin has two halves: the Host handles translation APIs, existing-model calls, and conversation interception; the Web client contributes the settings card and quick menu. All user configuration lives independently in `~/.dsh/prompt-translation.yml`. Top-level file settings provide shared service configuration and defaults for new sessions; the composer quick menu stores overrides independently for each conversation and takes effect without restarting the plugin. The Profile `cordis.patch.yml` is used only for composition and initial fallback, never for user edits.

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
- **Composer quick menu**: toggle translation and switch languages next to the permission control, persisted independently for each conversation.
- **Independent persistent settings**: read and write a dedicated YAML through the plugin-owned API, detect conflicts by revision, retry once after rereading, and replace files atomically with 0600 permissions.
- **Original prompts and translation comparisons**: chat bubbles display the original prompt; user records in Trajectory show the original, the actual sent translation, and direction in both Preview and Raw. Assistant records also compare original and translated reasoning and answers.
- **Preserved structured content**: tool arguments, tool results, injected context, images, and file blocks remain unchanged.

## Installation

The correspondence matrix between plugin versions and DSH versions is as follows:

| Plugin version | Compatible DSH versions |
| --- | --- |
| 0.1.4 | `0.2.0-rc.x / 0.2.1-rc.1 / 0.2.1-rc.2 / 0.2.1-rc.3 / 0.2.1-rc.4 / 0.2.1-rc.5` |
| 0.1.3 | `0.2.0-rc.x / 0.2.1-rc.1 / 0.2.1-rc.2 / 0.2.1-rc.3 / 0.2.1-rc.4` |
| 0.1.2 | `0.2.0-rc.x / 0.2.1-rc.1 / 0.2.1-rc.2 / 0.2.1-rc.3` |
| 0.1.1 | `0.2.0-rc.x / 0.2.1-rc.1 / 0.2.1-rc.2` |
| 0.1.0 | `0.2.0-rc.x / 0.2.1-rc.1 / 0.2.1-rc.2` |

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

CI does not upload packages or test evidence and does not create GitHub Releases. For a local tarball, build it using the steps above.

### Local development

Point the CLI at a built working copy and run `npm run build` again after source changes:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-prompt-translation
```

Restart DSH Web and refresh the page after installation. Run `dsh --profile web --dump-config` and confirm that the output contains the plugin row with ID `prompt-translation`.

## Usage

### 1. Configure the translation method

Open **Plugins → dsh-prompt-translation**. Translation is disabled by default. The translation card stays expanded, so you can directly choose a translation type and configure the service. The card's enable and language controls are global defaults for new sessions and sessions without their own quick choices; saving shared service configuration does not overwrite existing per-conversation choices. Use the card footer to save or discard changes.

| Traditional translation service | Required settings | API |
| --- | --- | --- |
| Baidu | App ID and secret key | Official General Translation API |
| Google | Cloud Translation API key | Basic v2 |
| DeepL | API key and Free / Pro selection | `/v2/translate` |
| Microsoft | Translator API key and resource region, where required | Translator v3 |

Keys are passed to the Host through the plugin-owned API and stored in the independent YAML with 0600 permissions; the browser receives only redacted values and never calls providers directly. Leave the key field blank to retain an existing key. Enter a new service key when switching providers. Set `apiKey` to an empty string in the file to remove a credential.

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

In an existing session, click the translation icon to the right of the permission control at the lower left of the composer. A slash indicates disabled translation; an unslashed icon indicates enabled translation. The popup places both language dropdowns on one row, separated by an arrow. Changes affect **only the current conversation**, are persisted by DSH `sessionId`, and survive conversation switches and Host restarts. Other conversations are unchanged, and new conversations inherit the global defaults.

### 3. Effective timing and precedence

- After saving, the next user submission reads the new settings. Prompt translation and return translation share one snapshot for that turn; later edits cannot change the active answer’s service or return language.
- User prompts are translated during `agent/pre-step`, retaining their original message IDs. Historical prompts are not repeatedly translated during later tool steps.
- System prompts, tool arguments, tool results, injected context, images, and file blocks are not translated. Auxiliary model calls such as title generation and compaction do not enter this plugin's output translation.
- Reasoning and output are translated after a complete text block has been generated, then passed to DSH for display and persistence. Enabled content is no longer displayed token by token.
- If input translation or language detection fails, the original user message is still recorded and displayed, then an explicit error stops the turn before the main model is called. Cancellation propagates to translation calls; unloading removes listeners and cancels in-flight translations.

## Storage format

Both the settings namespace and Loader row ID are `prompt-translation`. All user settings live in `~/.dsh/prompt-translation.yml`, for example:

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

Replace the provider, model, and effort with supported values. Remove `reasoningEffort` to use the model default. Deployments can also seed static fallback configuration in the same plugin row's `config` field in the composition layer. The fallback is read only while the independent file does not exist; once present, the file is the sole user-configuration source and no edits are written back to the Profile. Tests and launchers can isolate it through `DSH_HOME`. Each `sessionOverrides` key is an actual DSH `sessionId`, and its value is a complete `enabled` / `source` / `target` quick-settings snapshot for that conversation. Delete a conversation's entry to restore global default inheritance. Entries left by deleted conversations do not affect other conversations and can be removed manually.

Traditional translation uses `type: traditional`, `engine` (`baidu` / `google` / `deepl` / `microsoft`), `apiKey`, and the service-specific `appId`, `region`, or `deeplFree`. Never commit real keys to the repository.

| Field | Default | Description |
| --- | --- | --- |
| `enabled` | `false` | Default translation state for new and non-overridden sessions |
| `sessionOverrides` | `{}` | Per-`sessionId` quick overrides for `enabled` / `source` / `target` |
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
- Full Web tests for the six tested versions use real Host services with a deterministic external model adapter. They do not prove real-provider translation quality, rate limits, billing, or signature-based continuation.

Disable translation for the current conversation from the quick menu or disable the plugin on the Plugins page. To uninstall, run the following, restart the Profile, and refresh the page. Stored translations remain:

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
npm run host:install -- 0.2.1-rc.5
npm run test:host -- 0.2.1-rc.5
```

`npm run check` combines type checking, tests, builds, and package inspection. Build outputs live in `lib/`; packages and evidence live in `artifacts/`. Override the default Chrome executable with `CHROME_PATH` and the Playwright channel with `CHROME_CHANNEL`. `.npmrc` sets `legacy-peer-deps=true`; the host installation script fills required peers from exact-version manifests to avoid mixing DSH prerelease versions.

| File | Coverage |
| --- | --- |
| `tests/translation.test.ts` | Four API protocols, language mapping, splitting, redaction, model calls, and cancellation |
| `tests/direction.test.ts` | Return direction, provider language detection, session isolation, failed-input retention, and cancellation |
| `tests/presentation.test.ts` | Persisted originals, trajectory comparisons, legacy messages, and presentation teardown |
| `tests/pipeline.test.ts` | User-source filtering, message identity, streamed text blocks, and tool-data preservation |
| `tests/client.test.tsx` | Settings writes, conflict retries, credential protection, async races, and control cleanup |
| `tests/loader.test.ts` | Built-entry loading through the real Cordis Loader, translation, and unloading |
| `scripts/ci.test.mjs` | CI matrix, dependency cohort selection, failure summaries, and trigger policy |
| `scripts/release-*.test.mjs` | Version policy, tag matching, and registry-failure release gates |
| `scripts/browser-smoke.mjs` | Built browser module, control placement, desktop and mobile viewports |
| `scripts/full-host-smoke.mjs` | Exact-version full Web cold starts, independent YAML reload, two-conversation independence, and user turns |

CI runs only for PRs and `v*` tag pushes, not ordinary branch pushes. PRs read the exact version matrix from `package.json` → `dshCompatibility`, with one job per DSH version. Each job selects the matching DSH/Cordis development dependencies and verifies Node 22 then 24 using the same lockfile: type checking, unit and script tests, builds, package inspection, and browser checks. Full Web host checks run on Node 22. Node 22 failures do not prevent Node 24 verification; results appear in Actions Summary. Tags independently run version gates, build, and publish through npm OIDC without tests or dependencies on PR jobs; ensure the tagged commit has passed PR checks first. Prereleases use `next`; stable releases use `latest` with rollback protection. No artifacts or GitHub Releases are uploaded; temporary packages and evidence stay on the runner.

## License

[MIT](LICENSE)
