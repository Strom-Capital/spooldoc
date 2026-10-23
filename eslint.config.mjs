import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "demo-spool/**", "local/**", "workspace/**", "apps/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TaggedTemplateExpression > AwaitExpression.tag",
          message:
            "Await the tag in its own statement first. Next's compiler (SWC) drops the parentheses in (await f())`...`, so the template tags the promise and throws.",
        },
      ],
    },
  },
  {
    files: ["packages/*/src/**/*.ts"],
    rules: { "no-console": "error" },
  },
);
