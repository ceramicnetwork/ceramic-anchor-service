/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // preset: 'ts-jest',
  // testEnvironment: 'node',
  // moduleNameMapper: {
  //   // Force module uuid to resolve with the CJS entry point, because Jest does not support package.json.exports. See https://github.com/uuidjs/uuid/issues/451
    // "uuid": require.resolve('uuid'),
  // },
  "resolver": "jest-resolver-enhanced",
  "testMatch": ["**/?(*.)+(spec|test).[jt]s?(x)"],
  "extensionsToTreatAsEsm": [".ts"],
  "moduleNameMapper": {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "uuid": require.resolve('uuid'),
  },
  "transform": {
    "^.+\\.ts?$": "babel-jest"
  }
}
