import { describe, expect, it } from 'vitest'

import { buildOverview, type CloudSiteDetail } from './overview'
import type { CloudDeployment } from './deployments'

const site = (over: Partial<CloudSiteDetail> = {}): CloudSiteDetail => ({
  id: 's1',
  name: 'forge3d',
  host: 'forge3d.taskclan.app',
  status: 'active',
  type: 'service',
  instanceType: 'basic',
  maxInstances: 1,
  region: 'auto',
  deployMode: 'manual',
  ...over,
})

const dep = (over: Partial<CloudDeployment> = {}): CloudDeployment => ({
  id: 'd1',
  siteId: 's1',
  status: 'ready',
  createdAt: '2026-09-13T18:05:20Z',
  durationSec: 420,
  branch: 'main',
  ...over,
})

describe('buildOverview', () => {
  it('reads status, compute, region and live URL from the site', () => {
    const o = buildOverview(site(), { repoFullName: 'taskclan/forge3d', branch: 'main' }, [])
    expect(o.name).toBe('forge3d')
    expect(o.status).toEqual({ label: 'Healthy', tone: 'healthy' })
    expect(o.compute).toBe('basic')
    expect(o.region).toBe('Auto')
    expect(o.liveUrl).toBe('https://forge3d.taskclan.app')
    expect(o.repo).toBe('taskclan/forge3d')
  })

  it('prefers a custom domain for the live URL', () => {
    const o = buildOverview(site({ customDomain: 'forge3d.ai' }), null, [])
    expect(o.liveUrl).toBe('https://forge3d.ai')
  })

  it('shows the instance count only when more than one', () => {
    expect(buildOverview(site({ instanceType: 'standard-1', maxInstances: 3 }), null, []).compute).toBe(
      'standard-1 ×3'
    )
    expect(buildOverview(site({ maxInstances: 1 }), null, []).compute).toBe('basic')
  })

  it('surfaces a failed last deploy as the status, even if a prior release serves', () => {
    const o = buildOverview(site({ status: 'active' }), null, [dep({ status: 'error' })])
    expect(o.status).toEqual({ label: 'Last deploy failed', tone: 'warning' })
  })

  it('reports paused apps as paused, not down', () => {
    expect(buildOverview(site({ status: 'inactive' }), null, []).status.tone).toBe('neutral')
  })

  it('takes the last deploy from the newest non-superseded row', () => {
    const rows = [dep({ id: 'x', status: 'superseded' }), dep({ id: 'live', status: 'ready' })]
    const o = buildOverview(site(), null, rows)
    expect(o.lastDeploy?.state).toBe('ready')
  })

  it('summarises the deploy commit, falling back to the sha', () => {
    expect(
      buildOverview(site(), null, [dep({ commitMessage: 'feat: ship it\n\nbody' })]).lastDeploy
        ?.commit
    ).toBe('feat: ship it')
    expect(
      buildOverview(site(), null, [dep({ commitMessage: null, commitSha: 'abcdef1234' })]).lastDeploy
        ?.commit
    ).toBe('abcdef1')
  })

  it('handles an app with no repo and no deploys', () => {
    const o = buildOverview(site({ instanceType: null }), null, [])
    expect(o.repo).toBeNull()
    expect(o.branch).toBeNull()
    expect(o.lastDeploy).toBeNull()
    expect(o.compute).toBe('—')
  })

  it('falls back to the deploy branch when git has none', () => {
    expect(buildOverview(site(), null, [dep({ branch: 'release' })]).branch).toBe('release')
  })
})
