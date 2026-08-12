import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseId } from '../src/ygo-pic-proxy.js';

test('valid id', () => {
  assert.equal(parseId('12345.jpg'), '12345');
});

test('too long id', () => {
  assert.equal(parseId('12345678901.jpg'), null);
});

test('non-digit id', () => {
  assert.equal(parseId('abc.jpg'), null);
});

test('missing .jpg', () => {
  assert.equal(parseId('12345'), null);
});

test('empty id', () => {
  assert.equal(parseId('.jpg'), null);
});
