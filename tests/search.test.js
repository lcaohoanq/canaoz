import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyQuery, filterRecords, maskStudentId, normalizeName } from '../src/lib/search.js';

const people = [
  { name: 'Nguyễn Minh Anh', studentId: 'AB123456', shift: 3, group: 'UX' },
  { name: 'Đặng Thanh Sơn', studentId: 'CD111222', shift: 1, group: '' },
  { name: 'Nguyễn Hồng Anh', studentId: 'EF333444', shift: 2, group: '' },
];

test('MSSV regex: exactly 2 ASCII letters + 6 digits; case insensitive', () => {
  assert.deepEqual(classifyQuery('ab123456'), { kind: 'id', value: 'AB123456' });
  for (const input of ['AB12345', 'A123456', 'ABC123456', 'AB1234567']) {
    assert.notEqual(classifyQuery(input).kind, 'id', input);
  }
});

test('Vietnamese names can be matched without accents, including đ', () => {
  assert.equal(normalizeName('Đặng   Thanh Sơn'), 'dang thanh son');
  assert.equal(filterRecords(people, 'dang thanh', null)[0].name, 'Đặng Thanh Sơn');
  assert.equal(filterRecords(people, 'nguyen', null).length, 2);
});

test('exact MSSV search, shift filters, no full ID leaked', () => {
  const result = filterRecords(people, 'ab123456', 3);
  assert.equal(result.length, 1);
  assert.equal(result[0].studentIdMasked, 'AB****56');
  assert.equal(Object.hasOwn(result[0], 'studentId'), false);
  assert.equal(filterRecords(people, 'ab123456', 1).length, 0);
});

test('no query returns only selected shift; no unrestricted dump', () => {
  assert.equal(filterRecords(people, '', null).length, 0);
  assert.equal(filterRecords(people, '', 1).length, 1);
  assert.equal(maskStudentId('oops'), '********');
});
