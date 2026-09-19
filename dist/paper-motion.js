(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PaperMotion = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createFragments(output, code) {
    if (!output.ownerDocument || !output.parentElement) return null;
    const document = output.ownerDocument;
    const field = document.createElement('div');
    field.className = 'fragment-field is-dissolving';
    field.setAttribute('aria-hidden', 'true');
    const columns = 14;
    const rows = 4;
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const fragment = document.createElement('span');
        const left = column * 100 / columns;
        const right = 100 - ((column + 1) * 100 / columns);
        const top = row * 100 / rows;
        const bottom = 100 - ((row + 1) * 100 / rows);
        const verticalDirection = row % 2 ? 1 : -1;
        const horizontalDirection = (row + column) % 2 ? 1 : -1;
        fragment.textContent = code;
        fragment.style.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
        fragment.style.setProperty('--delay', `${column * 38 + row * 11}ms`);
        fragment.style.setProperty('--dx', `${horizontalDirection * (18 + row * 7)}px`);
        fragment.style.setProperty('--dy', `${verticalDirection * (12 + row * 8)}px`);
        fragment.style.setProperty('--spin', `${horizontalDirection * (4 + row * 2)}deg`);
        field.append(fragment);
      }
    }
    output.parentElement.append(field);
    return field;
  }

  function playScanResult({ output, code, onComplete, schedule = setTimeout, fragmentize = createFragments }) {
    output.value = code;
    output.textContent = code;
    output.hidden = false;
    output.classList.remove('is-fading');
    output.classList.add('is-visible');
    schedule(() => {
      output.classList.add('is-fading');
      const fragments = fragmentize(output, code);
      schedule(() => {
        if (fragments && typeof fragments.remove === 'function') fragments.remove();
        onComplete();
      }, 900);
    }, 1100);
  }

  return { playScanResult, createFragments };
}));
