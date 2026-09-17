import { describe, expect, it } from 'vitest'

import {
  generateOrganizationSettingsMenuItems,
  generateOrganizationSettingsSections,
  normalizeOrganizationSettingsPath,
} from './OrganizationSettingsLayout'
import { SHORTCUT_IDS } from '@/state/shortcuts/registry'

describe('generateOrganizationSettingsMenuItems', () => {
  it('includes webhooks entry for organization settings nav', () => {
    const items = generateOrganizationSettingsMenuItems({
      slug: 'my-org',
      showSecuritySettings: true,
      showSsoSettings: true,
      showLegalDocuments: true,
    })

    expect(items.some((item) => item.label === 'Webhooks')).toBe(true)
    expect(items.some((item) => item.href === '/org/my-org/webhooks')).toBe(true)
  })
})

describe('OrganizationSettingsLayout helpers', () => {
  it('returns expected organization settings sections and links', () => {
    const sections = generateOrganizationSettingsSections({
      slug: 'my-org',
      currentPath: '/org/my-org/general',
      showSecuritySettings: true,
      showSsoSettings: true,
      showLegalDocuments: true,
    })

    expect(sections.map((section) => section.heading)).toEqual([
      'Configuration',
      'Connections',
      'Compliance',
    ])
    // 'API Keys' is this fork's own entry (Taskclan Cloud API keys, org-scoped)
    // and is present because IS_PLATFORM is false in this build. On platform it
    // is omitted, since upstream has no such concept.
    expect(sections.flatMap((section) => section.links.map((item) => item.label))).toEqual([
      'General',
      'Security',
      'SSO',
      'API Keys',
      'OAuth Apps',
      'Webhooks',
      'Audit Logs',
      'Legal Documents',
    ])
    expect(
      sections.flatMap((section) => section.links).find((item) => item.label === 'General')
        ?.isActive
    ).toBe(true)
  })

  it('hides feature-flagged items when flags are disabled', () => {
    const sections = generateOrganizationSettingsSections({
      slug: 'my-org',
      currentPath: '/org/my-org/general',
      showSecuritySettings: false,
      showSsoSettings: false,
      showLegalDocuments: false,
    })

    expect(sections.map((section) => section.heading)).toEqual([
      'Configuration',
      'Connections',
      'Compliance',
    ])
    // API Keys is not feature-flagged: it is a capability of this build, so it
    // survives every flag being off. Only the upstream items disappear.
    expect(sections.flatMap((section) => section.links.map((item) => item.label))).toEqual([
      'General',
      'API Keys',
      'OAuth Apps',
      'Webhooks',
      'Audit Logs',
    ])
  })

  it('points the Taskclan API keys entry at the org-scoped page', () => {
    // Org-scoped because the engine scopes Cloud API keys by organisation: one
    // key reaches every app in the org. A project-scoped href would be a
    // different, narrower thing that does not exist.
    const sections = generateOrganizationSettingsSections({
      slug: 'my-org',
      currentPath: '/org/my-org/general',
      showSecuritySettings: false,
      showSsoSettings: false,
      showLegalDocuments: false,
    })

    const connections = sections.find((section) => section.heading === 'Connections')
    const apiKeys = connections?.links.find((item) => item.label === 'API Keys')
    expect(apiKeys?.href).toBe('/org/my-org/api-keys')
  })

  it('normalizes hash paths for active state checks', () => {
    const currentPath = normalizeOrganizationSettingsPath('/org/my-org/security#sso')
    const sections = generateOrganizationSettingsSections({
      slug: 'my-org',
      currentPath,
      showSecuritySettings: true,
      showSsoSettings: true,
      showLegalDocuments: true,
    })

    expect(
      sections.flatMap((section) => section.links).find((item) => item.label === 'Security')
        ?.isActive
    ).toBe(true)
  })

  it('attaches shortcutId to each settings link', () => {
    const sections = generateOrganizationSettingsSections({
      slug: 'my-org',
      currentPath: '/org/my-org/general',
      showSecuritySettings: true,
      showSsoSettings: true,
      showLegalDocuments: true,
      showPlatformWebhooks: true,
    })

    const allLinks = sections.flatMap((s) => s.links)
    const linkByKey = (key: string) => allLinks.find((l) => l.key === key)

    expect(linkByKey('general')?.shortcutId).toBe(SHORTCUT_IDS.NAV_ORG_SETTINGS_GENERAL)
    expect(linkByKey('security')?.shortcutId).toBe(SHORTCUT_IDS.NAV_ORG_SETTINGS_SECURITY)
    expect(linkByKey('sso')?.shortcutId).toBe(SHORTCUT_IDS.NAV_ORG_SETTINGS_SSO)
    expect(linkByKey('apps')?.shortcutId).toBe(SHORTCUT_IDS.NAV_ORG_SETTINGS_APPS)
    expect(linkByKey('webhooks')?.shortcutId).toBe(SHORTCUT_IDS.NAV_ORG_SETTINGS_WEBHOOKS)
    expect(linkByKey('audit')?.shortcutId).toBe(SHORTCUT_IDS.NAV_ORG_SETTINGS_AUDIT)
    expect(linkByKey('documents')?.shortcutId).toBe(SHORTCUT_IDS.NAV_ORG_SETTINGS_DOCUMENTS)
  })

  it('omits feature-flagged links (and their shortcutIds) when flags are off', () => {
    const sections = generateOrganizationSettingsSections({
      slug: 'my-org',
      currentPath: '/org/my-org/general',
      showSecuritySettings: false,
      showSsoSettings: false,
      showLegalDocuments: false,
    })

    const allLinks = sections.flatMap((s) => s.links)
    const keys = allLinks.map((l) => l.key)

    expect(keys).not.toContain('security')
    expect(keys).not.toContain('sso')
    expect(keys).not.toContain('documents')
  })

  it('keeps webhooks nav item active for nested endpoint routes', () => {
    const sections = generateOrganizationSettingsSections({
      slug: 'my-org',
      currentPath: '/org/my-org/webhooks/org-endpoint-1',
      showSecuritySettings: true,
      showSsoSettings: true,
      showLegalDocuments: true,
    })

    expect(
      sections.flatMap((section) => section.links).find((item) => item.label === 'Webhooks')
        ?.isActive
    ).toBe(true)
  })
})
