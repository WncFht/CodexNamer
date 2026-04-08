import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const browserLikeGlobals = {
  ...globals.browser,
  ...globals.node
};

const testGlobals = {
  ...globals.node,
  ...globals.browser,
  afterAll: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  beforeEach: "readonly",
  describe: "readonly",
  expect: "readonly",
  it: "readonly",
  test: "readonly",
  vi: "readonly"
};

export default tseslint.config(
  {
    ignores: [
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "packages/*/dist/**",
      "packages/*/dist-ts/**",
      "**/*.d.ts",
      "**/*.tsbuildinfo"
    ]
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node
    }
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node
    },
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off",
      "no-undef": "off",
      "no-control-regex": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: ["packages/web/src/**/*.{ts,tsx}", "packages/tui/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: browserLikeGlobals
    }
  },
  {
    files: ["packages/web/src/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/exhaustive-deps": "error"
    }
  },
  {
    files: ["test/**/*.{ts,tsx}"],
    languageOptions: {
      globals: testGlobals
    }
  }
);
