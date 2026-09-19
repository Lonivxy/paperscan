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
    const xBounds = [0, 7, 16, 24, 35, 43, 56, 64, 75, 87, 94, 100];
    const yBounds = [0, 18, 46, 69, 100];
    for (let column = 0; column < xBounds.length - 1; column += 1) {
      for (let row = 0; row < yBounds.length - 1; row += 1) {
        const left = xBounds[column];
        const right = xBounds[column + 1];
        const top = yBounds[row];
        const bottom = yBounds[row + 1];
        const triangles = (column + row) % 2
          ? [[[left, top], [right, top], [left, bottom]], [[right, top], [right, bottom], [left, bottom]]]
          : [[[left, top], [right, top], [right, bottom]], [[left, top], [right, bottom], [left, bottom]]];
        triangles.forEach((points, piece) => {
          const fragment = document.createElement('span');
          const verticalDirection = (row + piece) % 2 ? 1 : -1;
          const horizontalDirection = (row + column + piece) % 2 ? 1 : -1;
          const variation = ((column * 17 + row * 13 + piece * 7) % 11) - 5;
          fragment.textContent = code;
          fragment.style.clipPath = `polygon(${points.map(([x, y]) => `${x}% ${y}%`).join(',')})`;
          fragment.style.setProperty('--delay', `${column * 43 + row * 9 + piece * 17}ms`);
          fragment.style.setProperty('--dx', `${horizontalDirection * (20 + row * 8 + variation)}px`);
          fragment.style.setProperty('--dy', `${verticalDirection * (14 + piece * 11 + Math.abs(variation))}px`);
          fragment.style.setProperty('--spin', `${horizontalDirection * (7 + row * 4 + variation)}deg`);
          fragment.style.setProperty('--shrink', `${0.38 + ((column + row + piece) % 4) * 0.08}`);
          field.append(fragment);
        });
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
      output.classList.remove('is-visible');
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
