import { h } from '../dom.js';
import { icon as iconNode } from '../icons.js';

/** The dot between two parts of a meta line (year · rating · duration). */
export const createMetaSeparator = () => h('span', { class: 'meta-sep', text: '·' });

/** A rating with its star (`.meta-rating`). */
export const createMetaRating = (text) => h('span', { class: 'meta-rating' }, iconNode('star'), h('span', { text }));

/** A plain part of a meta line. */
export const createMetaText = (text) => h('span', { text });
