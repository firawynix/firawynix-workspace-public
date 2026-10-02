const base = require('../package.json').build;
const { signtoolOptions, ...win } = base.win;

module.exports = {
  ...base,
  extraFiles: [],
  publish: null,
  win: {
    ...win,
    target: [{ target: 'portable', arch: ['x64'] }],
    signExecutable: false,
  },
};
