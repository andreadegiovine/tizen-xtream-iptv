/** Tiny hyperscript helper: h('div', { class: 'x', onClick }, child, 'text'). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else el.setAttribute(key, value === true ? '' : value);
  });
  children.flat(Infinity).forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return el;
}

/** Class list from parts, the empty ones left out: cx('btn', primary && 'primary', extra) → "btn primary extra". */
export const cx = (...parts) => parts.filter(Boolean).join(' ');
