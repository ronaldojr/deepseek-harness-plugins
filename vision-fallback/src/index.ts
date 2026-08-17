/**
 * Vision-fallback: vision-as-a-service for text-only conversation models.
 *
 * Keeps a text-only model (DeepSeek) as the conversation default and lets it
 * "receive" image data without switching models. When a request destined for a
 * text-only route carries image content, this plugin:
 *
 *   1. calls the vision-capable fallback route once per image to obtain a
 *      plain-text description of each image,
 *   2. replaces the image content blocks with those descriptions, and
 *   3. re-dispatches the (now text-only) request to the original text model.
 *
 * The text model therefore stays in charge and answers the user's actual
 * question, while the vision model only supplies the missing "eyes". This also
 * keeps assistant provenance correct: the main model is the one streaming the
 * reply, so `assistant/message.source` records the text model instead of the
 * fallback.
 *
 * Descriptions are cached by attachment id, so a screenshot already seen this
 * server run is never re-sent to the vision model.
 *
 * Two halves, both over public seams:
 *
 *   1. `llm/stream` transformation — described above.
 *   2. `resolveModelInfo` capability augmentation — the Web host admits an
 *      image only when the *currently selected* model advertises image input.
 *      We make the text-only routes report image capability so the image is
 *      admitted, leaving the actual handling to the transformer above.
 *
 * Both are disposed on unload (HMR-safe).
 *
 * @module dsh-vision-fallback
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  contentHasImage,
  createUserMessage,
  type ContentBlock,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** Durable-image description cache: attachmentId -> description text. */
const descriptionCache = new Map<string, string>()

export interface Config {
  /** Provider route used to describe image-bearing requests. */
  fallbackProvider?: string
  /** Model id on that route used to describe image-bearing requests. */
  fallbackModel?: string
  /** Routes considered text-only; image-bearing requests on these are transformed. */
  textProviders?: string[]
  /** Instruction sent to the vision model alongside each image. */
  descriptionPrompt?: string
  /** Output cap for one vision description call. */
  descriptionMaxTokens?: number
}

const DEFAULT_DESCRIPTION_PROMPT =
  'Describe the image(s) in this message in precise, thorough detail so a '
  + 'text-only reader can fully understand them. '
  + 'Transcribe ALL visible text VERBATIM — do not paraphrase, summarize, or '
  + 'omit any text. If any text is partially obscured or unreadable, write '
  + '[unclear] for that portion instead of guessing. '
  + 'Describe the layout, UI elements, colors, and visual structure. '
  + 'Do NOT infer, speculate about, or invent content that is not actually '
  + 'visible in the image.'

export const Config = z.object({
  fallbackProvider: z.string(),
  fallbackModel: z.string(),
  textProviders: z.array(z.string()),
  descriptionPrompt: z.string().default(DEFAULT_DESCRIPTION_PROMPT),
  descriptionMaxTokens: z.number().step(1).min(1).default(2000),
})

export const name = 'vision-fallback'
export const inject = ['llm']

export function apply(ctx: Context, config: Config = {}) {
  const fallbackProvider = config.fallbackProvider ?? 'opencode-go'
  const fallbackModel = config.fallbackModel ?? 'qwen3.6-plus'
  const textProviders = new Set(config.textProviders ?? ['deepseek-official'])
  const descriptionPrompt = config.descriptionPrompt ?? DEFAULT_DESCRIPTION_PROMPT
  const descriptionMaxTokens = config.descriptionMaxTokens ?? 2000

  const hasImage = (options: GenerateOptions) =>
    options.messages.some((message) => contentHasImage(message.content))

  /** Describe ONE image block via the fallback route, cached by attachmentId. */
  async function describeImage(image: ContentBlock, signal?: AbortSignal): Promise<string> {
    const id = image.type === 'image' ? image.attachment?.attachmentId : undefined
    if (id !== undefined && descriptionCache.has(id)) {
      return descriptionCache.get(id)!
    }
    const request = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: descriptionPrompt }, image],
    })
    const nested: GenerateOptions = {
      provider: fallbackProvider,
      model: fallbackModel,
      messages: [request],
      maxTokens: descriptionMaxTokens,
      ...(signal === undefined ? {} : { signal }),
    }
    const parts: string[] = []
    let truncated = false
    for await (const chunk of ctx.llm.stream(nested)) {
      if (chunk.type === 'text-delta') parts.push(chunk.text)
      else if (chunk.type === 'finish') {
        if (chunk.reason.kind === 'error') {
          throw new Error(`vision description failed: ${chunk.reason.failure.message} (code=${chunk.reason.failure.code})`)
        }
        if (chunk.reason.kind === 'aborted') {
          throw new Error('vision description aborted')
        }
        // A max-tokens finish is a partial success: keep the text produced so far.
        if (chunk.reason.kind === 'max-tokens') truncated = true
      }
    }
    let description = parts.join('').trim()
    if (description === '') description = '(the image could not be described)'
    if (truncated) description += '\n[note: description truncated by the model output limit]'
    if (id !== undefined) descriptionCache.set(id, description)
    return description
  }

  /** Replace every image block with its own description, descending tool results. */
  async function transformContent(content: readonly ContentBlock[], signal?: AbortSignal): Promise<ContentBlock[]> {
    const out: ContentBlock[] = []
    for (const block of content) {
      if (block.type === 'image') {
        let description: string
        try {
          description = await describeImage(block, signal)
        } catch (error) {
          description = `(vision description unavailable: ${error instanceof Error ? error.message : String(error)})`
        }
        out.push({
          type: 'text',
          text: `[Attached image — described by ${fallbackProvider}/${fallbackModel}:\n${description}\n]`,
        })
      } else if (block.type === 'tool-result') {
        out.push({ ...block, content: await transformContent(block.content, signal) })
      } else {
        out.push(block)
      }
    }
    return out
  }

  // (1) Transform image-bearing requests so the text model sees descriptions.
  const disposeRoute = ctx.on('llm/stream', function (options, next): AsyncIterable<StreamChunk> {
    if (
      options.provider !== fallbackProvider &&
      textProviders.has(options.provider) &&
      hasImage(options)
    ) {
      return (async function* () {
        const messages = []
        for (const message of options.messages) {
          if (contentHasImage(message.content)) {
            messages.push({ ...message, content: await transformContent(message.content, options.signal) })
          } else {
            messages.push(message)
          }
        }
        const transformed: GenerateOptions = { ...options, messages }
        // Re-enter on the same (text) route; the guard above no longer matches
        // because every image block has been replaced with text.
        yield* ctx.llm.stream(transformed)
      })()
    }
    return next()
  })

  // (2) Advertise image capability on text-only routes so the host's
  // submit-time admission check lets the image through; the transformer above
  // is what actually handles it.
  const llm = ctx.llm
  const originalResolve = llm.resolveModelInfo.bind(llm)
  llm.resolveModelInfo = function (
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return originalResolve(provider, model, signal).then((info) => {
      const modalities = info.inputModalities
      if (
        modalities !== undefined &&
        !modalities.includes('image') &&
        provider !== fallbackProvider &&
        textProviders.has(provider)
      ) {
        return { ...info, inputModalities: [...modalities, 'image'] }
      }
      return info
    })
  }

  ctx.effect(() => () => {
    disposeRoute()
    llm.resolveModelInfo = originalResolve
  })
}
