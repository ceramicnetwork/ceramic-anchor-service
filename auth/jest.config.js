/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
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
