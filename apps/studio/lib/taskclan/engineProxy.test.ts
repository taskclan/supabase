import { describe, expect, it } from 'vitest'

import { engineTargetFor } from './engineProxy'

/**
 * The routing in front of `git push`.
 *
 * Getting this wrong fails in a way nobody can debug from the outside: over-
 * match and the console stops serving its own API, under-match and every CLI
 * deploy stops finding its remote. Neither produces a useful error, so the
 * cases below are the boundary rather than the happy path.
 *
 * The two target shapes were verified against production before being written
 * down: `/cloud/git/<app>.git/info/refs?service=…` and `/api/cloud/v1/sites`
 * both answer on the engine's own hostname (401, i.e. reached and refused),
 * while `/git/…` on that hostname 404s because the rewrite is host-gated.
 */

const ENGINE = 'https://engine.taskclan.com'
const t = (path: string) => engineTargetFor(`https://cloud.taskclan.com${path}`, ENGINE)

describe('git over HTTP', () => {
  it('rewrites to the path the handler actually lives at', () => {
    // The `/cloud` prefix is normally added by the engine's middleware because
    // the hostname is in its CLOUD_HOSTS set. After the swap that rewrite never
    // runs, so the Worker has to address the handler directly.
    expect(t('/git/waybill.git/info/refs?service=git-receive-pack')).toBe(
      `${ENGINE}/cloud/git/waybill.git/info/refs?service=git-receive-pack`
    )
  })

  it('carries the query string, which is the git service negotiation', () => {
    // `?service=git-receive-pack` is how git asks for push rather than fetch.
    // Dropping it turns a push into a clone and the client hangs.
    expect(t('/git/x.git/info/refs?service=git-upload-pack')).toContain(
      '?service=git-upload-pack'
    )
  })

  it('forwards the POST paths too, not just the discovery GET', () => {
    // The actual packfile goes to /git-receive-pack; forwarding only info/refs
    // would let negotiation start and then break mid-push.
    expect(t('/git/waybill.git/git-receive-pack')).toBe(
      `${ENGINE}/cloud/git/waybill.git/git-receive-pack`
    )
  })

  it('does not match a path that merely starts with the same letters', () => {
    // `/github-callback` is not git. Matching it would steal a console route.
    expect(t('/github-callback')).toBeNull()
    expect(t('/gitlab')).toBeNull()
  })
})

describe('the Cloud API', () => {
  it('forwards without rewriting, because it answers on any hostname', () => {
    expect(t('/api/cloud/v1/sites')).toBe(`${ENGINE}/api/cloud/v1/sites`)
  })

  it('forwards the CLI device-login endpoints', () => {
    // `taskclan login` posts here. Without it the CLI cannot authenticate at
    // all, and the netrc credential it holds is keyed to this hostname.
    expect(t('/api/cloud/v1/auth/device/start')).toBe(
      `${ENGINE}/api/cloud/v1/auth/device/start`
    )
  })

  it("leaves the console's own API alone", () => {
    // This is the over-match that would take the console down: both of these
    // are served by the console's own Next routes, and the engine has neither.
    expect(t('/api/platform/projects')).toBeNull()
    expect(t('/api/taskclan/keys')).toBeNull()
    expect(t('/api/cloudfoo')).toBeNull()
  })
})

describe('everything else stays with the console', () => {
  it('does not forward the console UI', () => {
    expect(t('/')).toBeNull()
    expect(t('/project/waybill/settings/general')).toBeNull()
    expect(t('/sign-in')).toBeNull()
  })

  it('does not forward engine pages, which would load the wrong bundles', () => {
    // `/cloud/device` is a Next page. Forwarding its HTML would leave it asking
    // this Worker for the engine's `/_next/...` chunks, which it does not have.
    expect(t('/cloud/device')).toBeNull()
    expect(t('/_next/static/abc/main.js')).toBeNull()
  })
})

describe('robustness', () => {
  it('tolerates a trailing slash on the configured origin', () => {
    expect(engineTargetFor('https://cloud.taskclan.com/git/a.git', 'https://engine.taskclan.com/'))
      .toBe(`${ENGINE}/cloud/git/a.git`)
  })

  it('returns null rather than throwing on an unparseable URL', () => {
    // A throw here would 500 the Worker for every request, including the ones
    // it was supposed to serve normally.
    expect(engineTargetFor('not a url', ENGINE)).toBeNull()
  })
})
