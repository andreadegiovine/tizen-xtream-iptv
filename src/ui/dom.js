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
  children.flat().forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return el;
}

export function toast(message, ms = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('visible'), ms);
}
