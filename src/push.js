const fs = require("fs").promises;
const generateMarkdownReport = require("./github-markdown");
const processImages = require("./image-processing");
const github = require("./github-api");
const githubEvent = require("./github-event");

const { GITHUB_REF } = require('./constants')

const logPrefix = `[PUSH]`

const convertToTreeBlobs = async ({ owner, repo, images }) => {
  console.log("\t * ", "Converting images to blobs…");
  const imageBlobs = [];

  for await (const image of images) {
    const encodedImage = await fs.readFile(image.path, { encoding: "base64" });

    const blob = await github.git.createBlob({
      owner,
      repo,
      content: encodedImage,
      encoding: "base64"
    });

    // We use image.name rather than image.path because it is the path inside the repo
    // rather than the path on disk (which is static/images/image.jpg rather than /github/workpace/static/images/image.jpg)
    imageBlobs.push({
      path: image.name,
      type: "blob",
      mode: "100644",
      sha: blob.data.sha
    });
  }

  return imageBlobs;
};

const toUpdateRef = ref => ref.replace(/^refs\//, '')

const getBranch = ref => {
  const tmpArr = ref.split('/')
  return tmpArr[tmpArr.length - 1]
}

const getLastSha = async (owner, repo, ref) => {
  const res = await github.git.getRef({
    owner,
    repo,
    ref
  })

  return res.data.object.sha
}

const createPr = async (optimisedImages, markdown) => {
  const event = await githubEvent();
  const owner = event.repository.owner.login;
  const repo = event.repository.name;
  const baseRef = GITHUB_REF
  const destRef = GITHUB_REF + '-image-bot'

  console.log('ref ', baseRef, destRef)

  // always try delete destRef first
  await github.git.deleteRef({
    owner,
    repo,
    ref: toUpdateRef(destRef)
  })

  console.log('delete dest branch')

  // get branch last commit sha as process branch base
  const ls = await getLastSha(owner, repo, toUpdateRef(baseRef))
  console.log('get last commit')

  // create branch
  const { data: ref } = await github.git.createRef({
    owner,
    repo,
    ref: destRef,
    sha: ls
  })
  console.log('create new branch')
  
  // create blobs
  const treeBlobs = await convertToTreeBlobs({
    owner,
    repo,
    images: optimisedImages
  });

  console.log('create blobs')

  // create commit tree
  const { data: newTree } = await github.git.createTree({
    owner,
    repo,
    tree: treeBlobs,
    base_tree: ref.object.sha
  })
  console.log('new tree')

  // create commit
  const { data: commit } = await github.git.createCommit({
    owner,
    repo,
    message: 'Optimised images',
    tree: newTree.sha,
    parents: [ref.object.sha]
  })
  console.log('create commit')

  // update ref
  const { data: ref2 } = await github.git.updateRef({
    owner,
    repo,
    ref: toUpdateRef(destRef),
    sha: commit.sha
  })

  console.log('update ref')

   // create pr
   await github.pulls.create({
    owner,
    repo,
    base: getBranch(baseRef),
    head: getBranch(destRef),
    body: markdown,
    title: '[Image Bot] Optimised images'
  })

  console.log('create pr')
}

const runPush = async () => {
  console.log(logPrefix, " ->> Locating images…");

  const results = await processImages();

  const optimisedImages = results.images.filter(
    img => img.compressionWasSignificant
  );

  // If nothing was optimised, bail out.
  if (!optimisedImages.length) {
    console.log("::warning:: Nothing left to optimise. Stopping…");
    return;
  }

  console.log("->> Generating markdown…");
  const markdown = generateMarkdownReport(results);

  console.log("->> Committing files…");
  await createPr(optimisedImages, markdown);

  return results;
}

module.exports = {
  runPush
}
