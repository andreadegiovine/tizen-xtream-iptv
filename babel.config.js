module.exports = (api) => {
  const isTest = api.env('test');
  return {
    presets: [
      [
        '@babel/preset-env',
        isTest
          ? { targets: { node: 'current' } }
          : { targets: { chrome: '76' }, bugfixes: true, modules: false },
      ],
    ],
  };
};
