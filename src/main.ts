

import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';

const { GITHUB_TOKEN } = process.env;

interface Annotation {
  path: string;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  annotation_level: "failure";
  message: string;
}

async function createCheck(title: string, annotations: Annotation[]) {
  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const res = await octokit.checks.listForRef({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    check_name: github.context.job,
    ref: github.context.ref
  });
  core.info("github context")
  core.info(JSON.stringify(github.context))
  core.info("res");
  core.info(JSON.stringify(res));

  if (res.data.check_runs.length === 0) {
    core.info("creating new check");
    const create_resp = await octokit.checks.create({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      head_sha: github.context.payload.pull_request?.head.sha,
      name: github.context.job,
      output: {
        title,
        summary: `${annotations.length} errors(s) found`,
        text: "Please fix this",
        annotations
      },
      status: "completed",
      conclusion: "failure"
    });
    core.info(JSON.stringify(create_resp));
  } else {
    core.info("updating existing check");
    const update_resp = await octokit.checks.update({
      check_run_id: res.data.check_runs[0].id,
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      head_sha: github.context.sha,
      name: github.context.job,
      output: {
        title,
        summary: `${annotations.length} errors(s) found`,
        text: "Please fix this",
        annotations
      },
      status: "completed",
      conclusion: "failure"
    })
    core.info(JSON.stringify(update_resp))
  }
}

// async function statusFail() {
//   const octokit = new Octokit({ auth: GITHUB_TOKEN });
//   await octokit.sta
// }


async function run(): Promise<void> {
  core.info("Running action...");
  const annotations = [{ path: "README.md", start_line: 1, end_line: 1, start_column: 1, end_column: 2, annotation_level: "failure", message: "Test check failure" }]
  try {
    await createCheck("test-check-name", annotations as Annotation[])
    core.setFailed("Check the annotations")
  } catch (error) {
    if (error instanceof Error) {
      core.warning("There was an error in run");
      core.setOutput("test-check-name", {
        summary: `${annotations.length} errors(s) found`,
        text: "Please fix this",
        annotations
      })
      core.setFailed(error.message)
    }
  }
}

run()
