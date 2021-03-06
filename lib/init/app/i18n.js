// `i18n` section processor
//
//  .
//  |- /i18n/
//  |   |- /<package>/
//  |   |   |- <locale>.js
//  |   |   `- ...
//  |   `- ...
//  `- ...
//


'use strict';


/*global N*/


// stdlib
var fs    = require('fs');
var path  = require('path');


// 3rd-party
var _         = require('underscore');
var async     = require('nlib').Vendor.Async;
var BabelFish = require('nlib').Vendor.BabelFish;
var fstools   = require('nlib').Vendor.FsTools;


// internal
var findPaths = require('./utils').findPaths;
var deepMerge = require('./utils').deepMerge;
var stopWatch = require('./utils').stopWatch;
var serialize = require('../../jetson').serialize;


////////////////////////////////////////////////////////////////////////////////


function collectTranslations(config, callback) {
  findPaths(config.lookup, function (err, pathnames) {
    var translations = {}, pathname, data;

    if (err) {
      callback(err);
      return;
    }

    // get copy of an array
    pathnames = pathnames.slice();

    while (pathnames.length) {
      pathname = pathnames.shift();

      try {
        data = pathname.require();
      } catch (err) {
        callback(new Error('Failed read ' + pathname + ':\n' +
                           (err.stack || err.message || err)));
        return;
      }

      _.each(data, function (phrases, locale) {
        if (!translations[locale]) {
          translations[locale] = {};
        }

        translations[locale][pathname.api] = phrases;
      });
    }

    callback(null, translations);
  });
}


function collectTranslationsTree(config, callback) {
  var tree = {};

  async.forEachSeries(_.keys(config.packages), function (pkgName, next) {
    tree[pkgName] = { server: {}, client: {} };

    async.forEachSeries(['client', 'server'], function (part, nextPart) {
      var i18nConfig = config.packages[pkgName]['i18n_' + part];

      if (!i18nConfig) {
        nextPart();
        return;
      }

      collectTranslations(i18nConfig, function (err, data) {
        if (err) {
          nextPart(err);
          return;
        }

        deepMerge(tree[pkgName][part], data);
        nextPart();
      });
    }, next);
  }, function (err) {
    callback(err, tree);
  });
}


function getAvailableLocales(tree) {
  var locales = [];

  _.each(tree, function (pkgTree) {
    _.each(pkgTree, function (i18n) {
      locales = _.union(locales, _.keys(i18n));
    });
  });

  return locales;
}


function initLocales(tree) {
  var
  localesConfig   = N.config.locales || (N.config.locales = {}),
  enabledLocales  = localesConfig['enabled'] ? localesConfig['enabled']
                  : getAvailableLocales(tree),
  defaultLocale   = localesConfig['default'] ? localesConfig['default']
                  : enabledLocales[0];

  if (-1 === enabledLocales.indexOf(defaultLocale)) {
    throw "Default locale <" + defaultLocale + "> must be enabled";
  }

  // reset languages configuration
  N.config.locales = {
    "default": defaultLocale,
    "enabled": enabledLocales
  };
}


function initServerTranslator(tree) {
  var united = {};

  _.each(tree, function (subtree) {
    deepMerge(united, subtree.client);
    deepMerge(united, subtree.server);
  });

  N.runtime.i18n = new BabelFish(N.config.locales['default']);

  _.each(N.config.locales['enabled'], function (locale) {
    _.each(united[locale] || {}, function (data, scope) {
      N.runtime.i18n.addPhrase(locale, scope, data);
    });
  });
}


////////////////////////////////////////////////////////////////////////////////


module.exports = function (tmpdir, config, callback) {
  var timer = stopWatch();

  collectTranslationsTree(config, function (err, tree) {
    if (err) {
      callback(err);
      return;
    }

    // there's no difference between throw/catch or fn(callback(err))
    // http://jsperf.com/error-behavior
    try {
      initLocales(tree);
      initServerTranslator(tree);
    } catch (err) {
      callback(err);
      return;
    }

    async.forEachSeries(_.keys(config.packages), function (pkgName, next) {
      var
      subtree     = tree[pkgName].client,
      translator  = new BabelFish(N.config.locales['default']);

      fstools.mkdir(path.join(tmpdir, 'i18n', pkgName), function (err) {
        if (err) {
          next(err);
          return;
        }

        _.each(N.config.locales['enabled'], function (locale) {
          _.each(subtree[locale] || {}, function (data, scope) {
            translator.addPhrase(locale, scope, data);
          });
        });

        async.forEachSeries(N.config.locales['enabled'], function (locale, nextLocale) {
          var
          outfile = path.join(tmpdir, 'i18n', pkgName, locale + '.js'),
          script  = 'N.runtime.i18n.load(' +
                    JSON.stringify(locale) + ',' +
                    serialize(translator.getCompiledData(locale)) + ');';

          fs.writeFile(outfile, script, 'utf-8', nextLocale);
        }, next);
      });
    }, function (err) {
      N.logger.info('Processed i18_* sections ' + timer.elapsed);
      callback(err);
    });
  });
};
