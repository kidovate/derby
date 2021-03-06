/*
 * App.js
 *
 * Provides the glue between views, controllers, and routes for an
 * application's functionality. Apps are responsible for creating pages.
 *
 */

var EventEmitter = require('events').EventEmitter;
var tracks = require('tracks');
var util = require('racer/lib/util');
var derbyTemplates = require('derby-templates');
var documentListeners = require('./documentListeners');
var Page = require('./Page');

module.exports = App;

function App(derby, name, filename) {
  EventEmitter.call(this);
  this.derby = derby;
  this.name = name;
  this.filename = filename;
  this.Page = createAppPage();
  this.proto = this.Page.prototype;
  this.views = new derbyTemplates.templates.Views();
  this.tracksRoutes = tracks.setup(this);
  this.model = null;
  this.page = null;
  this._init();
}

function createAppPage() {
  // Inherit from Page so that we can add controller functions as prototype
  // methods on this app's pages
  function AppPage() {
    Page.apply(this, arguments);
  }
  AppPage.prototype = Object.create(Page.prototype);
  return AppPage;
}

util.mergeInto(App.prototype, EventEmitter.prototype);

// Overriden on server
App.prototype._init = function() {
  var serializedViews = require('./_views');
  serializedViews(derbyTemplates, this.views);

  this.model = new this.derby.Model();

  // Init async so that app.on('model') listeners can be added
  var app = this;
  process.nextTick(function() {
    app.emit('model', app.model);

    var script = app._getScript();
    var data = JSON.parse(script.getAttribute('data-bundle'));
    script.removeAttribute('data-bundle');
    app.model.createConnection(data);
    app.model.unbundle(data);
    app._autoRefresh();
    var page = app.createPage();
    page.params = app.model.get('$render.params');
    page.attach();
    app.emit('ready');
  });
};

App.prototype._getScript = function() {
  return document.querySelector('script[src="/derby/' + this.name + '"]');
};

App.prototype.use = util.use;
App.prototype.serverUse = util.serverUse;

App.prototype.loadViews = function() {};

App.prototype.loadStyles = function() {};

App.prototype.createPage = function() {
  if (this.page) this.page.destroy();
  var page = new this.Page(this, this.model);
  this.page = page;
  return page;
};

App.prototype.onRoute = function(callback, page, params, next, isTransitional, done) {
  // HACK: To update render in transitional routes
  page.model.set('$render.params', params);
  page.model.set('$render.url', params.url);
  page.model.set('$render.query', params.query);
  if (isTransitional) {
    if (callback.length === 4) {
      callback.call(page, page.model, params, next, done);
      return true;
    } else {
      callback.call(page, page.model, params, next);
      return;
    }
  }
  callback.call(page, page, page.model, params, next);
};

App.prototype._autoRefresh = function() {
  if (util.isProduction) return;

  var app = this;
  this.model.on('change', '$connection.state', function(state) {
    if (state === 'connected') registerClient();
  });
  this.model.channel.on('derby:refreshViews', function(serializedViews) {
    var fn = new Function('return ' + serializedViews)(); // jshint ignore:line
    fn(derbyTemplates, app.views);
    var ns = app.model.get('$render.ns');
    app.page.render(ns);
  });
  function registerClient() {
    var data = {name: app.name, hash: global.DERBY_SCRIPT_HASH};
    app.model.channel.send('derby:app', data, function(err) {
      if (!err) return;
      // Reload in a timeout so that returning fetches have time to complete
      // in case an onbeforeunload handler is being used
      setTimeout(function() {
        window.location = window.location;
      }, 100);
    });
  }
  registerClient();
};

util.serverRequire(module, './App.server');
