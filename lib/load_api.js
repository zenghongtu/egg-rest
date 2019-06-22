'use strict';

const fs = require('fs');
const path = require('path');

module.exports = app => {
  // support both generator function and async function
  if (app.config.rest.authRequest) {
    app.config.rest.authRequest = app.toAsyncFunction(app.config.rest.authRequest);
  }

  // load rest api
  let apiDir = path.join(app.config.baseDir, 'app', 'api');
  if (!fs.existsSync(apiDir)) {
    // backwards compatible
    apiDir = path.join(app.config.baseDir, 'app', 'apis');
  }
  // register routing automatically
  let urlprefix = app.config.rest.urlprefix;
  // /api/ => /api, / => "", ///a// => /a
  urlprefix = urlprefix.replace(/\/+$/, '').replace(/^\/+/, '/');

  app.logger.info(`[egg-rest] mount rest api: ${urlprefix} -> ${apiDir}`);

  // load the middleware only and if only the rest plugin enabled
  registerDir(app, urlprefix, apiDir, 0);

  function registerDir(app, prefix, dir, level) {
    const names = fs.readdirSync(dir);
    for (const name of names) {
      const filepath = path.join(dir, name);
      const stat = fs.statSync(filepath);
      if (stat.isDirectory()) {
        // nesting is supported, for only two layers at most, `/api/parents/:parent_id/children/:child_id/objects/:id`
        if (level === 0) {
          registerDir(app, prefix + '/' + name + '/:parent_id', filepath, level + 1);
        } else if (level === 1) {
          registerDir(app, prefix + '/' + name + '/:child_id', filepath, level + 1);
        } else {
          app.loggers.coreLogger.warn('[egg:rest] for directory "%s", the nesting is too deep(%d layer), one layer at most, which means `/api/parents/:parent_id/objects/:id`', filepath, level + 1);
        }

        continue;
      }

      if (stat.isFile() && /\.(js|ts)$/.test(path.extname(name))) {
        let handler = require(filepath);
        // support `module.exports = function (app) { return exports; }`
        if (typeof handler === 'function') {
          handler = handler(app);
        }
        let objectNames = path.basename(name, path.extname(name));
        // api/sites/index.js => GET /sites
        if (level >= 1 && objectNames === 'index') {
          objectNames = path.basename(dir);
          register(app, prefix.replace('/' + objectNames + '/:parent_id', ''), objectNames, handler);
        } else {
          register(app, prefix, objectNames, handler);
        }
      }
    }
  }

  function register(app, prefix, objectNames, handler) {
    const routeConfigs = {
      index: {
        method: 'get',
        url: '/{objects}',
      },
      show: {
        method: 'get',
        url: '/{objects}/:id',
      },
      create: {
        method: 'post',
        url: '/{objects}',
      },
      update: {
        method: 'put',
        url: '/{objects}/:id',
      },
      destroy: {
        method: 'delete',
        url: '/{objects}/:id',
      },
    };

    // check: index(), show(), create(), update(), destroy()
    for (const fname in handler) {
      // support both generator function and async function
      const fn = app.toAsyncFunction(handler[fname]);
      const routeConfig = routeConfigs[fname];
      if (!routeConfig) {
        continue;
      }

      const url = prefix + routeConfig.url.replace('{objects}', objectNames);
      const routerName = routeConfig.method + ':' + url;
      const restapi = require('./api')(app.config.rest, {
        fname,
        objects: objectNames,
        fn,
        rule: handler[fname + 'Rule'],
      });
      app[routeConfig.method](routerName, url, restapi);
      app.loggers.coreLogger.info('[egg:rest] register router: %s %s => %s.%s()',
        routeConfig.method.toUpperCase(), url, objectNames, fname);
    }
  }
};
