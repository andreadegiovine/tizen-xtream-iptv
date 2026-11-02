import { dbGet, dbGetAll, dbPut, dbDelete } from '../core/idb.js';
import { kvGet, kvSet, kvDelete } from '../db/kv.js';
import { deleteProviderDb } from '../db/providerDb.js';
import { AppError, ErrorCode } from '../core/errors.js';

const ACTIVE_KEY = 'activeProviderId';

function generateId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** CRUD for configured providers plus the "active provider" pointer. */
export class ProviderStore {
  constructor(db, { removeProviderDb = deleteProviderDb } = {}) {
    this.db = db;
    this.removeProviderDb = removeProviderDb;
  }

  async list() {
    const all = await dbGetAll(this.db, 'providers');
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id) {
    return dbGet(this.db, 'providers', id);
  }

  async add({ name, baseUrl, username, password }) {
    if (!name || !baseUrl || !username || !password) {
      throw new AppError(ErrorCode.INVALID_INPUT, 'Missing provider fields');
    }
    const provider = { id: generateId(), name, baseUrl, username, password, createdAt: Date.now() };
    await dbPut(this.db, 'providers', provider);
    return provider;
  }

  async update(id, patch) {
    const current = await this.get(id);
    if (!current) throw new AppError(ErrorCode.INVALID_INPUT, 'Unknown provider');
    const next = { ...current, ...patch, id };
    await dbPut(this.db, 'providers', next);
    return next;
  }

  async remove(id) {
    await dbDelete(this.db, 'providers', id);
    await this.removeProviderDb(id);
    if ((await this.getActiveId()) === id) {
      const [first] = await this.list();
      if (first) await this.setActiveId(first.id);
      else await kvDelete(this.db, ACTIVE_KEY);
    }
  }

  getActiveId() {
    return kvGet(this.db, ACTIVE_KEY, null);
  }

  setActiveId(id) {
    return kvSet(this.db, ACTIVE_KEY, id);
  }

  async getActive() {
    const id = await this.getActiveId();
    return id ? (await this.get(id)) || null : null;
  }
}
