import { Action } from '../../core/input.js';
import { Dir } from './models.js';

const DIRECTIONS = {
  [Action.UP]: Dir.UP,
  [Action.DOWN]: Dir.DOWN,
  [Action.LEFT]: Dir.LEFT,
  [Action.RIGHT]: Dir.RIGHT,
};

/**
 * A focusable region (topbar, grid, form...). It remembers its own index.
 * For the pointer (mouse, touch, Magic Remote): `nodes()` gives the element of each index (the one under the pointer becomes the focus),
 * or `locate(target)` finds the index of an element itself (null when it is not one of the zone's).
 */
export class FocusZone {
  constructor({ id, model, onFocus, onBlur, onActivate, onLongActivate = null, nodes = null, locate = null }) {
    this.id = id;
    this.nodes = nodes;
    this.locate = locate;
    this.onLongActivate = onLongActivate; // OK held down (null: a long press is a normal one)
    this.model = model;
    this.onFocus = onFocus || (() => {});
    this.onBlur = onBlur || (() => {});
    this.onActivate = onActivate || (() => {});
    this.index = 0;
  }

  get count() {
    return this.model.getCount();
  }

  canFocus() {
    return this.count > 0;
  }

  clamp(index) {
    return Math.max(0, Math.min(index, this.count - 1));
  }
}

/** Moves focus inside a zone, and between zones through explicit links (zone A --down--> zone B). */
export class FocusManager {
  constructor() {
    this.zones = new Map();
    this.links = new Map();
    this.activeId = null;
  }

  register(zone) {
    this.zones.set(zone.id, zone);
    return () => this.unregister(zone.id);
  }

  unregister(id) {
    if (this.activeId === id) this.activeId = null;
    this.zones.delete(id);
    this.links.delete(id);
    // Drop links pointing at the removed zone, so a stale target is never followed.
    this.links.forEach((byDir) => {
      Object.keys(byDir).forEach((dir) => {
        if (byDir[dir] === id) delete byDir[dir];
      });
    });
  }

  link(fromId, dir, toId) {
    if (!this.links.has(fromId)) this.links.set(fromId, {});
    this.links.get(fromId)[dir] = toId;
  }

  get active() {
    return this.activeId ? this.zones.get(this.activeId) : null;
  }

  focus(id, index) {
    const zone = this.zones.get(id);
    if (!zone || !zone.canFocus()) return false;
    const current = this.active;
    if (current) current.onBlur(current.index);
    zone.index = zone.clamp(index === undefined ? zone.index : index);
    this.activeId = id;
    zone.onFocus(zone.index);
    return true;
  }

  /**
   * The zone and index of the element under the pointer (`target` or one of its ancestors), or null. The zones registered last (a dialog)
   * come first; among several, the smallest element that holds the target wins (a card rather than the row around it).
   */
  locate(target) {
    if (!target || target.nodeType !== 1) return null;
    let best = null;
    const zones = Array.from(this.zones.values()).reverse();
    for (const zone of zones) {
      if (!zone.canFocus()) continue;
      if (zone.locate) {
        const index = zone.locate(target);
        if (index !== null && index !== undefined && index >= 0) return { id: zone.id, index };
        continue;
      }
      if (!zone.nodes) continue;
      const list = zone.nodes() || [];
      for (let i = 0; i < list.length; i += 1) {
        const node = list[i];
        if (node && node.contains && node.contains(target) && (!best || best.node.contains(node))) best = { id: zone.id, index: i, node };
      }
      if (best) break; // a later (upper) zone holds it: the zones under it are not looked at
    }
    return best ? { id: best.id, index: best.index } : null;
  }

  /** OK on an index of a zone (a click): the focus goes there first. `long`: a long press (right click, long touch). */
  activate(id, index, { long = false } = {}) {
    if (!this.focus(id, index)) return false;
    const zone = this.zones.get(id);
    if (long) {
      if (!zone.onLongActivate) return false;
      zone.onLongActivate(zone.index);
    } else zone.onActivate(zone.index);
    return true;
  }

  /** Returns true when the action was consumed. */
  handle(action) {
    const zone = this.active;
    if (!zone) return false;
    if (action === Action.ENTER) {
      zone.onActivate(zone.index);
      return true;
    }
    if (action === Action.LONG_ENTER) {
      (zone.onLongActivate || zone.onActivate)(zone.index);
      return true;
    }
    const dir = DIRECTIONS[action];
    if (!dir) return false;
    if (!zone.canFocus()) return true;

    const result = zone.model.navigate(dir, zone.clamp(zone.index));
    if (result.type === 'move') {
      zone.onBlur(zone.index);
      zone.index = zone.clamp(result.index);
      zone.onFocus(zone.index);
      return true;
    }

    // Follow links, skipping empty zones, with a guard against cycles.
    let fromId = zone.id;
    for (let hops = 0; hops < this.zones.size; hops += 1) {
      const targetId = (this.links.get(fromId) || {})[dir];
      if (!targetId) break;
      if (this.focus(targetId)) return true;
      fromId = targetId;
    }
    return true;
  }
}
