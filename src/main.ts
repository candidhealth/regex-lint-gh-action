import * as core from '@actions/core';
import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
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

function parseConfig(config: unknown): LintConfig[] {
  const lintConfigs: LintConfig[] = [];
  for (const entry of config as any[]) {
    lintConfigs.push({
      name: entry.get("name"),
      pattern: entry.get("pattern")
    });
  }

  return lintConfigs;
}

async function run(): Promise<void> {
  try {
    const config = await loadConfig();
    if (config == null) {
      core.setFailed('Error in reading the input yaml file');
      return;
    }

    const lintConfigs = parseConfig(config);
    core.info(JSON.stringify(lintConfigs));
  } catch (error) {
    if (error instanceof Error) {
      core.warning("There was an error in run");
      core.setFailed(error.message);
    }
  }
}

run()
