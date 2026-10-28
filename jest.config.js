const { execFileSync } = require("node:child_process");
const path = require("node:path");




const backendIgnorePattern = execFileSync(
  process.execPath,
  [path.join(__dirname, "scripts/plugins/discovery.mjs"), "--print-jest-ignore"],
  { encoding: "utf8" }
).trim();

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  globalSetup: "<rootDir>/tests/helpers/pluginGeneration.cjs",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  moduleNameMapper: {
    "\\.sql$": "<rootDir>/tests/helpers/sqlTextStub"
  },
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],


  testPathIgnorePatterns: [
    "/node_modules/",
    backendIgnorePattern,
    "(?:\\.tmp-|\\.backup-)[^/]*(?:/|$)",
    "/\\.plugin-tmp(?:/|$)"
  ],
  transform: {
    "^.+\.ts$": "ts-jest",
    "^.+\.js$": "ts-jest"
  },


  transformIgnorePatterns: ["/node_modules/(?!@noble/)"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/types/**/*.ts",
    "!src/index.ts"
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
};
