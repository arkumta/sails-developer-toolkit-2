# Sails Developer Toolkit

A Visual Studio Code extension designed to simplify project checks, build validation, and troubleshooting for Sails smart contracts on Vara.

**Status:** Prototype — end-to-end verification in progress.

## Features

- **Detect Project:** Detects Sails-related dependencies in a Cargo project.
- **Check Project:** Inspects Rust files and identifies Sails-related dependencies and code patterns.
- **Build Project:** Runs `cargo check` for the current workspace.
- **Sails Doctor:** Combines project checks, Cargo validation, tests, artifact checks, and heuristic IDL checks.
- **Insert Service Template:** Provides a starter template for Sails development. Safe file creation and end-to-end behavior still require verification.

## Current Status

The extension has compiled successfully, and several commands have previously been tested against a sample Sails project.

The complete extension workflow has not yet been verified. Extension activation and command discovery, template generation, automated test coverage, and clean-environment installation remain to be validated.

This repository should be considered a development-stage prototype until those checks are complete.

## Requirements

- Visual Studio Code
- Node.js and npm for development
- Rust and Cargo
- A Sails project for testing project-specific commands

## Development Setup

Clone the repository and install dependencies:

```bash
npm install
```

Compile the extension:

```bash
npm run compile
```

Run lint checks:

```bash
npm run lint
```

To launch the extension in a development host, open the project in VS Code and press `F5`.

## Commands

Open the VS Code Command Palette with `Command + Shift + P` on macOS and search for the Sails Developer Toolkit commands.

Available commands are intended to cover project detection, project checks, build execution, Sails Doctor, and template generation. Their complete behavior must be verified before a stable release is announced.

## License

An open-source license has not yet been finalized. A license will be added before the initial public release.

## Contributing and Feedback

Issues and suggestions are welcome. Feedback from Vara and Sails developers will help prioritize improvements and determine which workflows provide value beyond existing tools.

## Project Links

- **GitHub:** https://github.com/arkumta/sails-developer-toolkit-2
- **Website:** https://sails-developer-toolkit-site.vercel.app/