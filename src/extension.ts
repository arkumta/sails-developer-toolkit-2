
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Find Rust files throughout a project, including app/, client/, and tests/.
 * Build output and Git metadata are excluded.
 */
function findRustFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const results: string[] = [];

  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true,
  })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        !['target', '.git', 'node_modules'].includes(entry.name)
      ) {
        results.push(...findRustFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Find Cargo.toml files throughout a workspace.
 */
function findCargoManifests(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const results: string[] = [];

  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true,
  })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        !['target', '.git', 'node_modules'].includes(entry.name)
      ) {
        results.push(...findCargoManifests(fullPath));
      }
    } else if (
      entry.isFile() &&
      entry.name === 'Cargo.toml'
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Recognize the Sails framework dependency.
 *
 * Supports:
 *   sails-rs = "2.0.0"
 *   sails-rs = { version = "2.0.0" }
 *   sails = { package = "sails-rs", version = "2.0.0" }
 *   sails-rs = { workspace = true }
 */

function manifestUsesSails(cargoText: string): boolean {
  // Direct dependency: sails-rs = "2.0.0"
  const directDependency =
    /^\s*sails-rs\s*=/m.test(cargoText);

  // Workspace inheritance: sails-rs.workspace = true
  const workspaceDependency =
    /^\s*sails-rs\s*\.\s*workspace\s*=\s*true\b/m.test(cargoText);

  // Renamed dependency: sails = { package = "sails-rs", ... }
  const renamedDependency =
    /^\s*[\w-]+\s*=\s*\{[^}\n]*\bpackage\s*=\s*["']sails-rs["']/m.test(
      cargoText
    );

  return (
    directDependency ||
    workspaceDependency ||
    renamedDependency
  );
}


/**
 * Check all Cargo manifests, including nested workspace crates.
 */
function findSailsDependency(root: string): string | undefined {
  const manifests = findCargoManifests(root);

  for (const manifest of manifests) {
    try {
      const contents = fs.readFileSync(manifest, 'utf8');

      if (manifestUsesSails(contents)) {
        return manifest;
      }
    } catch {
      // Skip a manifest that cannot be read.
    }
  }

  return undefined;
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function showMissingWorkspaceMessage(action: string): void {
  vscode.window.showWarningMessage(
    `Please open a project folder before ${action}.`
  );
}

export function activate(context: vscode.ExtensionContext) {
  // Feature 1: Detect a likely Sails project.
  const detectSailsProject = vscode.commands.registerCommand(
    'sails-developer-toolkit.detectProject',
    async () => {
      const root = getWorkspaceRoot();

      if (!root) {
        showMissingWorkspaceMessage('detecting a project');
        return;
      }

      const rootCargo = path.join(root, 'Cargo.toml');

      if (!fs.existsSync(rootCargo)) {
        vscode.window.showWarningMessage(
          'No root Cargo.toml found. Open a Rust project or Cargo workspace.'
        );
        return;
      }

      const rustFiles = findRustFiles(root);

      if (rustFiles.length === 0) {
        vscode.window.showWarningMessage(
          'Cargo.toml was found, but no Rust source files were found in the project.'
        );
        return;
      }

      const sailsManifest = findSailsDependency(root);

      if (sailsManifest) {
        const relativeManifest = path.relative(root, sailsManifest);

        vscode.window.showInformationMessage(
          `Sails project detected! Found sails-rs in ${relativeManifest}.`
        );
      } else {
        vscode.window.showInformationMessage(
          'Rust project detected, but no sails-rs dependency was found in the Cargo manifests.'
        );
      }
    }
  );

  // Feature 2: Insert a Sails starter template.
  const insertServiceTemplate = vscode.commands.registerCommand(
    'sails-developer-toolkit.insertServiceTemplate',
    async () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showWarningMessage(
          'Open a Rust file before inserting the Sails template.'
        );
        return;
      }

      if (editor.document.languageId !== 'rust') {
        const choice = await vscode.window.showWarningMessage(
          'The active file is not recognized as Rust. Insert the template anyway?',
          'Insert Template'
        );

        if (choice !== 'Insert Template') {
          return;
        }
      }

      const template = `#![no_std]

use sails_rs::prelude::*;

pub struct MyPing;

impl MyPing {
    pub const fn new() -> Self {
        Self
    }
}

#[service]
impl MyPing {
    #[export]
    pub async fn ping(&mut self) -> bool {
        true
    }
}

#[derive(Default)]
pub struct MyProgram;

#[program]
impl MyProgram {
    #[export(route = "ping")]
    pub fn ping_svc(&self) -> MyPing {
        MyPing::new()
    }
}
`;

      await editor.insertSnippet(new vscode.SnippetString(template));

      vscode.window.showInformationMessage(
        'Sails starter template inserted. Run Sails: Build Project to check compatibility with your installed Sails version.'
      );
    }
  );

  // Feature 3: Run cargo check.
  const buildProject = vscode.commands.registerCommand(
    'sails-developer-toolkit.buildProject',
    async () => {
      const root = getWorkspaceRoot();

      if (!root) {
        showMissingWorkspaceMessage('building');
        return;
      }

      if (!fs.existsSync(path.join(root, 'Cargo.toml'))) {
        vscode.window.showErrorMessage(
          'Cannot build: Cargo.toml was not found in the open folder.'
        );
        return;
      }

      const output = vscode.window.createOutputChannel(
        'Sails Developer Toolkit'
      );

      context.subscriptions.push(output);
      output.clear();
      output.show(true);
      output.appendLine(`Checking project: ${root}`);
      output.appendLine('Running: cargo check\n');

      let finished = false;

      const cargo = spawn('cargo', ['check'], {
        cwd: root,
        env: process.env,
      });

      cargo.stdout.on('data', (data: Buffer) => {
        output.append(data.toString());
      });

      cargo.stderr.on('data', (data: Buffer) => {
        output.append(data.toString());
      });

      cargo.on('error', (error: Error) => {
        finished = true;

        output.appendLine(
          `Could not start Cargo: ${error.message}`
        );

        vscode.window.showErrorMessage(
          'Could not start Cargo. Check your Rust installation and PATH.'
        );
      });

      cargo.on('close', (code: number | null) => {
        if (finished) {
          return;
        }

        output.appendLine(
          `\nCargo check finished with exit code ${code}.`
        );

        if (code === 0) {
          vscode.window.showInformationMessage(
            'Project check completed successfully.'
          );
        } else {
          vscode.window.showWarningMessage(
            'Project check failed. See the Sails Developer Toolkit output for details.'
          );
        }
      });
    }
  );

  // Feature 4: Basic project diagnostics.
  const checkProject = vscode.commands.registerCommand(
    'sails-developer-toolkit.checkProject',
    async () => {
      const root = getWorkspaceRoot();

      if (!root) {
        showMissingWorkspaceMessage('checking the project');
        return;
      }

      const rootCargo = path.join(root, 'Cargo.toml');
      const findings: string[] = [];
      const manifests = findCargoManifests(root);
      const rustFiles = findRustFiles(root);

      if (!fs.existsSync(rootCargo)) {
        findings.push(
          'ERROR: Root Cargo.toml is missing.'
        );
      } else {
        const rootText = fs.readFileSync(rootCargo, 'utf8');

        if (
          !/^\s*\[package\]/m.test(rootText) &&
          !/^\s*\[workspace\]/m.test(rootText)
        ) {
          findings.push(
            'ERROR: Root Cargo.toml needs a [package] or [workspace] section.'
          );
        }
      }

      if (manifests.length === 0) {
        findings.push(
          'ERROR: No Cargo.toml files were found.'
        );
      }

      if (rustFiles.length === 0) {
        findings.push(
          'WARNING: No Rust source files were found in the project.'
        );
      }

      const sailsManifest = findSailsDependency(root);

      if (sailsManifest) {
        findings.push(
          `INFO: Sails dependency detected in ${path.relative(root, sailsManifest)}.`
        );
      } else if (manifests.length > 0) {
        findings.push(
          'WARNING: No sails-rs dependency was detected in the Cargo manifests. This may not be a Sails project.'
        );
      }

      if (rustFiles.length > 0) {
        let source = '';

        for (const file of rustFiles) {
          try {
            source +=
              '\n' + fs.readFileSync(file, 'utf8');
          } catch {
            // Ignore files that cannot be read.
          }
        }

        if (!source.includes('#[service')) {
          findings.push(
            'INFO: No #[service] macro found in Rust source files. This may be intentional.'
          );
        }

        if (!source.includes('#[program')) {
          findings.push(
            'INFO: No #[program] macro found in Rust source files. This may be intentional.'
          );
        }
      }

      if (findings.length === 0) {
        findings.push(
          'No issues found by the basic project checks.'
        );
      }

      const output = vscode.window.createOutputChannel(
        'Sails Developer Toolkit Diagnostics'
      );

      context.subscriptions.push(output);
      output.clear();
      output.appendLine(`Project: ${root}`);
      output.appendLine('Basic project diagnostics');
      output.appendLine('=========================');
      output.appendLine('');

      for (const finding of findings) {
        output.appendLine(finding);
      }

      output.appendLine('');
      output.appendLine(
        'These checks are heuristic, not a full Sails validation or security audit.'
      );
      output.appendLine(
        'Run Sails: Build Project for compiler feedback.'
      );

      output.show(true);

      vscode.window.showInformationMessage(
        `Project check finished: ${findings.length} finding(s). See Output for details.`
      );
    }
  );

  context.subscriptions.push(
    detectSailsProject,
    insertServiceTemplate,
    buildProject,
    checkProject
  );
}

export function deactivate() {}
