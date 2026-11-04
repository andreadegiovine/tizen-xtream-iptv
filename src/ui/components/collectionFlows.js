import { t } from '../../i18n/index.js';
import { log } from '../../core/logger.js';

/**
 * "Add to a collection": the same search box used to merge Live TV channels, listing the collections (the first row creates a
 * new one named after what is typed). `entry` is the catalog entry (movie, series, channel or channel group) being added.
 * Resolves with `{ collection, created }`, or null when dismissed.
 */
export async function addToCollection(ctx, { providerId, entry }) {
  const picked = await ctx.dialogs.search({
    title: t('collections.add'),
    placeholder: t('collections.namePlaceholder'),
    emptyLabel: t('common.empty'),
    minLength: 0,
    createLabel: (name) => t('collections.create', { name }),
    run: async (text) => (await ctx.collections.search(providerId, text)).map((c) => ({ key: c.id, name: c.name, collectionId: c.id })),
  });
  if (!picked) return null;
  try {
    if (picked.create) {
      const collection = await ctx.collections.create(providerId, picked.name, [entry.key]);
      ctx.notices.success(t('notice.added'), { key: 'collection' });
      return { collection, created: true };
    }
    const added = await ctx.collections.addEntry(picked.collectionId, entry.key);
    ctx.notices.success(t(added ? 'notice.added' : 'notice.done'), { key: 'collection' });
    return { collection: await ctx.collections.get(picked.collectionId), created: false };
  } catch (err) {
    log.warn('Add to collection failed', err && err.message);
    ctx.notices.error(t('error.UNKNOWN'), { key: 'collection' });
    return null;
  }
}
