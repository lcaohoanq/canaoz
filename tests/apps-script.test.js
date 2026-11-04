import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function makeScript(customRows) {
  const rows = customRows || [
    ['Timestamp', 'Họ và tên', 'MSSV', 'Ca tốt nghiệp', 'Lớp / nhóm', 'Đồng ý công khai'],
    ['today', 'Nguyễn Minh Anh', 'AB123456', 'Ca 3', 'UX', 'Tôi đồng ý'],
    ['today', 'Đặng Thanh Sơn', 'CD111222', 'Ca 1', 'IT', 'Tôi đồng ý'],
    ['today', 'Nguyễn Hồng Anh', 'EF333444', 'Ca 2', 'Marketing', 'Tôi không đồng ý'],
    ['today', 'Nguyễn Minh Anh', 'AB123456', 'Ca 1', 'UX', 'Tôi đồng ý'],
    ['today', 'Phạm Gia Huy', 'GH555666', 'Ca 3', 'Data', 'Tôi đồng ý'],
  ];
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'SECRET' }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (s) => s === 'Form Responses 1' ? {getDataRange: () => ({getDisplayValues: () => rows})} : null }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({ content, setMimeType() { return this; } }),
    },
    console,
  };
  vm.runInNewContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), ctx);
  const post = body => JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(body)}}).content);
  const search = (q, shift = '', token = 'SECRET') => post({q,shift,token});
  return { search, post };
}

test('Apps Script publishes consenting records without a Duyệt column', () => {
  const { search } = makeScript();
  const ids = search('', '3').results.map((x) => x.studentIdMasked);
  assert.deepEqual(ids, ['GH****66']);
  assert.equal(search('CD111222').results.length, 1);
  assert.equal(search('EF333444').results.length, 0);
  assert.equal(search('AB123456').results[0].shift, 1);
});

test('Apps Script searches accents and full MSSV but masks output', () => {
  const { search } = makeScript();
  assert.equal(search('nguyen minh anh').results[0].name, 'Nguyễn Minh Anh');
  assert.equal(search('ab123456').results[0].studentIdMasked, 'AB****56');
  assert.equal(search('AB123456', '2').results.length, 0);
});

test('Apps Script blocks missing/bad token', () => {
  const { search } = makeScript();
  assert.equal(search('AB123456', '', 'WRONG').ok, false);
});

test('hybrid protocol acknowledges empty responses, normalizes exclusions and rejects malformed requests', () => {
  const { post } = makeScript();
  assert.deepEqual(post({ token: 'SECRET', mergeVersion: 1, excludeStudentIds: [], q: '', shift: '' }), { ok: true, results: [], mergeVersion: 1 });
  assert.deepEqual(post({ token: 'SECRET', mergeVersion: 1, excludeStudentIds: [' ab123456 '], q: 'AB123456' }), { ok: true, results: [], mergeVersion: 1 });
  for (const excludeStudentIds of [undefined, null, 'AB123456', ['AB12345']]) {
    assert.equal(post({ token: 'SECRET', mergeVersion: 1, excludeStudentIds, shift: '1' }).error, 'invalid_exclusions');
  }
  assert.equal(post({ token: 'SECRET', mergeVersion: 2, excludeStudentIds: [] }).error, 'unsupported_merge_version');
  const empty = makeScript([['Họ và tên', 'MSSV', 'Ca tốt nghiệp', 'Lớp / nhóm', 'Đồng ý công khai']]);
  assert.equal(empty.post({ token: 'SECRET', mergeVersion: 1, excludeStudentIds: [], shift: '1' }).mergeVersion, 1);
});
