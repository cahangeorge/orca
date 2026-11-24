import { describe, expect, it, vi } from 'vitest'
import {
  createOpenDeciderShadowProvider,
  createDecisionShadowProviderForEnvironment
} from './opendecider-shadow-provider'
const input = {
  text: 'Implement a bounded observer',
  taskCategoryChoices: ['docs', 'implementation', 'needs_context'],
  executionLaneChoices: ['["gpt-6.1-sol","medium"]', 'needs_context'],
  choicesVersion: 'catalog-1'
}
describe('loopback Nano provider', () => {
  it.each([
    'https://example.com',
    'http://localhost:18083',
    'http://127.0.0.2:18083',
    'http://127.0.0.1:18083/private',
    'http://user:password@127.0.0.1:18083',
    'http://127.0.0.1:18083?secret=x'
  ])('rejects an unapproved endpoint %s', (endpoint) => {
    expect(() => createOpenDeciderShadowProvider({ endpoint })).toThrow()
  })
  it('checks readiness/health and emits separate described choice questions with bounded replies', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ready: true }))
      .mockResolvedValueOnce(Response.json({ version: '0.6.0', device: 'cpu' }))
      .mockResolvedValueOnce(
        Response.json({
          model: 'OpenDecider-Nano',
          answers: {
            task_category: { choice: 'implementation', confidence: 0.4 },
            execution_lane: { choice: input.executionLaneChoices[0], confidence: 0.7 }
          }
        })
      )
    const provider = createOpenDeciderShadowProvider({ fetch: fetcher })
    const result = await provider.evaluate(input, new AbortController().signal)
    expect(result).toMatchObject({
      task_category: { confidence: 0.4 },
      execution_lane: { confidence: 0.7 }
    })
    const request = fetcher.mock.calls[2][1]
    expect(request?.redirect).toBe('error')
    expect(request?.signal).toBeInstanceOf(AbortSignal)
    const payload = JSON.parse(String(request?.body))
    expect(payload.questions.task_category.criteria.implementation).toMatch(/implementation/i)
    expect(payload.questions.execution_lane.criteria[input.executionLaneChoices[0]]).toMatch(
      /Sol.*medium/
    )
    expect(payload.state).toBe(input.text)
  })
  it.each([{ ready: false }, { ready: true, version: '0.7.0' }])(
    'rejects unavailable/incompatible service health',
    async (health) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(health))
      await expect(
        createOpenDeciderShadowProvider({ fetch: fetcher }).evaluate(
          input,
          new AbortController().signal
        )
      ).rejects.toThrow()
    }
  )
  it('rejects oversized and malformed replies without exposing error bodies', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith('/ready')
          ? Response.json({ ready: true })
          : String(url).endsWith('/health')
            ? Response.json({ version: '0.6.0', device: 'cpu' })
            : new Response('PRIVATE_ERROR_BODY'.repeat(5000))
      )
    await expect(
      createOpenDeciderShadowProvider({ fetch: fetcher }).evaluate(
        input,
        new AbortController().signal
      )
    ).rejects.toThrow('Invalid local decision service response')
  })
  it('fails open on invalid environment configuration without blocking host installation', async () => {
    const provider = createDecisionShadowProviderForEnvironment({
      ORCA_DECISION_SHADOW_ENDPOINT: 'https://example.com'
    })
    expect(provider.id).toBe('opendecider-nano')
    await expect(provider.evaluate(input, new AbortController().signal)).rejects.toThrow(
      'Local decision service configuration unavailable'
    )
  })
  it('cancels an unfinished non-OK response without retaining its private error body', async () => {
    const cancel = vi.fn()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ready: true }))
      .mockResolvedValueOnce(Response.json({ version: '0.6.0', device: 'cpu' }))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('PRIVATE_ERROR_BODY'))
            },
            cancel
          }),
          { status: 503 }
        )
      )
    await expect(
      createOpenDeciderShadowProvider({ fetch: fetcher }).evaluate(
        input,
        new AbortController().signal
      )
    ).rejects.toThrow('Invalid local decision service response')
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('labels explicit fixtures simulated and defaults to a real Nano provider', () => {
    expect(createDecisionShadowProviderForEnvironment({}).id).toBe('opendecider-nano')
    expect(
      createDecisionShadowProviderForEnvironment({
        ORCA_DECISION_SHADOW_PROVIDER: 'simulated-fixture'
      }).id
    ).toBe('simulated-fixture')
  })
})
