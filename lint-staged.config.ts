export default {
  "*.{js,mjs}": ["pnpm run format"],
  "*.{json,jsonc}": (files: string[]) => {
    const formatFiles = files.filter((file) => !file.endsWith("package.json"));

    return formatFiles.length === 0 ? [] : [`pnpm oxfmt ${formatFiles.join(" ")}`];
  },
  "package.json": ["sort-package-json"],
  "{app,lib}/**/*.{ts,tsx}": ["pnpm run precommit", () => "pnpm run test:unit"],
};
