const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyFailure,
  parseRetryDelays,
  versionsMatch,
} = require('../run-helper');

test('accepts an exact Actual API and server version match', () => {
  assert.equal(versionsMatch('26.7.0', '26.7.0'), true);
});

test('rejects an older helper API version', () => {
  assert.equal(versionsMatch('26.5.2', '26.7.0'), false);
});

test('classifies migration skew as permanent', () => {
  assert.equal(
    classifyFailure('Error: out-of-sync-migrations'),
    'permanent',
  );
});

test('classifies authentication and configuration failures as permanent', () => {
  assert.equal(classifyFailure('Required settings for Actual not provided.'), 'permanent');
  assert.equal(classifyFailure('Error: invalid password'), 'permanent');
});

test('classifies network and provider failures as transient', () => {
  assert.equal(classifyFailure('PostError: network-failure'), 'transient');
  assert.equal(classifyFailure('FetchError: connect ETIMEDOUT'), 'transient');
  assert.equal(classifyFailure('HTTP 503 Service Unavailable'), 'transient');
});

test('fails unknown errors without retrying', () => {
  assert.equal(classifyFailure('Error: unexpected data shape'), 'unknown');
});

test('parses a bounded exponential retry schedule', () => {
  assert.deepEqual(parseRetryDelays('60,300,900'), [60, 300, 900]);
  assert.throws(() => parseRetryDelays('60,-1,900'), /positive integers/);
});
