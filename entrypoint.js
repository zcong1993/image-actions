#!/usr/bin/env node

const { GITHUB_TOKEN, GITHUB_EVENT_NAME, GITHUB_REF } = require("./src/constants");

const githubEvent = require("./src/github-event");
const run = require("./src/index.js");
const { runPush } = require('./src/push')

if (!GITHUB_TOKEN) {
  console.log("::error:: You must enable the GITHUB_TOKEN secret");
  process.exit(1);
}

const main = async () => {
  const event = await githubEvent();
  if (GITHUB_EVENT_NAME === 'pull_request') {
    if (event.action !== "synchronize" && event.action !== "opened") {
      console.log(
        "::error:: Check run has action",
        event.action,
        ". Wants: synchronize or opened"
      );
      process.exit(78);
    }

    await run();
    return
  }

  if (GITHUB_EVENT_NAME === 'push') {
    if (!GITHUB_REF.match(/^refs\/heads\//)) {
      console.log(`ignore none branch ref ${GITHUB_REF}`)
      return
    }
    await runPush()
    return
  }

  console.log("::error:: Invalid events");
  process.exit(78);
};

main();
