import test from 'node:test';
import assert from 'node:assert/strict';
import searchHandler from '../api/search.js';

function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value || ''; },
  };
}

test('search endpoint rejects a short query without calling Piped', async () => {
  const req = { method: 'GET', query: { query: 'a' } };
  const res = mockResponse();
  await searchHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_query');
});

test('search endpoint rejects methods other than GET', async () => {
  const req = { method: 'POST', query: {} };
  const res = mockResponse();
  await searchHandler(req, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET');
});
