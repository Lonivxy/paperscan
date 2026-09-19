(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PaperMotion = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function playScanResult({ output, code, onComplete, schedule = setTimeout }) {
    output.value = code;
    output.textContent = code;
    output.hidden = false;
    output.classList.remove('is-fading');
    output.classList.add('is-visible');
    schedule(() => {
      output.classList.add('is-fading');
      schedule(onComplete, 520);
    }, 900);
  }

  return { playScanResult };
}));
