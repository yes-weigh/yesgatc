const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readSerialPlateHandler } = require('./readSerialPlate');

test('readSerialPlate rejects missing GEMINI_API_KEY after auth', async () => {
  await assert.rejects(
    () =>
      readSerialPlateHandler(
        { auth: { uid: 'u1' }, data: { imageBase64: 'a'.repeat(80) } },
        async () => 'super_admin',
        '',
      ),
    err => err && err.code === 'failed-precondition',
  );
});

test('readSerialPlate rejects unauthenticated callers before key check', async () => {
  await assert.rejects(
    () => readSerialPlateHandler({ data: {} }, async () => 'super_admin', ''),
    err => err && err.code === 'unauthenticated',
  );
});
