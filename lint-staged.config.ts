export default {
  "*.{js,mjs}": ["pnpm run format"],
  "*.{json,jsonc}": ["pnpm oxfmt"],
  "package.json": ["sort-package-json"],
  "{app,lib}/**/*.{ts,tsx}": ["pnpm run precommit", () => "pnpm test"],
};
