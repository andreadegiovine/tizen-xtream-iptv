/* Jest: an imported .svg is its text, as webpack's `asset/source` gives it (logo.svg in the top bar). */
module.exports = {
  process(source) {
    return { code: `module.exports = ${JSON.stringify(source)};` };
  },
};
