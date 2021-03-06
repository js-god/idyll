#! /usr/bin/env node
const p = require('path');
const fs = require('fs-extra');
const readdir = require('recursive-readdir');
const request = require('request-promise-native');
const urljoin = require('url-join');
const chalk = require('chalk');
const ora = require('ora');

const IDYLL_PUB_API = 'https://api.idyll.pub';

const colors = {
  progress: chalk.hex('#6122fb'),
  success: chalk.green,
  failure: chalk.red
};

exports.command = 'publish'
exports.description = 'Publish your project to idyll.pub'
exports.builder = {}
exports.handler = async (yargs) => {
  const projectDir = process.cwd();
  const tokenPath = p.join(projectDir, '.idyll', 'token');
  const config = require(p.join(projectDir, 'package.json'))

  let spinner = ora({
    text: colors.progress('Deploying your project to idyll.pub...')
  });

  spinner.start();

  try {
    // TODO: configurable build path.
    let buildDir = p.join(projectDir, 'build');
    let token = await getProjectToken(tokenPath, config);
    let files = await readdir(buildDir);

    let formData = files.reduce((acc, f) => {
      acc[p.relative(buildDir, f)] = fs.createReadStream(f);
      return acc;
    }, {});
    formData.token = token;

    let { alias } = await request.post({
      url: urljoin(IDYLL_PUB_API, 'deploy'),
      formData: formData,
      json: true
    });

    spinner.succeed(colors.success(`Project deployed at https://idyll.pub/post/${alias}/`));
  } catch (err) {
    spinner.fail(colors.failure(`Could not deploy your project: ${err}`));
  }
}

/**
 * Try to read the project token from the .idyll directory.
 * If it does not exist, create/save one into .idyll/token.
 */
async function getProjectToken (tokenPath, config) {
  var token;
  try {
    token = await fs.readFile(tokenPath, { encoding: 'utf-8' });
  } catch (err) {
    let deployment = await request.post({
      url: urljoin(IDYLL_PUB_API, 'create'),
      body: {
        name: config.name
      },
      json: true
    });
    token = deployment.token;
    await fs.writeFile(tokenPath, token, { encoding: 'utf-8' });
  }
  return token;
}
