const http = require('http');
const https = require('https');
const path = require('path');
const url = require('url');
const serveStatic = require('serve-static');
const getPort = require('get-port');
const serverErrors = require('./utils/customErrors').serverErrors;
const fs = require('fs');

function middleware(bundler) {
  const serve = serveStatic(bundler.options.outDir, {index: false});

  return function(req, res, next) {
    // Wait for the bundler to finish bundling if needed
    if (bundler.pending) {
      bundler.once('bundled', respond);
    } else {
      respond();
    }

    function respond() {
      if (bundler.errored) {
        return send500();
      } else if (!req.url.startsWith(bundler.options.publicURL)) {
        // If the URL doesn't start with the public path, send the main HTML bundle
        return sendIndex();
      } else {
        // Otherwise, serve the file from the dist folder
        req.url = req.url.slice(bundler.options.publicURL.length);
        return serve(req, res, send404);
      }
    }

    function sendIndex() {
      // If the main asset is an HTML file, serve it
      if (bundler.mainAsset.type === 'html') {
        req.url = `/${bundler.mainAsset.generateBundleName(true)}`;
        serve(req, res, send404);
      } else {
        send404();
      }
    }

    function send500() {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.writeHead(500);
      res.end('🚨 Build error, check the console for details.');
    }

    function send404() {
      if (next) {
        return next();
      }

      res.writeHead(404);
      res.end();
    }
  };
}

async function serve(bundler, port) {
  let freePort = await getPort({port});
  let options = bundler.options;
  let server = undefined;
  if (options.https) {
    if (options.key != undefined && options.cert != undefined) {
      server = https
        .createServer(
          {
            key: fs.readFileSync(options.key),
            cert: fs.readFileSync(options.cert)
          },
          middleware(bundler)
        )
        .listen(freePort);
    } else if (options.pfx != undefined) {
      server = https
        .createServer(
          {
            pfx: fs.readFileSync(options.pfx)
          },
          middleware(bundler)
        )
        .listen(freePort);
    }
  } else {
    server = http.createServer(middleware(bundler)).listen(freePort);
  }

  server.on('error', err => {
    bundler.logger.error(new Error(serverErrors(err, server.address().port)));
  });

  server.once('listening', connection => {
    let addon =
      server.address().port !== port
        ? `- ${bundler.logger.chalk.red(
            `configured port ${port} could not be used.`
          )}`
        : '';
    if (options.https) {
      bundler.logger.persistent(
        `Server running at ${bundler.logger.chalk.cyan(
          `https://localhost:${server.address().port}`
        )} ${addon}\n`
      );
    } else {
      bundler.logger.persistent(
        `Server running at ${bundler.logger.chalk.cyan(
          `http://localhost:${server.address().port}`
        )} ${addon}\n`
      );
    }
  });

  return server;
}

exports.middleware = middleware;
exports.serve = serve;
