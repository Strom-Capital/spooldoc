import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "demo-spool/**", "local/**", "workspace/**", "apps/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["packages/*/src/**/*.ts"],
    rules: { "no-console": "error" },
  },
);
