import type { MessageJob, MessageJobsResponse } from '@/types'


export const PLUGIN_JOB_POLL_INTERVAL_MS = 2000
export const PLUGIN_JOB_POLL_MAX_ATTEMPTS = 30

export type JobPollState = 'pending' | 'success' | 'failed' | 'timeout'

export interface JobPollOutcome {
  state: JobPollState

  job: MessageJob | null
}

export interface CreateJobPollerOptions {
  fetchJobs: () => Promise<MessageJobsResponse>
  intervalMs?: number
  maxAttempts?: number
  onUpdate?: (outcome: JobPollOutcome) => void
}

export interface JobPoller {
  start: () => void
  stop: () => void
}












export function createJobPoller(options: CreateJobPollerOptions): JobPoller {
  const intervalMs = options.intervalMs ?? PLUGIN_JOB_POLL_INTERVAL_MS
  const maxAttempts = options.maxAttempts ?? PLUGIN_JOB_POLL_MAX_ATTEMPTS

  let timer: ReturnType<typeof setInterval> | null = null
  let attempts = 0
  let active = false
  let finished = false
  let inFlight = false
  let lastJob: MessageJob | null = null

  const stop = () => {
    active = false
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  const finish = (outcome: JobPollOutcome) => {
    if (finished) return
    finished = true
    stop()
    options.onUpdate?.(outcome)
  }

  const tick = async () => {
    if (!active || inFlight) return
    if (attempts >= maxAttempts) {
      finish({ state: 'timeout', job: lastJob })
      return
    }
    attempts += 1
    inFlight = true

    try {
      const response = await options.fetchJobs()
      if (!active) return

      const latest = response.jobs[0] ?? null
      lastJob = latest

      if (!latest || latest.status === 'pending') {
        options.onUpdate?.({ state: 'pending', job: latest })
        return
      }
      if (latest.status === 'success') {
        finish({ state: 'success', job: latest })
        return
      }
      finish({ state: 'failed', job: latest })
    } catch {
      finish({ state: 'failed', job: lastJob })
    } finally {
      inFlight = false
    }
  }

  const start = () => {
    if (timer !== null) return
    active = true
    finished = false
    attempts = 0
    timer = setInterval(() => {
      void tick()
    }, intervalMs)
  }

  return {
    start,
    stop
  }
}
