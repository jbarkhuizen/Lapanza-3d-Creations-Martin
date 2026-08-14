import { colourHex } from '../data/site.js';

export function enhanceColourCards() {
  document.querySelectorAll('[data-colour-name]').forEach((card) => {
    if (card.querySelector('.swatch-block')) return;
    card.classList.add('swatch-card');
    const name = card.getAttribute('data-colour-name');
    const hex = colourHex(name);
    const block = document.createElement('div');
    block.className = 'swatch-block';
    block.style.background = `linear-gradient(145deg, ${hex}, ${hex}cc)`;
    block.title = name;
    card.prepend(block);
  });
}
