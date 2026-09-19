'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PaperMotion = require('../dist/paper-motion.js');

function fakeOutput() {
  const classes = new Set();
  return {
    hidden: true,
    value: '',
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
  };
}

test('successful scan rises into place, fragments left-to-right, then turns the page', () => {
  const output = fakeOutput();
  const scheduled = [];
  const fragmentCalls = [];
  let completed = false;
  const schedule = (callback, delay) => scheduled.push({ callback, delay });

  PaperMotion.playScanResult({
    output,
    code: 'P59937A0116',
    schedule,
    fragmentize: (element, code) => fragmentCalls.push({ element, code }),
    onComplete: () => { completed = true; },
  });

  assert.equal(output.value, 'P59937A0116');
  assert.equal(output.hidden, false);
  assert.equal(output.classList.contains('is-visible'), true);
  assert.deepEqual(scheduled.map(item => item.delay), [1100]);

  scheduled.shift().callback();
  assert.equal(output.classList.contains('is-fading'), true);
  assert.deepEqual(fragmentCalls, [{ element: output, code: 'P59937A0116' }]);
  assert.deepEqual(scheduled.map(item => item.delay), [900]);

  scheduled.shift().callback();
  assert.equal(completed, true);
});
