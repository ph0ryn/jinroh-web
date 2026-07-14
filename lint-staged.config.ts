export default {
  "*.{js,mjs}": () => "pnpm run format",
  "**/!(package).json": "pnpm oxfmt",
  "package.json": () => "sort-package-json",
  "{app,lib}/**/*.{ts,tsx}": () => "pnpm run precommit",
};
