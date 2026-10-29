import { annualSavingsPercent } from '@/services/subscription-pricing';
import {
  decodeJwsPayload,
  ownershipConflict,
  planForProduct,
  statusFromApple,
} from '../../supabase/functions/_shared/app-store-utils';

function fakeJws(payload: unknown): string {
  const encode = (obj: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return `${encode({ alg: 'ES256' })}.${encode(payload)}.signature`;
}

describe('annualSavingsPercent (Tripseek+ "Save X%" badge)', () => {
  test('works out the saving from real App Store prices', () => {
    expect(annualSavingsPercent(4.99, 39.99)).toBe(33);
    expect(annualSavingsPercent(5.99, 49.99)).toBe(30);
  });

  test('hides the badge when a price is missing or there is no saving', () => {
    expect(annualSavingsPercent(null, 39.99)).toBeNull();
    expect(annualSavingsPercent(4.99, undefined)).toBeNull();
    expect(annualSavingsPercent(4.99, 59.88)).toBeNull();
    expect(annualSavingsPercent(4.99, 70)).toBeNull();
  });
});

describe('planForProduct', () => {
  test('maps current and legacy product IDs', () => {
    expect(planForProduct('com.tripseek.app.plus.monthly')).toBe('monthly');
    expect(planForProduct('com.tripseek.app.plus.annual')).toBe('annual');
    expect(planForProduct('com.toveli.plus.annual')).toBe('annual');
  });

  test('rejects unknown products', () => {
    expect(planForProduct('com.other.app.coins')).toBeNull();
    expect(planForProduct(undefined)).toBeNull();
  });
});

describe('decodeJwsPayload', () => {
  test('decodes Apple transaction payloads, including non-ASCII text', () => {
    const tx = { transactionId: '2000000123', productId: 'com.tripseek.app.plus.annual', note: 'Café' };
    expect(decodeJwsPayload(fakeJws(tx))).toEqual(tx);
  });

  test('throws on malformed input', () => {
    expect(() => decodeJwsPayload('not-a-jws')).toThrow();
  });
});

describe('statusFromApple', () => {
  test('keeps active and grace-period subscribers on Plus', () => {
    expect(statusFromApple(1)).toBe('active');
    expect(statusFromApple(4)).toBe('grace_period');
  });

  test('expired, billing retry and refunded subscriptions lose Plus', () => {
    expect(statusFromApple(2)).toBe('expired');
    expect(statusFromApple(3)).toBe('expired');
    expect(statusFromApple(5)).toBe('expired');
  });
});

describe('ownershipConflict', () => {
  const me = '6f1c2a8e-0000-4000-8000-000000000001';
  const other = '6f1c2a8e-0000-4000-8000-000000000002';

  test('a purchase tagged with this account is fine', () => {
    expect(ownershipConflict({ userId: me, appAccountToken: me.toUpperCase() })).toBe(false);
  });

  test('a purchase tagged with another account is refused', () => {
    expect(ownershipConflict({ userId: me, appAccountToken: other })).toBe(true);
  });

  test('older untagged purchases can only back one account', () => {
    expect(ownershipConflict({ userId: me, existingOwnerId: null })).toBe(false);
    expect(ownershipConflict({ userId: me, existingOwnerId: other })).toBe(true);
  });
});
