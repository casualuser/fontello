"use strict";


/*global N, _*/


// stdlib
var fs   = require('fs');
var path = require('path');


// 3rd-party
var Mincer  = require('mincer');
var treeGet = require('nlib').Support.tree.get;


// internal
var compression = require('./compression');


////////////////////////////////////////////////////////////////////////////////


function configure(tmpdir, config, apps) {
  var environment = new Mincer.Environment(tmpdir);

  //
  // Provide some helpers to EJS and Stylus
  //

  environment.registerHelper({
    asset_path: function (pathname) {
      // TODO: Fix to understand "relative" paths
      var asset = environment.findAsset(pathname);
      return !asset ? null : ("/assets/" + asset.digestPath);
    },
    N: function (path, defaultValue) {
      return treeGet(N, path, defaultValue);
    }
  });

  //
  // fill in 3rd-party modules paths
  //

  environment.appendPath(path.resolve(__dirname, '../../../../node_modules/nlib/node_modules/pointer/browser'));
  environment.appendPath(path.resolve(__dirname, '../../../../node_modules/nlib/node_modules/babelfish/browser'));

  //
  // fill in all apps roots
  //

  _.each(config.packages, function (pkgConfig) {
    [ 'bin', 'styles' ].forEach(function (key) {
      if (!pkgConfig[key]) {
        return;
      }

      pkgConfig[key].lookup.forEach(function (options) {
        environment.appendPath(options.root);
      });
    });
  });

  //
  // Set JS/CSS compression if it was not explicitly disabled
  // USAGE: SKIP_ASSETS_COMPRESSION=1 ./N.js server
  //

  if (!process.env.SKIP_ASSETS_COMPRESSION) {
    environment.jsCompressor  = compression.js;
    environment.cssCompressor = compression.css;
  }

  return environment;
}


////////////////////////////////////////////////////////////////////////////////


module.exports.configure = configure;
