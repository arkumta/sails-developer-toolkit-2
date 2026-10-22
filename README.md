# Sails Developer Toolkit

A Visual Studio Code extension prototype for developers building Rust-based smart programs with the Sails framework on Gear Protocol and Vara Network.

> **Project status: early prototype.** The TypeScript source compiles, but the extension's commands have not yet been verified end-to-end in the VS Code Extension Development Host. Do not treat this release as production-ready.

## Current features

- **Detect a Sails project** — scans a Rust workspace and its nested `Cargo.toml` files for a `sails-rs` dependency.
- **Insert a starter service template** — inserts an example service/program into the active editor. Review and adapt the generated code to the Sails version used by your project.
- **Build project** — runs `cargo check` from the opened workspace root and reports output in a VS Code output channel.
- **Check project** — runs basic structural checks for a Cargo manifest, Rust source files, and common Sails markers.

These are initial developer helpers, not a complete compiler, linter, or security auditor.

## Requirements

- Visual Studio Code compatible with the version declared in `package.json`
- Node.js and npm
- Rust toolchain (`rustup`/`cargo`)
- A Rust project using Sails, such as one created with `cargo sails new`

Install the Sails CLI and follow the official Sails documentation for the version you are using. The template in this prototype must be checked against your project's Sails version before use.

## Development setup

1. Clone or download this repository.
2. Open the repository folder in VS Code.
3. Run `npm install` in the integrated terminal.
4. Run `npm run compile`.
5. Open **Run and Debug** and start **Run Extension**.
6. In the new Extension Development Host, open a Sails project folder and search the Command Palette for `Sails:` commands.

If the commands do not appear, check the Extension Host log and open an issue with the VS Code version and relevant error messages.

## Commands

| Command | Description |
| --- | --- |
| `Sails: Detect Project` | Detects a likely Sails workspace |
| `Sails: Insert Service Template` | Inserts the starter service/program example in the active editor |
| `Sails: Build Project` | Runs `cargo check` |
| `Sails: Check Project` | Performs basic project structure checks |

## Roadmap

- Verify extension activation and command registration across supported VS Code versions.
- Add automated tests for project detection and command behavior.
- Validate and version the starter template against current Sails releases.
- Improve diagnostics using Cargo metadata and Sails-aware parsing rather than text heuristics.
- Add guided build/test workflows and actionable compiler diagnostics.
- Publish a versioned VSIX and, after validation, submit to the Visual Studio Marketplace.
- Collect feedback from Vara/Gear developers and document measured time saved and issues found.

## Contributing

Bug reports, feature requests, test projects, and pull requests are welcome. Please include your OS, VS Code version, Rust version, Sails version, reproduction steps, and relevant logs when reporting an issue.

## Ecosystem alignment

This project aims to lower the setup and debugging burden for developers using Sails on Vara/Gear. It is an independent community tooling project and is not affiliated with or endorsed by Gear Foundation unless an explicit partnership is announced.

## License

A license has not yet been selected. Until a license is added, do not assume that this repository grants permission to redistribute or modify the code.
