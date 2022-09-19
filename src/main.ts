import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';
import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import minimatch from 'minimatch';

const { GITHUB_TOKEN } = process.env;
interface Annotation {
  title: string;
  file: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  message: string;
}

interface LintConfig {
  name: string;
  pattern: string;
  documentation?: string;
}

interface Configuration {
  includePaths?: string[];
  excludePaths?: string[];
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
  for (const entry of configuration['lint-patterns'] as any[]) {
    try {
      new RegExp(entry.pattern);

      lintConfigs.push({
        name: entry.name,
        pattern: entry.pattern,
        documentation: entry.documentation
      });
    } catch (error) {
      core.error(`Failed to parse regex pattern: ${entry.pattern}`);
    }
  }

  core.info('Parsed the following configuration:');
  core.info(JSON.stringify(lintConfigs));
  core.info('');
  return {
    includePaths: configuration['include-paths'],
    excludePaths: configuration['exclude-paths'],
    lintConfigs: lintConfigs
  };
}

async function runLint(
  file: string,
  configuration: Configuration
): Promise<Annotation[]> {
  if (
    configuration.includePaths != null &&
    !configuration.includePaths.some(pathGlob => minimatch(file, pathGlob))
  ) {
    core.info(`File did not match configured include path: ${file}`);
    return [];
  }

  if (
    configuration.excludePaths != null &&
    configuration.excludePaths.some(pathGlob => minimatch(file, pathGlob))
  ) {
    core.info(`File matched configured exclude path: ${file}`);
    return [];
  }

  core.info(`Running lint on ${file}...`);
  const annotations: Annotation[] = [];
  const fileContents: string = await fs.readFile(file, 'utf8');
  const fileLines = fileContents.split('\n');
  for (const [lineNumber, line] of fileLines.entries()) {
    for (const lintConfig of configuration.lintConfigs) {
      const matchArrayIterator = line.matchAll(
        new RegExp(lintConfig.pattern, 'g')
      );
      for (const matchArray of matchArrayIterator) {
        if (
          matchArray != null &&
          matchArray.length > 0 &&
          matchArray.index != null
        ) {
          const matchValue = matchArray[0];
          const startColumn = matchArray.index;
          const endColumn = matchArray.index + matchValue.length;
          const message = `Found match for ${lintConfig.name}: ${matchValue}${
            lintConfig.documentation != null
              ? `\n${lintConfig.documentation}`
              : ''
          }`;
          core.info(
            `${file}: ${lineNumber},${startColumn},${endColumn}: ${message}`
          );

          annotations.push({
            title: `Regex Lint: ${lintConfig.name}`,
            file: file,
            startLine: lineNumber + 1,
            endLine: lineNumber + 1,
            startColumn: startColumn,
            endColumn: endColumn,
            message: message
          });
        }
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
    annotationsArr.forEach(annotations => {
      annotations.forEach(annotation => {
        core.warning(annotation.message, { ...annotation });
      });
    });
  } catch (error) {
    if (error instanceof Error) {
      core.warning('There was an error in run');
      core.setFailed(error.message);
    }
  }
}

run();
