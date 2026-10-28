
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

/**
 * Find Rust files throughout a project.
 * Build output, Git metadata, and dependencies are excluded.
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
        ![
          'target',
          '.git',
          'node_modules',
          '.next',
          'vendor',
        ].includes(entry.name)
      ) {
        results.push(...findRustFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      results.push(fullPath);
    }
  }

  return results;
}

/** Find Cargo manifests throughout a workspace. */
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
        ![
          'target',
          '.git',
          'node_modules',
          '.next',
          'vendor',
        ].includes(entry.name)
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

/** Recognize common ways of declaring the Sails dependency. */
function manifestUsesSails(cargoText: string): boolean {
  const directDependency =
    /^\s*sails-rs\s*=/m.test(cargoText);

  const workspaceDependency =
    /^\s*sails-rs\s*\.\s*workspace\s*=\s*true\b/m.test(
      cargoText
    );

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

/** Return the first manifest containing a Sails dependency. */
function findSailsDependency(
  root: string
): string | undefined {
  for (const manifest of findCargoManifests(root)) {
    try {
      const contents = fs.readFileSync(manifest, 'utf8');

      if (manifestUsesSails(contents)) {
        return manifest;
      }
    } catch {
      // Skip unreadable manifests.
    }
  }

  return undefined;
}

/**
 * Basic structural checks for Sails-generated IDL.
 * This is a heuristic checker, not a replacement for the Sails compiler.
 */

function validateSailsIdl(idlText: string): string[] {
  const errors: string[] = [];
  const text = idlText.trim();

  if (!text) {
    return ['IDL file is empty.'];
  }

  if (!/^!@sails:\s*\S+/m.test(text)) {
    errors.push('Missing Sails IDL version header.');
  }

  if (!/^service\s+\w+@\S+\s*\{/m.test(text)) {
    errors.push('Could not find a service declaration with a name and ID.');
  }

  if (!/^program\s+\w+\s*\{/m.test(text)) {
    errors.push('Could not find a program declaration.');
  }

  let braceDepth = 0;

  for (const character of text) {
    if (character === '{') braceDepth++;
    if (character === '}') braceDepth--;

    if (braceDepth < 0) {
      errors.push('Unexpected closing brace found.');
      break;
    }
  }

  if (braceDepth > 0) {
    errors.push(`IDL has ${braceDepth} unclosed opening brace(s).`);
  }

  const functionSection = text.match(/\bfunctions\s*\{([\s\S]*?)\}/);
  if (functionSection) {
    const declarations = functionSection[1]
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !line.startsWith('//') &&
          !line.startsWith('*') &&
          !line.startsWith('@')
      );

    for (const declaration of declarations) {
      if (!/^[A-Za-z_]\w*\s*\(/.test(declaration)) {
        errors.push(`Unrecognized function declaration: ${declaration}`);
      }
    }
  }

  const constructorsSection = text.match(/\bconstructors\s*\{([\s\S]*?)\}/);
  if (constructorsSection) {
    const declarations = constructorsSection[1]
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !line.startsWith('//') &&
          !line.startsWith('*')
      );

    for (const declaration of declarations) {
      if (!/^[A-Za-z_]\w*\s*\(/.test(declaration)) {
        errors.push(`Unrecognized constructor declaration: ${declaration}`);
      }
    }
  }

  return errors;
}

/**
 * Extract a human-readable summary from a Sails IDL.
 * This is a lightweight parser for the generated IDL format.
 */

/**
 * Extract a human-readable summary from a Sails IDL.
 * Recognizes functions, constructors, custom types, and events.
 */
function summarizeSailsIdl(idlText: string): string[] {
  const summary: string[] = [];

  const service = idlText.match(/^service\s+(\w+)@(\S+)\s*\{/m);
  const program = idlText.match(/^program\s+(\w+)\s*\{/m);

  if (service) {
    summary.push(`- Service: ${service[1]}`);
    summary.push(`- Service ID: ${service[2]}`);
  }

  if (program) {
    summary.push(`- Program: ${program[1]}`);
  }

  const extractSection = (sectionName: string): string => {
    const marker = new RegExp(`\\b${sectionName}\\s*\\{`);
    const match = marker.exec(idlText);

    if (!match || match.index === undefined) {
      return '';
    }

    const openBrace = idlText.indexOf('{', match.index);
    let depth = 1;

    for (let i = openBrace + 1; i < idlText.length; i++) {
      if (idlText[i] === '{') depth++;
      if (idlText[i] === '}') depth--;

      if (depth === 0) {
        return idlText.slice(openBrace + 1, i);
      }
    }

    return '';
  };

  const functionsSection = extractSection('functions');
  const constructorsSection = extractSection('constructors');
  const typesSection = extractSection('types');
  const eventsSection = extractSection('events');

  const functions = [
    ...functionsSection.matchAll(/^\s*([A-Za-z_]\w*)\s*\(/gm),
  ].map((match) => match[1]);

  const constructors = [
    ...constructorsSection.matchAll(/^\s*([A-Za-z_]\w*)\s*\(/gm),
  ].map((match) => match[1]);

  const types = [
    ...typesSection.matchAll(/^\s*(?:struct|enum)\s+([A-Za-z_]\w*)\b/gm),
  ].map((match) => match[1]);

  const events = [
    ...eventsSection.matchAll(/^\s*([A-Za-z_]\w*)\s*\{/gm),
  ].map((match) => match[1]);

  summary.push(
    `- Functions (${functions.length}): ${functions.join(', ') || 'None found'}`
  );
  summary.push(
    `- Constructors (${constructors.length}): ${constructors.join(', ') || 'None found'}`
  );
  summary.push(
    `- Custom types (${types.length}): ${types.join(', ') || 'None found'}`
  );
  summary.push(
    `- Events (${events.length}): ${events.join(', ') || 'None found'}`
  );

  return summary;
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
  const buildOutput = vscode.window.createOutputChannel(
    'Sails Developer Toolkit'
  );

  const diagnosticsOutput =
    vscode.window.createOutputChannel(
      'Sails Developer Toolkit Diagnostics'
    );

  context.subscriptions.push(
    buildOutput,
    diagnosticsOutput
  );

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
          'Cargo.toml was found, but no Rust source files were found.'
        );
        return;
      }

      const sailsManifest = findSailsDependency(root);

      if (sailsManifest) {
        vscode.window.showInformationMessage(
          `Sails project detected! Found sails-rs in ${path.relative(
            root,
            sailsManifest
          )}.`
        );
      } else {
        vscode.window.showInformationMessage(
          'Rust project detected, but no sails-rs dependency was found in the Cargo manifests.'
        );
      }
    }
  );

  // Feature 2: Create a Sails starter template in a new file.
  const insertServiceTemplate = vscode.commands.registerCommand(
    'sails-developer-toolkit.insertServiceTemplate',
    async () => {
      const root = getWorkspaceRoot();

      if (!root) {
        showMissingWorkspaceMessage('creating a Sails template');
        return;
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

      // Ask the user where to save the new template.
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(root, 'sails-service-template.rs')
        ),
        saveLabel: 'Create Sails Template',
        filters: {
          'Rust source files': ['rs'],
        },
      });

      if (!uri) {
        vscode.window.showInformationMessage(
          'Template creation cancelled.'
        );
        return;
      }

      // Never overwrite an existing file.
      if (fs.existsSync(uri.fsPath)) {
        vscode.window.showWarningMessage(
          'That file already exists. Choose a different filename to protect existing code.'
        );
        return;
      }

      try {
        // Use exclusive creation to avoid overwriting existing files.
        await fs.promises.writeFile(uri.fsPath, template, {
          encoding: 'utf8',
          flag: 'wx',
        });

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        vscode.window.showInformationMessage(
          'Sails starter template created in a new file. Your existing source files were not changed.'
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        vscode.window.showErrorMessage(
          `Could not create the Sails template: ${message}`
        );
      }
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

      buildOutput.clear();
      buildOutput.show(true);
      buildOutput.appendLine(`Checking project: ${root}`);
      buildOutput.appendLine('Running: cargo check\n');

      const cargo = spawn('cargo', ['check'], {
        cwd: root,
        env: process.env,
      });

      cargo.stdout.on('data', (data: Buffer) => {
        buildOutput.append(data.toString());
      });

      cargo.stderr.on('data', (data: Buffer) => {
        buildOutput.append(data.toString());
      });

      cargo.on('error', (error: Error) => {
        buildOutput.appendLine(
          `Could not start Cargo: ${error.message}`
        );

        vscode.window.showErrorMessage(
          'Could not start Cargo. Check your Rust installation and PATH.'
        );
      });

      cargo.on('close', (code: number | null) => {
        buildOutput.appendLine(
          `\nCargo check finished with exit code ${code}.`
        );

        if (code === 0) {
          vscode.window.showInformationMessage(
            'Project check completed successfully.'
          );
        } else {
          vscode.window.showWarningMessage(
            'Project build failed. See Sails Developer Toolkit output for details.'
          );
        }
      });
    }
  );

  // Feature 4: Basic heuristic project diagnostics.
  const checkProject = vscode.commands.registerCommand(
    'sails-developer-toolkit.checkProject',
    async () => {
      const root = getWorkspaceRoot();

      if (!root) {
        showMissingWorkspaceMessage('checking the project');
        return;
      }

      const findings: string[] = [];
      const manifests = findCargoManifests(root);
      const rustFiles = findRustFiles(root);

      if (!fs.existsSync(path.join(root, 'Cargo.toml'))) {
        findings.push('ERROR: Root Cargo.toml is missing.');
      }

      if (manifests.length === 0) {
        findings.push('ERROR: No Cargo.toml files were found.');
      }

      if (rustFiles.length === 0) {
        findings.push('WARNING: No Rust source files were found.');
      }

      const sailsManifest = findSailsDependency(root);

      if (sailsManifest) {
        findings.push(
          `INFO: Sails dependency detected in ${path.relative(
            root,
            sailsManifest
          )}.`
        );
      } else {
        findings.push(
          'WARNING: No sails-rs dependency was detected in Cargo manifests.'
        );
      }

      const serviceFiles: string[] = [];
      const programFiles: string[] = [];

      for (const file of rustFiles) {
        try {
          const source = fs.readFileSync(file, 'utf8');
          const relativeFile = path.relative(root, file);

          // Match #[service], #[program], and qualified Sails macros.
          if (
            /#\s*\[\s*(?:(?:sails_rs|sails)\s*::\s*)?service\b/.test(
              source
            )
          ) {
            serviceFiles.push(relativeFile);
          }

          if (
            /#\s*\[\s*(?:(?:sails_rs|sails)\s*::\s*)?program\b/.test(
              source
            )
          ) {
            programFiles.push(relativeFile);
          }
        } catch {
          // Ignore source files that cannot be read.
        }
      }

      if (serviceFiles.length > 0) {
        findings.push(
          `INFO: Service macro found in: ${serviceFiles.join(', ')}`
        );
      } else {
        findings.push(
          'INFO: No service macro found in scanned Rust files. This may be intentional.'
        );
      }

      if (programFiles.length > 0) {
        findings.push(
          `INFO: Program macro found in: ${programFiles.join(', ')}`
        );
      } else {
        findings.push(
          'INFO: No program macro found in scanned Rust files. This may be intentional.'
        );
      }

      findings.push(
        `Scanned ${rustFiles.length} Rust source file(s).`
      );

      diagnosticsOutput.clear();
      diagnosticsOutput.appendLine(`Project: ${root}`);
      diagnosticsOutput.appendLine('Basic project diagnostics');
      diagnosticsOutput.appendLine('=========================');
      diagnosticsOutput.appendLine('');

      for (const finding of findings) {
        diagnosticsOutput.appendLine(finding);
      }

      diagnosticsOutput.appendLine('');
      diagnosticsOutput.appendLine(
        'These checks are heuristic, not a full Sails validation or security audit.'
      );
      diagnosticsOutput.appendLine(
        'Run Sails: Build Project for compiler feedback.'
      );
      diagnosticsOutput.show(true);

      vscode.window.showInformationMessage(
        `Project check finished: ${findings.length} finding(s). See Output for details.`
      );
    }
  );



  // Feature 5: Sails Verification Center with build, test, and Markdown report.
  const doctor = vscode.commands.registerCommand(
    'sails-developer-toolkit.doctor',
    async () => {
      const root = getWorkspaceRoot();

      if (!root) {
        showMissingWorkspaceMessage('running Sails Doctor');
        return;
      }

      const doctorOutput = vscode.window.createOutputChannel(
        'Sails Project Doctor'
      );
      context.subscriptions.push(doctorOutput);
      doctorOutput.clear();
      doctorOutput.show(true);

      const report: string[] = [];
      const findings: string[] = [];

      const log = (message = '') => {
        doctorOutput.appendLine(message);
        report.push(message);
      };

      const rootCargo = path.join(root, 'Cargo.toml');
      const rustFiles = findRustFiles(root);
      const sailsManifest = findSailsDependency(root);

      log('# Sails Verification Report');
      log('');
      log(`- **Project:** \`${root}\``);
      log(`- **Date:** ${new Date().toISOString()}`);
      log('');

      log('## 1. Project Setup');
      log('');

      findings.push(
        fs.existsSync(rootCargo)
          ? 'PASS: Root Cargo.toml found.'
          : 'FAIL: Root Cargo.toml is missing.'
      );

      findings.push(
        rustFiles.length > 0
          ? `PASS: Found ${rustFiles.length} Rust source file(s).`
          : 'FAIL: No Rust source files found.'
      );

      findings.push(
        sailsManifest
          ? `PASS: sails-rs detected in ${path.relative(root, sailsManifest)}.`
          : 'WARN: Could not detect sails-rs in Cargo manifests.'
      );

      let serviceFound = false;
      let programFound = false;

      for (const file of rustFiles) {
        try {
          const source = fs.readFileSync(file, 'utf8');

          if (
            /#\s*\[\s*(?:(?:sails_rs|sails)\s*::\s*)?service\b/.test(source)
          ) {
            serviceFound = true;
          }

          if (
            /#\s*\[\s*(?:(?:sails_rs|sails)\s*::\s*)?program\b/.test(source)
          ) {
            programFound = true;
          }
        } catch {
          // Ignore unreadable Rust files.
        }
      }

      findings.push(
        serviceFound
          ? 'PASS: Service macro detected.'
          : 'WARN: No service macro detected; this may be intentional.'
      );

      findings.push(
        programFound
          ? 'PASS: Program macro detected.'
          : 'WARN: No program macro detected; this may be intentional.'
      );

      for (const finding of findings) {
        log(`- ${finding}`);
      }

      const saveReport = async () => {
        const choice = await vscode.window.showInformationMessage(
          'Sails Verification Center finished. Save the Markdown report?',
          { modal: true },
          'Save Report',
          'Not Now'
        );

        if (choice !== 'Save Report') {
          return;
        }

        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(
            path.join(root, 'sails-verification-report.md')
          ),
          saveLabel: 'Save Verification Report',
          filters: { Markdown: ['md'] },
        });

        if (!uri) return;

        try {
          await fs.promises.writeFile(
            uri.fsPath,
            report.join('\n') + '\n',
            'utf8'
          );
          vscode.window.showInformationMessage(
            `Verification report saved: ${uri.fsPath}`
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `Could not save report: ${message}`
          );
        }
      };

      if (findings.some((item) => item.startsWith('FAIL:'))) {
        log('');
        log('## Final Result');
        log('');
        log('**RESULT: FAIL** — Project setup checks failed.');
        log('Resolve the failed setup checks before building.');
        await saveReport();
        return;
      }

      const runCargoCommand = (
        args: string[],
        section: string
      ): Promise<number | null> =>
        new Promise((resolve) => {
          log('');
          log(`## ${section}`);
          log('');
          log(`Running \`cargo ${args.join(' ')}\`...`);
          log('');

          let settled = false;
          const finish = (code: number | null) => {
            if (settled) return;
            settled = true;
            resolve(code);
          };

          const cargo = spawn('cargo', args, {
            cwd: root,
            env: process.env,
          });

          cargo.stdout.on('data', (data: Buffer) => {
            const output = data.toString();
            doctorOutput.append(output);
            report.push(...output.replace(/\r/g, '').split('\n').filter(Boolean));
          });

          cargo.stderr.on('data', (data: Buffer) => {
            const output = data.toString();
            doctorOutput.append(output);
            report.push(...output.replace(/\r/g, '').split('\n').filter(Boolean));
          });

          cargo.on('error', (error: Error) => {
            log('');
            log(`ERROR: Could not start Cargo: ${error.message}`);
            finish(null);
          });

          cargo.on('close', (code: number | null) => {
            log('');
            log(
              code === 0
                ? `**RESULT: PASS** — \`cargo ${args.join(' ')}\` succeeded.`
                : `**RESULT: FAIL** — \`cargo ${args.join(' ')}\` exited with code ${code}.`
            );
            finish(code);
          });
        });


    const buildCode = await runCargoCommand(['check'], '2. Build Check');

    // Step 3: Discover and validate Sails build artifacts.
    log('');
    log('## 3. Artifact Validation');
    log('');

    let artifactsPassed = true;
    const targetRoot = path.join(root, 'target');

    let packageName = path.basename(root);

    try {
      const cargoText = fs.readFileSync(
        path.join(root, 'Cargo.toml'),
        'utf8'
      );

      const packageMatch = cargoText.match(
        /^\[package\][\s\S]*?^\s*name\s*=\s*"([^"]+)"/m
      );

      if (packageMatch) {
        packageName = packageMatch[1];
      }
    } catch {
      log('- WARN: Could not read Cargo.toml to determine the package name.');
    }

    // Rust artifact filenames use underscores for hyphens in package names.
    const artifactName = packageName.replace(/-/g, '_');

    const artifactDefinitions = [
      {
        label: 'WASM binary',
        filename: `${artifactName}.wasm`,
      },
      {
        label: 'Optimized WASM binary',
        filename: `${artifactName}.opt.wasm`,
      },
      {
        label: 'IDL file',
        filename: `${artifactName}.idl`,
      },
    ];

    // Search target output folders without scanning large dependency folders.
    const findArtifact = (
      directory: string,
      filename: string
    ): string | undefined => {
      if (!fs.existsSync(directory)) {
        return undefined;
      }

      let entries: fs.Dirent[];

      try {
        entries = fs.readdirSync(directory, {
          withFileTypes: true,
        });
      } catch {
        return undefined;
      }

      // Prefer the normal Sails WASM output directory when possible.
      entries.sort((a, b) => {
        const aPreferred =
          a.name === 'wasm32-gear' ? 0 : 1;
        const bPreferred =
          b.name === 'wasm32-gear' ? 0 : 1;

        return aPreferred - bPreferred;
      });

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isFile() && entry.name === filename) {
          return fullPath;
        }
      }

      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          [
            'deps',
            'incremental',
            '.fingerprint',
            'build',
          ].includes(entry.name)
        ) {
          continue;
        }

        const found = findArtifact(
          path.join(directory, entry.name),
          filename
        );

        if (found) {
          return found;
        }
      }

      return undefined;
    };


  for (const artifact of artifactDefinitions) {
    const artifactPath = findArtifact(
      targetRoot,
      artifact.filename
    );

    if (!artifactPath) {
      artifactsPassed = false;

      log(
        `- FAIL: ${artifact.label} not found. Expected filename: ${artifact.filename}.`
      );

      continue;
    }

    try {
      const stats = fs.statSync(artifactPath);

      if (!stats.isFile() || stats.size === 0) {
        artifactsPassed = false;
        log(`- FAIL: ${artifact.label} is empty or is not a file.`);
        continue;
      }

      const sizeKB = (stats.size / 1024).toFixed(1);
      const modified = stats.mtime.toISOString();
      const relativePath = path.relative(root, artifactPath);

      if (artifact.filename.endsWith('.wasm')) {
        const wasmBytes = fs.readFileSync(artifactPath);
        const validWasm = WebAssembly.validate(
          new Uint8Array(wasmBytes)
        );

        if (!validWasm) {
          artifactsPassed = false;

          log(
            `- FAIL: ${artifact.label} exists, but Node.js WebAssembly validation rejected it.`
          );
          log(`  Path: \`${relativePath}\``);
          continue;
        }

        log(
          `- PASS: ${artifact.label} exists and passes WebAssembly validation (${sizeKB} KB; modified ${modified}).`
        );

} else {
  if (artifact.filename.endsWith('.idl')) {
    const idlText = fs.readFileSync(artifactPath, 'utf8');
    const idlErrors = validateSailsIdl(idlText);

    if (idlErrors.length > 0) {
      artifactsPassed = false;

      log('- FAIL: IDL validation found problems.');
      for (const error of idlErrors) {
        log(`  - ${error}`);
      }
    } else {
      log(
        `- PASS: IDL structure validation succeeded (${sizeKB} KB; modified ${modified}).`
      );
      log('  IDL Summary:');

for (const item of summarizeSailsIdl(idlText)) {
  log(`  ${item}`);
}
    }
  } else {
    log(
      `- PASS: ${artifact.label} exists and is non-empty (${sizeKB} KB; modified ${modified}).`
    );
  }
}


      log(`  Path: \`${relativePath}\``);
    } catch (error) {
      artifactsPassed = false;

      const message =
        error instanceof Error ? error.message : String(error);

      log(
        `- FAIL: Could not validate ${artifact.label}: ${message}`
      );
    }
  }


    log('');

    log(
      artifactsPassed
        ? '**ARTIFACT RESULT: PASS** — All expected artifacts were found and are nonempty.'
        : '**ARTIFACT RESULT: FAIL** — One or more expected artifacts are missing or invalid.'
    );

      let testCode: number | null = null;

      if (buildCode === 0) {
        testCode = await runCargoCommand(['test'], '4. Test Check');
      } else {
        log('');
        log('## 4. Test Check');
        log('');
        log('SKIPPED: Tests were not run because `cargo check` failed.');
      }

      log('');
      log('## Final Result');
      log('');

      if (buildCode === 0 && testCode === 0 && artifactsPassed) {
        log('**OVERALL: PASS** — Build and tests succeeded.');
        vscode.window.showInformationMessage(
          'Sails Verification Center: build and tests succeeded.'
        );
      } else {
        log('**OVERALL: FAIL or INCOMPLETE** — Review the checks above.');
        vscode.window.showWarningMessage(
          'Sails Verification Center found a failed or incomplete check. See its Output panel.'
        );
      }

      log('');
      log('## Limitations');
      log('');
      log(
        'Setup checks use heuristics. Passing cargo check and cargo test does not prove that contract behavior is correct in every scenario or that the contract is secure.'
      );

      await saveReport();
    }
  );



  context.subscriptions.push(
    detectSailsProject,
    insertServiceTemplate,
    buildProject,
    checkProject,
    doctor
  );
}

export function deactivate() {}
