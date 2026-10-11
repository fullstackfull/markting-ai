import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PII_FIELDS } from '@/lib/markting/commerce/pii';
import {
  assertNoHighRiskFields,
  assertSafeProjection,
  classifyField,
  classifyMap,
  isHighRisk,
  redactionPlan,
  type PiiClass,
} from '@/lib/markting/ops/pii-classification';

/**
 * Phase C.6 (26) — PII classifier. Deterministic name + value heuristics, a redaction plan, and a
 * projection guard. Reuses the commerce FORBIDDEN_PII_FIELDS as the known-PII floor.
 */
describe('name heuristics', () => {
  it('classifies payment-y names as PAYMENT by segment/phrase, not substring', () => {
    expect(classifyField('cardNumber').class).toBe('PAYMENT');
    expect(classifyField('iban').class).toBe('PAYMENT');
    expect(classifyField('cvv').class).toBe('PAYMENT');
    expect(classifyField('bank_account_number').class).toBe('PAYMENT');
  });

  it('does NOT false-positive analytics keys that merely share letters', () => {
    expect(classifyField('paymentStatus').class).toBe('NONE');
    expect(classifyField('orderNumber').class).toBe('NONE');
    expect(classifyField('customerClass').class).toBe('NONE');
    expect(classifyField('grossMinor').class).toBe('NONE');
  });

  it('classifies direct identifiers and sensitive names', () => {
    expect(classifyField('email').class).toBe('DIRECT_IDENTIFIER');
    expect(classifyField('customer.first_name').class).toBe('DIRECT_IDENTIFIER');
    expect(classifyField('shipping_address_1').class).toBe('DIRECT_IDENTIFIER');
    expect(classifyField('ip_address').class).toBe('DIRECT_IDENTIFIER');
    expect(classifyField('ssn').class).toBe('SENSITIVE');
    expect(classifyField('date_of_birth').class).toBe('SENSITIVE');
  });

  it('classifies quasi-identifiers as LOW', () => {
    expect(classifyField('city').class).toBe('LOW');
    expect(classifyField('postcode').class).toBe('LOW');
    expect(classifyField('country').class).toBe('LOW');
  });
});

describe('value heuristics (name is innocuous)', () => {
  it('detects email / phone / IP in the value as DIRECT_IDENTIFIER', () => {
    expect(classifyField('freeText', 'jane@example.com').class).toBe('DIRECT_IDENTIFIER');
    expect(classifyField('freeText', '+1 (415) 555-0132').class).toBe('DIRECT_IDENTIFIER');
    expect(classifyField('freeText', '192.168.1.42').class).toBe('DIRECT_IDENTIFIER');
    expect(classifyField('matchedBy', 'value').matchedBy).toBe('none'); // sanity: plain words unmatched
  });

  it('detects a Luhn-valid card number in the value as PAYMENT', () => {
    expect(classifyField('ref', '4242 4242 4242 4242').class).toBe('PAYMENT'); // valid Luhn test PAN
  });

  it('does not treat random numbers or words as PII', () => {
    expect(classifyField('ref', '123456').class).toBe('NONE');
    expect(classifyField('ref', 'hello world').class).toBe('NONE');
    expect(classifyField('ref', '1234567890123456').class).toBe('NONE'); // 16 digits but fails Luhn
  });

  it('name+value both matched reports matchedBy both and keeps strictest class', () => {
    const c = classifyField('email', 'jane@example.com');
    expect(c.class).toBe('DIRECT_IDENTIFIER');
    expect(c.matchedBy).toBe('both');
  });
});

describe('FORBIDDEN_PII_FIELDS reuse', () => {
  it('never classifies a known forbidden field as NONE', () => {
    for (const f of FORBIDDEN_PII_FIELDS) {
      const c = classifyField(f).class;
      expect(c, `${f} should not be NONE`).not.toBe('NONE');
    }
  });
});

describe('classifyMap + redactionPlan', () => {
  const record = {
    orderId: 'o-1',
    grossMinor: 1999,
    email: 'buyer@shop.com',
    customer: { first_name: 'Jane', city: 'Berlin' },
    cardNumber: '4242424242424242',
  };

  it('flattens nested maps with dotted paths', () => {
    const fields = classifyMap(record).map((c) => c.field);
    expect(fields).toContain('customer.first_name');
    expect(fields).toContain('customer.city');
  });

  it('produces a deterministic redaction plan with the expected actions', () => {
    const plan = redactionPlan(record);
    const byField = new Map(plan.map((p) => [p.field, p.action]));
    expect(byField.get('orderId')).toBe('KEEP');
    expect(byField.get('email')).toBe('PSEUDONYMIZE');
    expect(byField.get('customer.first_name')).toBe('PSEUDONYMIZE');
    expect(byField.get('customer.city')).toBe('MASK');
    expect(byField.get('cardNumber')).toBe('DROP');
    // Deterministic: same input, same plan.
    expect(redactionPlan(record)).toEqual(plan);
  });
});

describe('projection guard', () => {
  it('flags high-risk fields in a model-bound projection', () => {
    const { safe, violations } = assertSafeProjection({ sku: 'A', email: 'x@y.com', ssn: '000-00-0000' });
    expect(safe).toBe(false);
    expect(violations.map((v) => v.field).sort()).toEqual(['email', 'ssn']);
  });

  it('passes a clean analytics-safe projection', () => {
    const res = assertSafeProjection({ orderId: 'o', grossMinor: 10, customerClass: 'new', city: 'Berlin' });
    expect(res.safe).toBe(true);
    expect(() => assertNoHighRiskFields({ orderId: 'o', grossMinor: 10 })).not.toThrow();
  });

  it('assertNoHighRiskFields throws listing the offenders', () => {
    expect(() => assertNoHighRiskFields({ phone: '+14155550132' })).toThrow(/PII guard tripped/);
  });

  it('isHighRisk matches the documented set', () => {
    const risk: PiiClass[] = ['DIRECT_IDENTIFIER', 'SENSITIVE', 'PAYMENT'];
    for (const c of risk) expect(isHighRisk(c)).toBe(true);
    expect(isHighRisk('NONE')).toBe(false);
    expect(isHighRisk('LOW')).toBe(false);
  });
});
