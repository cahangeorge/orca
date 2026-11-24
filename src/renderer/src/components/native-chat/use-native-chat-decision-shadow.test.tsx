// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureDecisionShadow, readDecisionShadow } from '../../runtime/decision-shadow-client'
import { useNativeChatDecisionShadow } from './use-native-chat-decision-shadow'
vi.mock('../../runtime/decision-shadow-client', () => ({
  configureDecisionShadow: vi.fn(),
  readDecisionShadow: vi.fn()
}))
const local = { kind: 'local' } as const
const off = { mode: 'off' as const, observations: [] }
const shadow = { mode: 'shadow' as const, observations: [] }
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.useRealTimers()
})
describe('temporary session shadow UI lifecycle', () => {
  it.each(['read', 'enable'] as const)(
    'an obsolete same-session %s cannot disable a newer activation',
    async (lateKind) => {
      let release: ((value: typeof shadow) => void) | undefined
      let hostEnabled = false
      let enables = 0
      vi.mocked(readDecisionShadow).mockResolvedValue(off)
      if (lateKind === 'read') {
        vi.mocked(readDecisionShadow).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve
            })
        )
      }
      vi.mocked(configureDecisionShadow).mockImplementation(async (_target, _session, enabled) => {
        hostEnabled = enabled
        if (enabled && ++enables === 1 && lateKind === 'enable') {
          return new Promise((resolve) => {
            release = resolve
          })
        }
        return enabled ? shadow : off
      })
      const older = renderHook(() => useNativeChatDecisionShadow(local, 'same-session'))
      if (lateKind === 'enable') {
        await waitFor(() => expect(older.result.current.loading).toBe(false))
        act(() => {
          void older.result.current.configure(true)
        })
      }
      older.unmount()
      const newer = renderHook(() => useNativeChatDecisionShadow(local, 'same-session'))
      await waitFor(() => expect(newer.result.current.loading).toBe(false))
      await act(async () => {
        await newer.result.current.configure(true)
      })
      const disablesBeforeReply = vi
        .mocked(configureDecisionShadow)
        .mock.calls.filter((args) => !args[2]).length
      await act(async () => {
        release?.(shadow)
      })
      expect(hostEnabled).toBe(true)
      expect(newer.result.current.snapshot.mode).toBe('shadow')
      expect(vi.mocked(configureDecisionShadow).mock.calls.filter((args) => !args[2])).toHaveLength(
        disablesBeforeReply
      )
      newer.unmount()
      expect(hostEnabled).toBe(false)
    }
  )
  it('reads initial host mode once and never polls Off', async () => {
    vi.mocked(readDecisionShadow).mockResolvedValue(off)
    const { result, unmount } = renderHook(() => useNativeChatDecisionShadow(local, 'session'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(readDecisionShadow).toHaveBeenCalledTimes(1)
    expect(result.current.snapshot.mode).toBe('off')
    unmount()
    expect(configureDecisionShadow).not.toHaveBeenCalled()
  })
  it('adopts an enabled host mode and disables it during cleanup', async () => {
    vi.mocked(readDecisionShadow).mockResolvedValue(shadow)
    vi.mocked(configureDecisionShadow).mockResolvedValue(off)
    const { result, unmount } = renderHook(() => useNativeChatDecisionShadow(local, 'session'))
    await waitFor(() => expect(result.current.snapshot.mode).toBe('shadow'))
    unmount()
    expect(configureDecisionShadow).toHaveBeenCalledWith(local, 'session', false)
  })
  it('disables a late enable after session replacement without changing the new card', async () => {
    vi.mocked(readDecisionShadow).mockResolvedValue(off)
    let resolve: ((value: typeof shadow) => void) | undefined
    vi.mocked(configureDecisionShadow).mockImplementation(async (_target, _session, enabled) =>
      enabled
        ? new Promise((done) => {
            resolve = done
          })
        : off
    )
    const { result, rerender, unmount } = renderHook(
      ({ sessionId }) => useNativeChatDecisionShadow(local, sessionId),
      { initialProps: { sessionId: 'old' } }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => {
      void result.current.configure(true)
    })
    rerender({ sessionId: 'new' })
    await act(async () => {
      resolve?.(shadow)
    })
    expect(configureDecisionShadow).toHaveBeenCalledWith(local, 'old', false)
    expect(result.current.snapshot.mode).toBe('off')
    unmount()
  })
  it('cleans up an enabled host discovered after unmount', async () => {
    let resolve: ((value: typeof shadow) => void) | undefined
    vi.mocked(readDecisionShadow).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    vi.mocked(configureDecisionShadow).mockResolvedValue(off)
    const { unmount } = renderHook(() => useNativeChatDecisionShadow(local, 'old'))
    unmount()
    await act(async () => {
      resolve?.(shadow)
    })
    expect(configureDecisionShadow).toHaveBeenCalledWith(local, 'old', false)
  })
  it('ignores an in-flight poll after Off and schedules no further reads', async () => {
    vi.useFakeTimers()
    let resolve: ((value: typeof shadow) => void) | undefined
    vi.mocked(readDecisionShadow)
      .mockResolvedValueOnce(shadow)
      .mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
    vi.mocked(configureDecisionShadow).mockResolvedValue(off)
    const { result, unmount } = renderHook(() => useNativeChatDecisionShadow(local, 'session'))
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(readDecisionShadow).toHaveBeenCalledTimes(2)
    await act(async () => {
      await result.current.configure(false)
      resolve?.(shadow)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(result.current.snapshot.mode).toBe('off')
    expect(readDecisionShadow).toHaveBeenCalledTimes(2)
    unmount()
  })
  it.each(['unmount', 'off', 'replace'] as const)(
    'cancels the pending poll on %s',
    async (stop) => {
      vi.useFakeTimers()
      vi.mocked(readDecisionShadow).mockResolvedValueOnce(shadow).mockResolvedValue(off)
      vi.mocked(configureDecisionShadow).mockResolvedValue(off)
      const { result, rerender, unmount } = renderHook(
        ({ sessionId }) => useNativeChatDecisionShadow(local, sessionId),
        { initialProps: { sessionId: 'old' } }
      )
      await act(async () => {})
      expect(vi.getTimerCount()).toBe(1)
      if (stop === 'unmount') {
        unmount()
      } else if (stop === 'off') {
        await act(async () => {
          await result.current.configure(false)
        })
      } else {
        await act(async () => {
          rerender({ sessionId: 'new' })
        })
      }
      expect(vi.getTimerCount()).toBe(0)
      const readsAtStop = vi.mocked(readDecisionShadow).mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(readDecisionShadow).toHaveBeenCalledTimes(readsAtStop)
      unmount()
    }
  )
  it('keeps one timer on repeated activation and releases it on polling failure', async () => {
    vi.useFakeTimers()
    vi.mocked(readDecisionShadow).mockResolvedValueOnce(off).mockRejectedValue(new Error('offline'))
    vi.mocked(configureDecisionShadow).mockImplementation(async (_target, _session, enabled) =>
      enabled ? shadow : off
    )
    const { result, unmount } = renderHook(() => useNativeChatDecisionShadow(local, 'session'))
    await act(async () => {})
    for (let activation = 0; activation < 3; activation++) {
      await act(async () => {
        await result.current.configure(true)
      })
      expect(vi.getTimerCount()).toBe(1)
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.error).toBe(true)
    expect(result.current.snapshot.mode).toBe('off')
    expect(vi.getTimerCount()).toBe(0)
    expect(configureDecisionShadow).toHaveBeenLastCalledWith(local, 'session', false)
    unmount()
  })
  it('does not schedule a late polling reply after unmount', async () => {
    vi.useFakeTimers()
    let release: ((value: typeof shadow) => void) | undefined
    vi.mocked(readDecisionShadow)
      .mockResolvedValueOnce(shadow)
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve
          })
      )
    vi.mocked(configureDecisionShadow).mockResolvedValue(off)
    const { unmount } = renderHook(() => useNativeChatDecisionShadow(local, 'session'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(readDecisionShadow).toHaveBeenCalledTimes(2)
    unmount()
    await act(async () => {
      release?.(shadow)
    })
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(readDecisionShadow).toHaveBeenCalledTimes(2)
  })
  it('does no RPC for remote targets', () => {
    const remote = { kind: 'environment' as const, environmentId: 'remote' }
    const { result, unmount } = renderHook(() => useNativeChatDecisionShadow(remote, 'session'))
    expect(result.current.snapshot.mode).toBe('off')
    expect(readDecisionShadow).not.toHaveBeenCalled()
    unmount()
  })
})
