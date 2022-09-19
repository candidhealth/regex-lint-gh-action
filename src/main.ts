import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';
import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';

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
}

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
    return touchedFiles;
  }
}

function parseConfig(config: unknown): LintConfig[] {
  const lintConfigs: LintConfig[] = [];
  for (const entry of config as any[]) {
    lintConfigs.push({
      name: entry.name,
      pattern: entry.pattern
    });
    try {
      new RegExp(entry.pattern);
    } catch (error) {
      core.error(`Failed to parse regex pattern: ${entry.pattern}`);
    }
  }

  return lintConfigs;
}

async function runLint(
  file: string,
  lintConfigs: ReadonlyArray<LintConfig>
): Promise<Annotation[]> {
  const annotations: Annotation[] = [];
  const fileContents: string = await fs.readFile(file, 'utf8');
  const fileLines = fileContents.split('\n');
  for (const [lineNumber, line] of fileLines.entries()) {
    for (const lintConfig of lintConfigs) {
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
          const message = `Found match for ${lintConfig.name}: ${matchValue}`;
          core.info(
            `${file}: ${lineNumber},${startColumn},${endColumn}: ${message}`
          );

          annotations.push({
            title: `Regex Lint Annotation: ${lintConfig.name}`,
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

    const config = await loadConfig();
    if (config == null) {
      core.setFailed('Error in reading the input yaml file');
      return;
    }

    const touchedFiles = await getTouchedFiles();
    const lintConfigs = parseConfig(config);

    const annotationsArr = await Promise.all(
      touchedFiles.map(touchedFile => runLint(touchedFile, lintConfigs))
    );

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
