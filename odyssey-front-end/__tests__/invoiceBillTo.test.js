/**
 * The address under INVOICE TO on the freight print - functions/invoiceBillTo.
 * It was always the job client's, whoever the invoice was to.
 */
import { billToAddress } from 'functions/invoiceBillTo';

const job = { SE_Job: { Client: { name: 'ABC TRADERS', address1: '12 Client Road', address2: 'Karachi' } } };

test('the invoiced party\'s own address, as the server sends it', () => {
  expect(billToAddress({
    ...job, party_Name: 'MAERSK LINE',
    recipient: { name: 'MAERSK LINE', address1: 'Maersk House, Clifton', address2: '' },
  })).toEqual(['Maersk House, Clifton']);
});

test('NOT the job client\'s address under another party\'s name', () => {
  expect(billToAddress({ ...job, party_Name: 'MAERSK LINE' })).toEqual([]);
});

test('the job client\'s, when the client is who it is to and nothing else came', () => {
  expect(billToAddress({ ...job, party_Name: ' abc traders ' })).toEqual(['12 Client Road', 'Karachi']);
});

test('a customs or aviation invoice with no freight job', () => {
  expect(billToAddress({ SE_Job: null, party_Name: 'X', recipient: null })).toEqual([]);
  expect(billToAddress(undefined)).toEqual([]);
});
