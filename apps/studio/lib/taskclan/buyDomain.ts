/**
 * The pure half of buying a domain in the console (BuyDomainDialog.tsx): what a
 * search asks for, how a price reads, which card a purchase is charged to, and
 * what to say when it finishes. No React and no fetch, so it is tested alone.
 *
 * The shapes mirror the resale API: api/cloud/v1/domains/search (a customer
 * quote), /registrant (the owner's contact) and /register (the purchase), plus
 * api/cloud/v1/billing/payment-methods for the card.
 */

export interface DomainQuote {
  name: string;
  available: boolean;
  priceUsd: number | null;
  renewalPriceUsd: number | null;
  currency?: string | null;
  reason: string | null;
}

export interface CardOnFile {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

/** The registrant form: every field a string, optional ones empty when unset. */
export interface RegistrantFields {
  name: string;
  organization: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
}

export interface PurchaseResponse {
  ok: boolean;
  status?: 'active' | 'registered_attach_failed';
  priceUsd?: number;
  error?: string;
}

/** What someone typed, as the search wants it: no scheme, path, "www." or spaces. */
export function searchTerm(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/^www\./, '')
    .replace(/\s+/g, '');
}

export const usd = (n: number): string => `$${n.toFixed(2)}`;

/** "$10.44 for the first year, then $10.44 a year", or null when it has no price. */
export function priceLine(q: Pick<DomainQuote, 'priceUsd' | 'renewalPriceUsd'>): string | null {
  if (q.priceUsd == null) return null;
  const first = `${usd(q.priceUsd)} for the first year`;
  return q.renewalPriceUsd == null ? first : `${first}, then ${usd(q.renewalPriceUsd)} a year`;
}

/** A purchase is charged to the workspace's default card; null when there is none to charge. */
export function chargeCard(cards: CardOnFile[]): CardOnFile | null {
  return cards.find((c) => c.isDefault) ?? null;
}

export const cardLabel = (c: Pick<CardOnFile, 'brand' | 'last4'>): string =>
  `${c.brand.charAt(0).toUpperCase()}${c.brand.slice(1)} ending ${c.last4}`;

export const REGISTRANT_FIELDS: ReadonlyArray<{
  key: keyof RegistrantFields;
  label: string;
  placeholder: string;
  optional?: boolean;
  hint?: string;
  wide?: boolean;
}> = [
  { key: 'organization', label: 'Company', placeholder: 'Acme Logistics Inc.', optional: true, wide: true, hint: 'The legal name that owns the domain. Leave it empty for a person.' },
  { key: 'name', label: 'Contact name', placeholder: 'Jane Doe', wide: true },
  { key: 'email', label: 'Email', placeholder: 'jane@acme.com' },
  { key: 'phone', label: 'Phone', placeholder: '+1 416 555 0100', hint: 'With the country code. We send it to the registry as +1.4165550100.' },
  { key: 'street', label: 'Street address', placeholder: '9 King St W', wide: true },
  { key: 'city', label: 'City', placeholder: 'Toronto' },
  { key: 'state', label: 'Province or state', placeholder: 'Ontario', optional: true },
  { key: 'postalCode', label: 'Postal code', placeholder: 'M5H 1A1' },
  { key: 'countryCode', label: 'Country', placeholder: 'CA', hint: 'Two letters: CA, US, GH, GB…' },
];

/** The form, filled from a saved or pre-filled contact; anything missing is empty. */
export function registrantFields(draft?: Partial<Record<keyof RegistrantFields, string | null>> | null): RegistrantFields {
  const v = (k: keyof RegistrantFields) => (typeof draft?.[k] === 'string' ? (draft[k] as string) : '');
  return {
    name: v('name'),
    organization: v('organization'),
    email: v('email'),
    phone: v('phone'),
    street: v('street'),
    city: v('city'),
    state: v('state'),
    postalCode: v('postalCode'),
    countryCode: v('countryCode').toUpperCase(),
  };
}

/** The owner on one line, for the review: "AIYA Logistics · Daniel Frempong · ops@aiya.example". */
export function ownerLine(r: RegistrantFields): string {
  return [r.organization, r.name, r.email].map((s) => s.trim()).filter(Boolean).join(' · ');
}

/** The address on one line: "9 Densley Ave, North York, Ontario M3M 2P4, CA". */
export function addressLine(r: RegistrantFields): string {
  const region = [r.state.trim(), r.postalCode.trim()].filter(Boolean).join(' ');
  return [r.street, r.city, region, r.countryCode].map((s) => s.trim()).filter(Boolean).join(', ');
}

/** How a finished purchase reads. A registered domain is never reported as a failure. */
export function purchaseMessage(domain: string, appName: string, r: PurchaseResponse): { tone: 'success' | 'warning' | 'error'; text: string } {
  if (!r.ok) return { tone: 'error', text: r.error ? sentence(r.error) : `${domain} could not be bought.` };
  if (r.status === 'registered_attach_failed') {
    return {
      tone: 'warning',
      text: `${domain} is registered and paid for, but connecting it to ${appName} failed. Use Add domain to connect it; there is nothing more to pay.`,
    };
  }
  return { tone: 'success', text: `${domain} is yours, and it is connected to ${appName}. Its certificate is being issued; it is usually live within a few minutes.` };
}

const sentence = (s: string): string => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
};
