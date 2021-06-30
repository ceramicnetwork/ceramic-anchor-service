// eslint-disable-next-line no-undef
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  resolver: 'jest-resolver-enhanced',
  testMatch: ["**/__tests__/**/*test.ts?(x)", "**/?(*.)+(test).ts?(x)"]
};
