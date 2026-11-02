/**
 * Stack router. A page is { el, mount?(), destroy?(), saveState?(), restoreState?(s), onBack?() }.
 * Off-screen pages are destroyed (TV memory is scarce); only their small state object is kept.
 */
export class Router {
  constructor({ container, routes, onChange = () => {} }) {
    this.container = container;
    this.routes = routes;
    this.onChange = onChange;
    this.stack = [];
    this.page = null;
  }

  get depth() {
    return this.stack.length;
  }

  get current() {
    return this.stack[this.stack.length - 1] || null;
  }

  push(name, params = {}) {
    this.detach(true);
    this.stack.push({ name, params, state: null });
    this.show();
  }

  replace(name, params = {}) {
    this.detach(false);
    this.stack[this.stack.length - 1] = { name, params, state: null };
    this.show();
  }

  reset(name, params = {}) {
    this.detach(false);
    this.stack = [{ name, params, state: null }];
    this.show();
  }

  /** Re-creates the current page (e.g. after a language change), keeping its saved state. */
  reload() {
    if (!this.current) return;
    this.detach(true);
    this.show();
  }

  /** Returns true if something handled Back; false means the root was reached. */
  back() {
    if (this.page && this.page.onBack && this.page.onBack()) return true;
    if (this.stack.length <= 1) return false;
    this.detach(false);
    this.stack.pop();
    this.show();
    return true;
  }

  detach(saveState) {
    const entry = this.current;
    if (this.page) {
      if (saveState && entry && this.page.saveState) entry.state = this.page.saveState();
      if (this.page.destroy) this.page.destroy();
      this.page = null;
    }
    while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
  }

  show() {
    const entry = this.current;
    const factory = this.routes[entry.name];
    if (!factory) throw new Error(`Unknown route: ${entry.name}`);
    this.page = factory(entry.params, entry);
    this.container.appendChild(this.page.el);
    if (this.page.mount) this.page.mount();
    if (entry.state && this.page.restoreState) this.page.restoreState(entry.state);
    this.onChange(entry, this.page);
  }
}
