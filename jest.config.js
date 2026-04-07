/** @type {import('jest').Config} */
module.exports = {
  testMatch: ["**/__tests__/**/*.(test|spec).(ts|tsx|js)"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  transformIgnorePatterns: ["node_modules/"],
  setupFiles: ["<rootDir>/__tests__/setup.ts"],
  collectCoverageFrom: [
    "utils/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "!**/*.d.ts",
    "!**/node_modules/**",
  ],
};
