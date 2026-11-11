# Atomic components

The smallest reusable pieces of the interface. Each one builds its element (same markup everywhere it is used) and owns its
own behaviour; its styles are in `src/styles/atoms/_<name>.scss`. Pages and larger components (cards, dialogs, the guide)
are made of these.

| Atom | Element | Used by |
|---|---|---|
| `button.js` | `button.btn` (text or icon; primary, danger, icon only) | dialogs, forms, providers, settings tables, diagnostics |
| `iconButton.js` | `.icon-btn` (round-cornered icon box, `active` state) | title / collection / network pages, guide row actions, browse head |
| `playerButton.js` | `button.player-btn` (with an optional tip) | player controls |
| `chip.js` | `span.chip`, `span.detail-label` | title / collection pages |
| `toggle.js` | `span.toggle` switch | settings rows |
| `textInput.js` | `input` with the TV keyboard attributes | fields, dialogs, search bar, diagnostics |
| `field.js` | `label.field` (label + input + clear "x") | provider form, settings, diagnostics |
| `selectField.js` | `.select-field` (label + value + chevron) | title page, settings |
| `choice.js` | `.choice` of a choice list | dialogs |
| `listRow.js` | `.row` of a `.list` (label, value) | settings, search history, categories |
| `sidebarItem.js` | `.browse-cat` (icon, name, count) | Movies / Series / Live sidebar, collections |
| `topbarItem.js` | `.topbar-item` | top bar |
| `tableRow.js` | `.sync-row` (name, status, buttons) | settings tables |
| `panel.js` | `.sync-panel` with its head | settings tables |
| `heading.js` | `h1`…`h3` with a class | every page |
| `hint.js` | `p.muted` (status and empty texts) | every page |
| `placeholder.js` | `.card-placeholder` (icon in an empty picture) | cards, title / collection / network pages |
| `skeleton.js` | `.skeleton-line` / `.skeleton-block` | loading placeholders |
| `metaParts.js` | `.meta-sep`, `.meta-rating` | title page meta line |
