import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, type InvocationDescriptor, type TypertCodec } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { namespace, type DescribeValue, type TranslationStore } from './store.js'
import type { SettingsPathOp } from './options.js'

const strict = (typeSymbol: string, schema: z.ZodType): TypertCodec => ({ mode: 'strict', typeSymbol, create: () => schema })
const describeSchema = z.object({
  writable: z.boolean(),
  namespaces: z.array(z.object({ ns: z.string(), value: z.record(z.string(), z.json()), revision: z.number() })),
})
const opsSchema = z.array(z.object({ op: z.literal('set'), path: z.array(z.string()), value: z.json() }))

/** Strict Host descriptors for the independent settings channel. */
export const promptTranslationContribution: TypertContribution = {
  package: 'dsh-prompt-translation',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [{
    id: 'dsh-prompt-translation#promptTranslation/describe',
    service: 'fla1337PromptTranslation',
    namespace: 'promptTranslation',
    method: 'describe',
    invocation: { kind: 'direct' },
    parameters: [],
    result: strict('dsh-prompt-translation#DescribeValue', describeSchema),
  }, {
    id: 'dsh-prompt-translation#promptTranslation/mutate',
    service: 'fla1337PromptTranslation',
    namespace: 'promptTranslation',
    method: 'mutate',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'ns', wire: 'ns', source: 'json', codec: strict('string', z.string()) },
      { name: 'ops', wire: 'ops', source: 'json', codec: strict('dsh-prompt-translation#SettingsPathOp[]', opsSchema) },
      { name: 'revision', wire: 'revision', source: 'json', codec: strict('number', z.number()) },
    ],
    result: strict('null', z.null()),
  }] satisfies InvocationDescriptor[],
}

/** Browser API backed only by the independent prompt-translation.yml store. */
export class PromptTranslationApi extends TypertRemoteService {
  constructor(ctx: Context, private readonly store: TranslationStore) {
    super(ctx, 'fla1337PromptTranslation', { namespace: 'promptTranslation' })
  }

  describe(): DescribeValue { return this.store.describe() }

  mutate(ns: string, ops: SettingsPathOp[], revision: number): null {
    if (ns !== namespace) throw new RemoteError('settings/rejected', `未知翻译配置命名空间：${ns}`, { ns })
    this.store.mutate(ops, revision)
    return null
  }
}
