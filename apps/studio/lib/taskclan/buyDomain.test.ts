import { describe, expect, it } from 'vitest';

import { addressLine, cardLabel, chargeCard, ownerLine, priceLine, purchaseMessage, registrantFields, searchTerm, type CardOnFile } from './buyDomain';

describe('searchTerm', () => {
  it('takes a domain however it was pasted', () => {
    expect(searchTerm('  AiyaLogistics.com ')).toBe('aiyalogistics.com');
    expect(searchTerm('https://www.aiyalogistics.com/about?x=1')).toBe('aiyalogistics.com');
    expect(searchTerm('aiya logistics')).toBe('aiyalogistics');
    expect(searchTerm('   ')).toBe('');
  });
});

describe('prices', () => {
  it('reads the first year and the renewal', () => {
    expect(priceLine({ priceUsd: 10.44, renewalPriceUsd: 12 })).toBe('$10.44 for the first year, then $12.00 a year');
    expect(priceLine({ priceUsd: 10.44, renewalPriceUsd: null })).toBe('$10.44 for the first year');
    expect(priceLine({ priceUsd: null, renewalPriceUsd: 12 })).toBeNull();
  });
});

describe('the card a purchase is charged to', () => {
  const card = (over: Partial<CardOnFile>): CardOnFile => ({ id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 1, expYear: 2030, isDefault: false, ...over });

  it('is the default card, and none when no card is the default', () => {
    expect(chargeCard([card({ id: 'a' }), card({ id: 'b', isDefault: true })])?.id).toBe('b');
    expect(chargeCard([card({ id: 'a' })])).toBeNull();
    expect(chargeCard([])).toBeNull();
  });

  it('reads as the brand and last four digits', () => {
    expect(cardLabel(card({ brand: 'mastercard', last4: '0005' }))).toBe('Mastercard ending 0005');
  });
});

describe('the owner', () => {
  it('fills the form from a saved or pre-filled contact, empty where nothing is known', () => {
    const r = registrantFields({ name: 'Daniel Frempong', organization: null, countryCode: 'ca' });
    expect(r).toMatchObject({ name: 'Daniel Frempong', organization: '', countryCode: 'CA', phone: '' });
  });

  it('summarises on two lines for the review', () => {
    const r = registrantFields({
      organization: '17477953 Canada Corp.', name: 'Daniel Frempong', email: 'ops@aiya.example',
      street: '9 Densley Ave', city: 'North York', state: 'Ontario', postalCode: 'M6M 2P5', countryCode: 'CA',
    });
    expect(ownerLine(r)).toBe('17477953 Canada Corp. · Daniel Frempong · ops@aiya.example');
    expect(addressLine(r)).toBe('9 Densley Ave, North York, Ontario M6M 2P5, CA');
  });
});

describe('how a purchase ends', () => {
  it('says the domain is theirs and where it is connected', () => {
    expect(purchaseMessage('aiyalogistics.com', 'aiya-logistics-web', { ok: true, status: 'active' })).toEqual({
      tone: 'success',
      text: 'aiyalogistics.com is yours, and it is connected to aiya-logistics-web. Its certificate is being issued; it is usually live within a few minutes.',
    });
  });

  it('never reports a registered domain as a failure when connecting it did not work', () => {
    const m = purchaseMessage('aiyalogistics.com', 'aiya-logistics-web', { ok: true, status: 'registered_attach_failed', error: 'attach failed' });
    expect(m.tone).toBe('warning');
    expect(m.text).toContain('registered and paid for');
    expect(m.text).toContain('nothing more to pay');
  });

  it("gives the server's reason as a sentence when it did not go through", () => {
    expect(purchaseMessage('x.com', 'app', { ok: false, error: 'your card was declined' })).toEqual({ tone: 'error', text: 'Your card was declined.' });
    expect(purchaseMessage('x.com', 'app', { ok: false })).toEqual({ tone: 'error', text: 'x.com could not be bought.' });
  });
});
