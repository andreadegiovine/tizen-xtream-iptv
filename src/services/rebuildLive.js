/** Rebuilds the Live TV entries and groups of the active provider from the stored channels (settings or links changed), in the catalog worker. */
export async function rebuildLive(ctx) {
  await ctx.rebuildCatalog(['live']);
}
