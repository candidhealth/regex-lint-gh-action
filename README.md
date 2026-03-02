## Regex Lint Github Action (regex-lint-gh-action)

### Description

An easy-to-configure GitHub action for static linting of your repo.

Given a list of lint configurations and include/exclude file path globs, the action will create check run annotations on any failing patterns (warning or error configured).

This action currently only supports the `pull_request` event.

### Inputs

#### `file` (required, default = `.github/regex-lint.yml`)

A file path to the YAML configuration file

### Outputs

This action produces no outputs.

### Configuration Example

See `.github/regex-lint.yml` for an example configuration.

#### `lint-patterns` (required)

- `name` (required): A human-friendly name for this lint configuration
- `pattern` (required): A Javascript regular expression pattern
- `documentation` (optional): An additional description to put on the annotation
- `severity` (optional, default = `error`): One of (`warning`, `error`) -- if set to `error`, a failing lint will cause the action's check to fail
- `overridden-include-paths` (optional, default = no overrides): Override the `global-include-paths` for this specific lint pattern
- `overridden-exclude-paths` (optional, default = no overrides): Override the `global-exclude-paths` for this specific lint pattern

NOTE: A file that matches an include path and an exclude path will be excluded. This also applies to overridden paths.

#### `global-include-paths` (optional, default = include all files)

A list of file path globs. The list of linted pull request files (minus those removed in the PR) will be checked to be included in at least one of the specified globs.

NOTE: A file that matches an include path and an exclude path will be excluded.

#### `global-exclude-paths` (optional, default = exclude no files)

A list of file path globs. The list of linted pull request files (minus those removed in the PR) will be checked to be not excluded in all of the specified globs.

### Sample GitHub Actions workflow

```yaml
name: Regex lint
on:
  pull_request:

jobs:
  regexlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: candidhealth/regex-lint-gh-action@v1.1.2  # or latest version
        with:
          file: .github/regex-lint.yml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}  # required to list files in PR
```

### For Demonstration Purposes

Hello!

This should cause an error as it contains the word hello which violates one of the test rules. See the last PR as an example of how the annotations appear.
