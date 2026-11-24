/**
 * The quantity a charge starts with on a freight job's charge sheet -
 * functions/freightChargeQty. Sea P/Unit charges read Bill Vol; they read the
 * air-only CWT (Client), so started at 1.
 */
import { startingQty } from 'functions/freightChargeQty';

const job = { billVol: '12.5', cwtClient: '340' };

describe('the starting quantity of a picked charge', () => {
  test('a sea P/Unit charge takes Bill Vol, export and import', () => {
    expect(startingQty('Per Unit', 'SE', job)).toBe(12.5);
    expect(startingQty('Per Unit', 'SI', job)).toBe(12.5);
  });

  test('an air P/Unit charge still takes CWT (Client)', () => {
    expect(startingQty('Per Unit', 'AE', job)).toBe(340);
    expect(startingQty('Per Unit', 'AI', job)).toBe(340);
  });

  test('a per-shipment charge is 1', () => {
    expect(startingQty('Per Shipment', 'SE', job)).toBe(1);
  });

  test('no Bill Vol, or zero, starts at 1 rather than 0', () => {
    expect(startingQty('Per Unit', 'SE', { billVol: '' })).toBe(1);
    expect(startingQty('Per Unit', 'SE', { billVol: 0 })).toBe(1);
    expect(startingQty('Per Unit', 'SE', {})).toBe(1);
    expect(startingQty('Per Unit', 'SE', undefined)).toBe(1);
  });
});
