import { rebuildEntries } from './catalogSync.js';

/** Rebuilds the Live TV entries and groups of the active provider from the stored channels (settings or links changed). */
export async function rebuildLive(ctx) {
  const active = await ctx.active.get();
  if (!active) return;
  const providerId = active.provider.id;
  const excludedCategories = await ctx.settings.getExcluded(providerId, 'live');
  const grouping = await ctx.liveGrouping.config(providerId);
  await rebuildEntries({ db: active.db, type: 'live', excludedCategories, grouping });
  ctx.catalogChanged();
}
