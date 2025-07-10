module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // testMatch: ['**/*.Test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
};