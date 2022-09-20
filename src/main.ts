import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';
import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import minimatch from 'minimatch';

const { GITHUB_TOKEN } = process.env;

type Severity = 'warning' | 'error';
interface Annotation {
  title: string;
  file: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  message: string;
  severity: Severity;
}

interface LintConfig {
  name: string;
  pattern: string;
  documentation?: string;
  severity?: Severity;
  overriddenIncludePaths?: string[];
  overriddenExcludePaths?: string[];
}

interface Configuration {
  globalIncludePaths?: string[];
  globalExcludePaths?: string[];
  lintConfigs: LintConfig[];
}

type GenericObject = { [key: string]: any };

async function loadConfig() {
  const file = core.getInput('file');
  const content = await fs.readFile(file, 'utf8');

  return yaml.load(content);
}

async function getTouchedFiles(): Promise<string[]> {
  const prNumber = github.context.payload.pull_request?.number;
  if (prNumber == null) {
    core.error('Failed to determine PR number by Github context.');
    return [];
  } else {
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    const prFiles = await octokit.pulls.listFiles({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: prNumber,
      per_page: 100
    });

    const touchedFiles = prFiles.data
      .filter(d => d.status !== 'removed')
      .map(d => d.filename);

    core.info('Found the following files in the PR:');
    touchedFiles.forEach(core.info);
    core.info('');

    return touchedFiles;
  }
}

function parseConfig(config: unknown): Configuration {
  const configuration = config as GenericObject;
  const lintConfigs: LintConfig[] = [];
  for (const entry of configuration['lint-patterns'] as GenericObject[]) {
    try {
      new RegExp(entry.pattern);

      lintConfigs.push({
        name: entry.name,
        pattern: JSON.parse(`"${entry.pattern}"`),
        documentation: entry.documentation,
        severity: entry.severity,
        overriddenIncludePaths: entry['overridden-include-paths'],
        overriddenExcludePaths: entry['overridden-exclude-paths']
      });
    } catch (error) {
      core.error(`Failed to parse regex pattern: ${entry.pattern}`);
    }
  }

  core.info('Parsed the following configuration:');
  core.info(JSON.stringify(lintConfigs));
  core.info('');
  return {
    globalIncludePaths: configuration['global-include-paths'],
    globalExcludePaths: configuration['global-exclude-paths'],
    lintConfigs: lintConfigs
  };
}

function filePassesPathsPattern(
  file: string,
  paths: string[] | undefined,
  includeOrExclude: 'include' | 'exclude'
): boolean {
  if (paths == null) {
    return true;
  }

  const pathsCoverFile = paths.some(pathGlob => minimatch(file, pathGlob));

  return includeOrExclude === 'include' ? pathsCoverFile : !pathsCoverFile;
}

// Stolen from Mozilla docs
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function determineLineNumber(fileContents: string, index: number): number {
  return fileContents.substring(0, index).split(/\r\n|\r|\n/).length;
}

function determineColNumber(fileContents: string, index: number): number {
  const splitLines = fileContents.substring(0, index).split(/\r\n|\r|\n/);
  if (splitLines.length === 1) {
    return index;
  }

  const charactersBeforeLine = splitLines
    .filter((_line, idx) => idx < splitLines.length - 1)
    .map(line => line.length)
    .reduce((first, second) => first + second);
  return index - (charactersBeforeLine + splitLines.length - 1);
}

async function runLint(
  file: string,
  configuration: Configuration
): Promise<Annotation[]> {
  const passesGlobalPaths =
    filePassesPathsPattern(file, configuration.globalIncludePaths, 'include') &&
    filePassesPathsPattern(file, configuration.globalExcludePaths, 'exclude');

  if (!passesGlobalPaths) {
    core.info(
      `File did not match globally configured include-exclude paths: ${file}`
    );
    core.info(
      'Lint configurations will be checked for overriden include-exclude paths.'
    );
  }

  core.info(`Running lint on ${file}...`);
  const annotations: Annotation[] = [];
  const fileContents: string = await fs.readFile(file, 'utf8');
  for (const lintConfig of configuration.lintConfigs) {
    if (
      !filePassesPathsPattern(
        file,
        lintConfig.overriddenIncludePaths,
        'include'
      ) ||
      !filePassesPathsPattern(
        file,
        lintConfig.overriddenExcludePaths,
        'exclude'
      )
    ) {
      continue;
    }

    if (
      lintConfig.overriddenIncludePaths == null &&
      lintConfig.overriddenExcludePaths == null &&
      !passesGlobalPaths
    ) {
      continue;
    }

    const matchArrayIterator = fileContents.matchAll(
      new RegExp(escapeRegExp(lintConfig.pattern), 'gm') // multi-line mode enabled
    );
    for (const matchArray of matchArrayIterator) {
      if (
        matchArray != null &&
        matchArray.length > 0 &&
        matchArray.index != null
      ) {
        const matchValue = matchArray[0];
        const endIndex = matchArray.index + matchValue.length;

        const startLine = determineLineNumber(fileContents, matchArray.index);
        const endLine = determineLineNumber(fileContents, endIndex);
        const startColumn = determineColNumber(fileContents, matchArray.index);
        const endColumn = determineColNumber(fileContents, endIndex);
        const messagePrefix = `Found the following match for ${lintConfig.name}:`;
        const message = [
          messagePrefix,
          matchValue,
          lintConfig.documentation
        ].join('\n');
        core.info(
          `${file}: ${startLine},${startColumn},${endColumn}: ${message}`
        );

        annotations.push({
          title: `Regex Lint: ${lintConfig.name}`,
          file: file,
          startLine: startLine,
          endLine: endLine,
          startColumn: startColumn,
          endColumn: endColumn,
          message: message,
          severity: lintConfig.severity ?? 'error'
        });
      }
    }
  }

  return annotations;
}

async function run(): Promise<void> {
  try {
    if (github.context.eventName !== 'pull_request') {
      core.warning(
        'Only pull request events are supported by this action right now.'
      );
      return;
    }

    const loadedConfig = await loadConfig();
    if (loadedConfig == null) {
      core.setFailed('Error in reading the input yaml file');
      return;
    }

    const touchedFiles = await getTouchedFiles();
    const configuration = parseConfig(loadedConfig);

    const annotationsArr = await Promise.all(
      touchedFiles.map(touchedFile => runLint(touchedFile, configuration))
    );

    core.info('');
    const annotations = annotationsArr.flatMap(a => a);
    annotations.forEach(annotation => {
      if (annotation.severity === 'warning') {
        core.warning(annotation.message, { ...annotation });
      } else {
        core.error(annotation.message, { ...annotation });
      }
    });

    if (annotations.some(annotation => annotation.severity === 'error')) {
      core.setFailed('A lint failed with error-level severity.');
    }
  } catch (error) {
    if (error instanceof Error) {
      core.warning('There was an error in run');
      core.setFailed(error.message);
    }
  }
}

run();
