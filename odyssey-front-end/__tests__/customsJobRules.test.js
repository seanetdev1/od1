import { clientInvoiceNo, hasJobReference } from '../functions/customsJobReference';
import { customsStatusLabel } from '../functions/customsStatus';

describe('a customs job saves with any one of its three references', () => {
  test.each([
    ['S/R Page #', { jobRef: 'SR-1726' }],
    ['Client Invoice #', { clientRef: 'AMA-18792-26' }],
    ['GD #', { gdNumber: 'KAPE-50712' }],
  ])('%s alone is enough', (_, job) => {
    expect(hasJobReference(job)).toBe(true);
  });

  test('none of them - or only blanks - is not', () => {
    expect(hasJobReference({})).toBe(false);
    expect(hasJobReference({ jobRef: '  ', clientRef: '', gdNumber: null })).toBe(false);
  });
});

describe('the Client Invoice # - one number, on Job Details and Booking Info alike', () => {
  test('the whole number (invoiceNo) over the copy Climax cut at 20 characters (clientRef)', () => {
    expect(clientInvoiceNo({ clientRef: 'ES-15411,15412 & 154', invoiceNo: 'ES-15411,15412 & 15417' })).toBe('ES-15411,15412 & 15417');
  });

  test('the copy when it is all an old job has; nothing when neither is filled', () => {
    expect(clientInvoiceNo({ clientRef: 'AMA-18792-26', invoiceNo: '  ' })).toBe('AMA-18792-26');
    expect(clientInvoiceNo({})).toBe('');
  });

  test('a job with only the Booking Info copy still has a reference to save by', () => {
    expect(hasJobReference({ invoiceNo: 'AMA-18792-26' })).toBe(true);
  });
});

describe('customs status labels', () => {
  test('Complete is On Vessel, Incomplete is In Process; the others as they are', () => {
    expect(customsStatusLabel('Complete')).toBe('On Vessel');
    expect(customsStatusLabel('Incomplete')).toBe('In Process');
    expect(customsStatusLabel('DrayOff')).toBe('DrayOff');
    expect(customsStatusLabel('Canceled')).toBe('Canceled');
  });
});

import { receivableWaitsForVessel } from '../functions/customsStatus';

describe('receivables wait for the job to be On Vessel', () => {
  test('a receivable waits until the status is On Vessel (stored Complete)', () => {
    expect(receivableWaitsForVessel({ type: 'Recievable' }, 'Incomplete')).toBe(true);
    expect(receivableWaitsForVessel({ type: 'Recievable' }, undefined)).toBe(true);
    expect(receivableWaitsForVessel({ type: 'Recievable' }, 'Complete')).toBe(false);
    // DrayOff bills too - a file that ends at the container drop.
    expect(receivableWaitsForVessel({ type: 'Recievable' }, 'DrayOff')).toBe(false);
    expect(receivableWaitsForVessel({ type: 'Recievable' }, 'Canceled')).toBe(true);
  });

  test('a payable never waits', () => {
    expect(receivableWaitsForVessel({ type: 'Payble' }, 'Incomplete')).toBe(false);
  });
});

import { billableLabels, customsStatusLabel as labelWith } from '../functions/customsStatus';

describe('with the job statuses Configuration > Customs sets', () => {
  const list = [
    { value: 'Incomplete', label: 'Under Clearance', color: 'blue', rules: ['start'], hidden: false },
    { value: 'Docs Awaited', label: 'Docs Awaited', color: 'orange', rules: ['billable'], hidden: false },
    { value: 'Complete', label: 'Sailed', color: 'green', rules: ['finished'], hidden: false },
  ];

  test('names come from it', () => {
    expect(labelWith('Complete', list)).toBe('Sailed');
    expect(labelWith('Docs Awaited', list)).toBe('Docs Awaited');
  });

  test('a receivable waits until the job is at a status whose rules bill it', () => {
    expect(receivableWaitsForVessel({ type: 'Recievable' }, 'Docs Awaited', list)).toBe(false);
    expect(receivableWaitsForVessel({ type: 'Recievable' }, 'Complete', list)).toBe(true);
    expect(billableLabels(list)).toBe('Docs Awaited');
    expect(billableLabels()).toBe('On Vessel or DrayOff');
  });
});
