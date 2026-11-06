import { Action } from '../../core/input.js';
import { Dir } from './models.js';

const DIRECTIONS = {
  [Action.UP]: Dir.UP,
  [Action.DOWN]: Dir.DOWN,
  [Action.LEFT]: Dir.LEFT,
  [Action.RIGHT]: Dir.RIGHT,
};

/** A focusable region (topbar, grid, form...). It remembers its own index. */
export class FocusZone {
  constructor({ id, model, onFocus, onBlur, onActivate, onLongActivate = null }) {
    this.id = id;
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
