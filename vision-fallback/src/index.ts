/**
 * Vision-fallback: vision-as-a-service for text-only conversation models.
 *
 * Keeps any text-only model as the conversation default and lets it "receive"
 * image data without switching models. When a request carries image content
 * for a model that cannot see images natively, this plugin:
 *
 *   1. calls the vision-capable fallback route once per image to obtain a
 *      plain-text description of each image,
 *   2. replaces the image content blocks with those descriptions, and
 *   3. re-dispatches the (now text-only) request to the original model.
 *
 * The conversation model therefore stays in charge and answers the user's
 * actual question, while the vision model only supplies the missing "eyes".
 * This also keeps assistant provenance correct: the main model is the one
 * streaming the reply, so `assistant/message.source` records the conversation
 * model instead of the fallback.
 *
 * The plugin applies to every registered provider route: a model that
 * advertises image input receives images directly, while any other model is
 * transformed. Only the exact fallback provider/model pair is exempt, so the
 * fallback's own description calls cannot recurse. `textProviders`, when set,
 * narrows handling to that route allowlist; omitted or empty means every
 * route, including routes added later.
 *
 * Description calls are hand-built (the harness retry policy covers
 * agent-loop requests only), so each one retries transient provider failures
 * (SERVER, RATE_LIMIT, TIMEOUT, TRANSPORT, EMPTY_RESPONSE) twice with a short
 * backoff before degrading to the unavailable placeholder.
 *
 * Descriptions are cached by attachment id, so a screenshot already seen this
 * server run is never re-sent to the vision model.
 *
 * Two halves, both over public seams:
 *
 *   1. `llm/stream` transformation — described above.
 *   2. `resolveModelInfo` capability augmentation — the Web host admits an
 *      image only when the *currently selected* model advertises image input.
 *      We make text-only models report image capability so the image is
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

/** Provider-neutral failure codes whose cause is transient; description calls retry these. */
const TRANSIENT_CODES = new Set([
  'SERVER',
  'RATE_LIMIT',
  'TIMEOUT',
  'TRANSPORT',
  'EMPTY_RESPONSE',
])

/** Delays (ms) before each retry of a transient description failure. */
const RETRY_DELAYS_MS = [1000, 2000]

/** Wait `ms` milliseconds, aborting early when the signal fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (signal?.aborted) {
        reject(new Error('vision description aborted'))
        return
      }
      const remaining = ms - (Date.now() - started)
      if (remaining <= 0) {
        resolve()
        return
      }
      setTimeout(tick, Math.min(remaining, 100))
    }
    tick()
  })
}

/** A failed fallback description call; carries the provider-neutral failure code. */
class DescriptionError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

export interface Config {
  /** Provider route used to describe image-bearing requests. */
  fallbackProvider?: string
  /** Model id on that route used to describe image-bearing requests. */
  fallbackModel?: string
  /** Optional allowlist of provider routes to handle; omitted or empty handles every route. */
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
  textProviders: z.array(z.string()).default([]),
  descriptionPrompt: z.string().default(DEFAULT_DESCRIPTION_PROMPT),
  descriptionMaxTokens: z.number().step(1).min(1).default(2000),
})

export const name = 'vision-fallback'
export const inject = ['llm']

export function apply(ctx: Context, config: Config = {}) {
  const fallbackProvider = config.fallbackProvider ?? 'opencode-go'
  const fallbackModel = config.fallbackModel ?? 'qwen3.6-plus'
  const textProviders = new Set(config.textProviders ?? [])
  const descriptionPrompt = config.descriptionPrompt ?? DEFAULT_DESCRIPTION_PROMPT
  const descriptionMaxTokens = config.descriptionMaxTokens ?? 2000

  /** Whether this provider/model pair is the fallback description route itself. */
  const isFallbackRoute = (provider: string, model: string) =>
    provider === fallbackProvider && model === fallbackModel

  /** Whether the plugin handles this provider route (all routes when the allowlist is empty). */
  const isEligible = (provider: string) =>
    textProviders.size === 0 || textProviders.has(provider)

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
    let parts: string[] = []
    let truncated = false
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[attempt - 1]
        if (delay !== undefined) await sleep(delay, signal)
      }
      parts = []
      truncated = false
      try {
        const nested: GenerateOptions = {
          provider: fallbackProvider,
          model: fallbackModel,
          messages: [request],
          maxTokens: descriptionMaxTokens,
          ...(signal === undefined ? {} : { signal }),
        }
        for await (const chunk of ctx.llm.stream(nested)) {
          if (chunk.type === 'text-delta') parts.push(chunk.text)
          else if (chunk.type === 'finish') {
            if (chunk.reason.kind === 'error') {
              throw new DescriptionError(
                `vision description failed: ${chunk.reason.failure.message} (code=${chunk.reason.failure.code})`,
                chunk.reason.failure.code,
              )
            }
            if (chunk.reason.kind === 'aborted') {
              throw new Error('vision description aborted')
            }
            // A max-tokens finish is a partial success: keep the text produced so far.
            if (chunk.reason.kind === 'max-tokens') truncated = true
          }
        }
        break
      } catch (error) {
        const code = (error as { code?: unknown }).code
        const transient = typeof code === 'string' && TRANSIENT_CODES.has(code)
        if (transient && attempt < RETRY_DELAYS_MS.length) continue
        throw error
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

  // (1) Transform image-bearing requests whose target model cannot see images
  // natively, so the conversation model receives plain-text descriptions.
  const llm = ctx.llm
  const originalResolve = llm.resolveModelInfo.bind(llm)
  const disposeRoute = ctx.on('llm/stream', function (options, next): AsyncIterable<StreamChunk> {
    if (!isEligible(options.provider) || isFallbackRoute(options.provider, options.model) || !hasImage(options)) {
      return next()
    }
    // The native-capability check is asynchronous, so it runs lazily on first
    // iteration; the waterfall itself stays synchronous.
    return (async function* () {
      let nativeVision = false
      try {
        const info = await originalResolve(options.provider, options.model, options.signal)
        nativeVision = info.inputModalities !== undefined && info.inputModalities.includes('image')
      } catch {
        // Capability unknown: assume text-only. The transformed re-dispatch
        // below surfaces any real adapter failure.
      }
      if (nativeVision) {
        yield* next()
        return
      }
      const messages = []
      for (const message of options.messages) {
        if (contentHasImage(message.content)) {
          messages.push({ ...message, content: await transformContent(message.content, options.signal) })
        } else {
          messages.push(message)
        }
      }
      // Re-enter on the same route; the guard above no longer matches because
      // every image block has been replaced with text.
      yield* ctx.llm.stream({ ...options, messages })
    })()
  })

  // (2) Advertise image capability on text-only models so the host's
  // submit-time admission check lets the image through; the transformer above
  // is what actually handles it.
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
        isEligible(provider) &&
        !isFallbackRoute(provider, model)
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
