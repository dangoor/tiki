// ==========================================================================
// Project:   Tiki
// Copyright: ©2009 Apple Inc.
// ==========================================================================
/*globals Loader sandbox promise setup create */

"import core as core";
"import lib/promise as promise";
"import lib/sandbox as sandbox";

"export package Loader";
"export create setup";

"use factory_format function";

/**
  @file
  
  The Loader module implement a package-based module loader that can fetch 
  packages from any server provided that you register the module first.

  When you load tiki, a global loader is automatically created that will 
  instantiate from this module.
*/

// types of promises
var SCRIPTS     = 'scripts', 
    CATALOG     = 'catalog', 
    MODULES     = 'modules',
    STYLESHEETS = 'stylesheets', 
    LOADS       = 'loads';


// standard wrapper around a module.  replace item[1] with a string and join.
var MODULE_WRAPPER = [
  '(function(require, exports, module) {',
  null,
  '\n});\n//@ sourceURL=',
  null,
  '\n'];

var TIKI_ARY = ['tiki/', null];

var STRING = 'string';

var globals = {};

/**
  @class
  
  The Loader class instantiated whenever you create a new loader.

  You can optionally pass a pending queue of actions which will be replayed 
  on the loader immediate.
*/
Loader = function Loader(id, queue, env) {
  this.id = id ;
  this.scripts = [];
  this.packages = []; 
  this.stylesheets = [];
  this.modules = [] ;
  this.sandbox = sandbox.create(id, this, env);
  this.register('default', {}); // always have a default package
  this.register('tiki', {}); // always local also
  
  // replay queue if provided
  var len = queue ? queue.length : 0, idx, action;
  for(idx=0;idx<len;idx++) {
    action = queue[idx];
    this[action.m].apply(this, action.a);
  }
  
  this._queue = queue ;
  return this ;
};

Loader.prototype = {

  /**
    List of all loaded script urls.
    
    @property {Array}
  */
  scripts: null,
  
  /**
    List of all loaded stylesheet urls.
  
    @property {Array}
  */
  stylesheets: null,
  
  /**
    List of all registered package names.
    
    @property {Array}
  */
  packages: null,
  
  /**
    The default Sandbox for the loader.
    
    @property {Sandbox}
  */
  sandbox: null,
  
  /**
    Registered modules, organized by package name.
  */
  modules: null,
  
  // ..........................................................
  // STANDARD LOADER API
  // 
  
  /**
    Take a relative or fully qualified module name as well as an optional
    base module Id name and returns a fully qualified module name.  If you 
    pass a relative module name and no baseId, throws an exception.
    
    Any embedded package name will remain in-tact.
    
    @param {String} moduleId relative or fully qualified module id
    @param {String} baseId fully qualified base id
    @returns {String} fully qualified name
  */
  resolve: function resolve(moduleId, baseId) {
    var path, len, idx, packageId, part, parts;

    // must have some relative path components
    if (moduleId.match(/(^\.\.?\/)|(\/\.\.?\/)|(\/\.\.?\/?$)/)) {

      // if we have a packageId embedded, get that first
      if ((idx=moduleId.indexOf(':'))>=0) {
        packageId = moduleId.slice(0,idx);
        moduleId  = moduleId.slice(idx+1);
        path      = []; // path must always be absolute.
        
      // if no package ID, then use baseId if first component is . or ..
      } else if (moduleId.match(/^\.\.?\//)) {
        if (!baseId) throw ("base required to resolve relative: " + moduleId);
        
        idx = baseId.indexOf(':');
        packageId = baseId.slice(0,idx);
        baseId = baseId.slice(idx+1);
        path = baseId.split('/');
        
      } else path = [];

      // iterate through path components and update path
      parts = moduleId.split('/');
      len   = parts.length;
      for(idx=0;idx<len;idx++) {
        part = parts[idx];
        if (part === '..') {
          if (path.length<1) throw "invalid path: " + moduleId.join('/');
          path.pop();
        
        } else if (part !== '.') path.push(part);
      }

      moduleId = path.join('/');
      if (packageId) moduleId = packageId + ':' + moduleId;
      
    // not a relative path, make sure we have a packageId at least
    } if (moduleId.indexOf(':')<0) {
      if (baseId && ((idx=baseId.indexOf(':'))>0)) {
        packageId = baseId.slice(0,idx);
      } else packageId = 'tiki';
      moduleId = packageId + ':' + moduleId ;
    }
    return moduleId ;
  },

  /**
    Accepts a moduleId and optional baseId and packageId.  Returns a canonical
    reference to a module that can be used to actually load the module.
    
    Currently this is the same as calling resolve()
    
    @param {String} moduleId the module id
    @param {String} baseId optional base id
    @returns {String} canonical reference
  */
  canonical: function canonical(moduleId, baseId) {
    return this.resolve(moduleId, baseId);
  },
  
  /**
    Takes module text, wraps it in a factory function and evaluates it to 
    return a module factory.  This method does not cache the results so call
    it sparingly.  
    
    @param {String} moduleText the raw module text to wrap
    @param {String} moduleId the module id - used for debugging purposes
    @returns {Function} factory function
  */
  evaluate: function evaluate(moduleText, moduleId) {
    var ret;
    
    MODULE_WRAPPER[1] = moduleText;
    MODULE_WRAPPER[3] = moduleId || '(unknown module)';
    
    ret = MODULE_WRAPPER.join('');
    ret = eval(ret);
    
    MODULE_WRAPPER[1] = MODULE_WRAPPER[3] = null;
    return ret;
  },
  
  /**
    Discover and return the factory function for the named module and package.
    You can also optionally pass a base module ID used to resolve the module.
    If you do not explicitly name a package and the package id is not embedded
    in the moduleId, then this method assumes you want the 'default' package.
    
    @param {String} moduleId the relative or absolute moduleId
    @param {String} baseId optional base moduleId to resolve relative paths
    @returns {Function} the factory function for the module
  */
  load: function load(moduleId, baseId) {

    var factories = this._factories, 
        factoriy, packagePart, factory, idx, info, tmp;
    
    // normalize
    moduleId    = this.canonical(moduleId, baseId);

    // if the named module is not registered, try with "tiki" in front
    if (!factories[moduleId] && !moduleId.match(/^tiki\//)) {
      TIKI_ARY[1] = moduleId;
      tmp = TIKI_ARY.join('');
      if (factories[tmp]) moduleId = tmp;
    }

    // Verify that this packageId/moduleId is ready.  Then get the factory.
    // evaling if needed.
    if (!this.ready(moduleId)) throw(moduleId + " is not ready");

    // lookup the actual factory.  assume it's there since it passed ready()
    factory = factories[moduleId];
    
    // if factory was registered as a string, then convert it to a function
    // the first time.
    if (factory && (STRING === typeof factory)) {
      factory = this.evaluate(factory, moduleId);
      factories[moduleId] = factory;
    }

    return factory;
  },  
  
  /**
    Calling this method will discover any modules for the named package and
    then make them available in the global context.  This will only init the 
    modules once.
    
    If a named package as modules: false then this will be skipped.
  */
  global: function(packageId) {
    var ARY = [null, 'package'],
        depends, info, len, idx, factories, moduleId, exports, key;
    
    info = this._catalog[packageId];
    if (!info) throw(packageId + " is not registered");  
    
    depends = info.depends;
    len = depends ? depends.length : 0 ;
    if (len<=0) return this; // nothing to do
    
    factories = this._factories;
    if (!factories) return this;  // nothing to do
    
    for(idx=0;idx<len;idx++) {
      packageId = depends[idx];
      if (globals[packageId]) continue ;
      globals[packageId] = true; // don't do this again
      
      if (!this.ready(packageId)) {
        throw("cannot make " + packageId + " global because it is not ready");
      }
      
      ARY[0] = packageId;
      moduleId = ARY.join(':');
      if (!factories[moduleId]) continue; //no module to instantiate
      
      // get module and export it globally
      exports = this.require(moduleId);
      for(key in exports) {
        if (!exports.hasOwnProperty(key)) continue;
        window[key] = exports[key];
      }
      
    }
  },
  
  // ..........................................................
  // REGISTRATION CALLBACKS
  // 
  // These methods should be called on the loader by the scripts as they 
  // load from the server.
  
  /**
    Registers a package or module with the loader.  If the name you pass 
    contains a package only, then we expect the second property to contain a
    package descriptor.  If the name contains a package and module, then the
    second parameter should be a factory string or function.
    
    If you call this method more than once with the same package name,
    the new package descriptor will replace the old one, so beware!
    
    @param {String} name the package name
    @param {Hash} desc a package descriptor
    @returns {Loader} receiver
  */
  register: function(name, desc) {
    
    if (name.indexOf(':')>0) return this.module(name, desc);
    
    var catalog = this._catalog, key;
    if (!catalog) catalog = this._catalog = {};
    catalog[name] = desc;
    
    // if the descriptor names other packages, add them those packages
    // to the catalog if they are not already there so that we can load
    // them.  However, the packages should not actually be 'registered'
    // since they haven't really loaded yet.
    var info = desc ? desc.packages : null;
    if (info) {
      for(key in info) {
        if (!info.hasOwnProperty(key) || catalog[key]) continue;
        catalog[key] = info[key];
      }
    }

    // for the package being registered, also add the package to the list
    // of known packages and resolve a CATALOG promise for it.  This may
    // allow other packages to immediately load their contents as well.
    if (!this._resolved(CATALOG, name)) this.packages.push(name);
    this._promiseFor(CATALOG, name).resolve(name);        
  },
  
  /**
    Registers a script with the loader.  If this is the first time this
    has been called, resolves a promise and adds the URL to the scripts
    array.  You should pass a symbolic name that represents the specific 
    script being loaded.  This may or may not match the actual load URL
    
    @param {String} id the script that was loaded
    @returns {Loader} reciever
  */
  script: function script(id) {
    if (!this._resolved(SCRIPTS, id)) this.scripts.push(id);
    this._promiseFor(SCRIPTS, id).resolve(id);        
    return this;
  },
  
  /**
    Registers that a given stylesheet has been loaded.  If this is the 
    first time this has been called, resolves a promise and adds the URL
    to the stylesheets array.
    
    @param {String} url the URL of the stylesheet that was loaded
  */
  stylesheet: function stylesheet(id) {
    if (!this._resolved(STYLESHEETS, id)) this.stylesheets.push(id);
    this._promiseFor(STYLESHEETS, id).resolve(id);        
    return this;
  },
  
  /**
    Registers a module with the loader.  Normally you should call register()
    instead.
    
    @param {String} moduleId name of module itself with package
    @param {Function} factory factory function for module
    @returns {Loader} receiver
  */
  module: function module(moduleId, factory) {
    var factories = this._factories;
    if (!factories) factories = this._factories = {};
    factories[moduleId] = factory ;
    
    if (!this._resolved(MODULES, moduleId)) this.modules.push(moduleId);
    this._promiseFor(MODULES, moduleId).resolve(moduleId);
  },

  /**
    Loads a package asynchronously.  Returns the package info or a promise
    to return the package info when completed.  Use the promise module to
    handle this promise.
  */
  async: function(packageId) {
    var ret = this._promiseFor(LOADS, packageId);
    
    // if the promise is pending (meaning it hasn't been started yet),
    // then either resolve it now or setup an action to load.
    if (ret.status === promise.PENDING) {
      if (this.ready(packageId)) {
        ret.resolve(); // already loaded - just resolve.

      // not fully loaded yet.  Setup the promise action and run it.
      } else {

        var loader = this ;
        
        // this is the actual load action.  Before we can really "load"
        // the package, the package needs to be registered in the catalog.
        // Hence for this action we actually just want to listen for the
        // catalog registration.  Once registered, then we load the 
        // scripts and stylesheets as needed.
        //
        // Also if some info was already found in the catalog, we'll get
        // scripts, stylesheets, and dependencies listed going there as 
        // well.  These are not going to be formal dependencies however,
        // until the actual package is registered.
        ret.action(function(pr) {
          
          // wait for package to be registered.  Once registered, load 
          // all of its contents and then resolve the load promise.
          loader._promiseFor(CATALOG, packageId).then(pr, function() {
            loader._loadPackage(packageId, pr);
            pr.resolve();
            
          // handle cancelling...
          }, function(reason) { pr.cancel(reason); });

          // in case there is info already in the catalog, get it going.
          // any of these items must load before the promise can resolve 
          // as well.
          loader._loadPackage(packageId, pr);
          
        }).run();
      }
    }
    
    return ret;
  },

  /**
    Requires a module.  This will instantiate a module in the default 
    sandbox.
  */
  require: function require(moduleId) {
    return this.sandbox.require(moduleId);
  },
  
  /**
    Return true if package or module is ready.
    
    @param {String} moduleId package or module id
    @returns {Boolean} true if ready
  */
  ready: function ready(moduleId) {
    
    var idx, packageId, info, items, loc, scriptId, styleId;

    idx = moduleId.indexOf(':');
    if (idx>=0) packageId = moduleId.slice(0, idx);
    else packageId = moduleId ;
        
    // is package loaded already? - nothing to do if not
    if (!this._resolved(CATALOG, packageId)) return false;
    info = this._catalog[packageId];
    
    // check dependencies
    items = info.depends;
    loc = items ? items.length : 0;
    while (--loc>=0) {
      if (!this.ready(items[loc])) return false ;
    }
    
    // check stylesheets
    items = info.stylesheets ;
    loc = items ? items.length : 0;
    while (--loc >= 0) {
      styleId = items[loc];
      if (STRING !== typeof styleId) styleId = styleId.id;
      if (!this._resolved(STYLESHEETS, styleId)) return false ;
    }
    
    // check scripts
    items = info.scripts;
    loc = items ? items.length : 0;
    while(--loc >= 0) {
      scriptId = items[loc];
      if (STRING !== typeof scriptId) scriptId = scriptId.id;
      if (!this._resolved(SCRIPTS, scriptId)) return false ;
    }
    
    // check module if provided...
    if (moduleId !== packageId) {
      if (!this._resolved(MODULES, moduleId)) return false;
    }
    
    return true ;
  },
  
  // ..........................................................
  // PRIVATE METHODS
  // 
  
  /** @private
  
    Gets a promise to load a script.  If the promise is still pending,
    then setup an action on the promise to actually load the script. Once
    the script registers itself, this promise will resolve.
  */
  _loadScript: function(scriptId) {
    var id, url, pr;

    // normalize scriptId.
    if (STRING !== typeof(scriptId)) {
      id = scriptId.id;  
      url = scriptId.url; 
    } else id = url = scriptId;
    
    pr = this._promiseFor(SCRIPTS, id);
    if (pr.status === promise.PENDING) {
      var loader = this ;
      pr.action(function(pr) {
        var body = document.body, el;
        if (!body) promise.cancel('no document to append script');
        
        el = document.createElement('script');
        el.setAttribute('src', url);
        body.appendChild(el);
        
        body = el = null ;
      });
    }
    return pr;
  },

  /** @private
  
    Gets a promise to load a stylesheet.  If the promise is still pending,
    then setup an action on the promise to actually load the script. Once
    the script registers itself, this promise will resolve.
  */
  _loadStylesheet: function(styleId) {
    var id, url, pr;

    // normalize scriptId.
    if (STRING !== typeof(styleId)) {
      id = styleId.id ;
      url = styleId.url;
    } else id = url = styleId;
    
    pr = this._promiseFor(STYLESHEETS, id);
    if (pr.status === promise.PENDING) {
      var loader = this ;
      pr.action(function(pr) {
        var body = document.body, el;
        if (!body) pr.cancel('no document to append stylesheet');
        
        el = document.createElement('link');
        el.setAttribute('rel', 'stylesheet');
        el.setAttribute('href', url);
        body.appendChild(el);
        body = el = null ;
        
        loader.stylesheet(id); // register and resolve promise
      });
    }
    return pr;
  },
  
  /** @private
  
    Loads the package if it is found in the catalog.  If a promise is 
    passed, the promise will depend on any found items loading.  May do 
    nothing.
  */
  _loadPackage: function(packageId, pr) {
    var info = this._catalog ? this._catalog[packageId] : null,
        items, loc, item, ordered, next, prDepends;
        
    if (!info) return this; // nothing to do

    // PROCESS DEPENDENCES.  
    // Create a single promise to gate these dependencies.  Load each 
    // dependency then resolve the depend promise.  This will gate scripts
    // and stylesheets.
    items = info.depends;
    loc   = items ? items.length : 0;
    prDepends = promise.create();
    while(--loc>=0) prDepends.depends(this.async(items[loc]));
    pr.depends(prDepends); // wait till resolved..
    prDepends.resolve();
    
    // PROCESS SCRIPTS
    items = info.scripts;
    loc   = items ? items.length : 0;
    next  = null;
    ordered = info.ordered !== false;  // assume ordered
    
    while(--loc>=0) {
      item = this._loadScript(items[loc]); // get promise to load script
      pr.depends(item); // package promise must wait...

      // ordered scripts must load in series. make next wait on current
      if (ordered) {
        if (next) item.then(next, next.run, next.cancel);
        
      // unordered scripts can load right away
      } else item.run();

      next = item ;
    }
    
    // start first item when ordered as soon as dependencies resolve
    if (next && ordered) prDepends.then(next, next.run, next.cancel);
    
    
    // PROCESS STYLESHEETS
    // Stylesheets can only load once dependencies have loaded to ensure
    // CSS rules layer properly.  They must also run in order to ensure
    // the links are in the correct order.
    items = info.stylesheets;
    loc   = items ? items.length : 0;
    next  = null;
    while(--loc >= 0) {
      item = this._loadStylesheet(items[loc]);
      pr.depends(item);
      if (next) item.then(next, next.run, next.cancel);
      next = item;
    }
    if (next) prDepends.then(next, next.run, next.cancel);
    
    // all done...
  },
  
  // eventually will provide a promise for the specified type/name. used
  // for dependency tracking
  _promiseFor: function(promiseType, name1, name2) {
    
    var promises = this._promises, sub1, sub2, ret, Q; 
    if (!promises) promises = this._promises = {};
    
    sub1 = promises[promiseType];
    if (!sub1) sub1 = promises[promiseType] = {};

    if (name2 === undefined) {
      sub2 = sub1; 
      name2 = name1;
    } else {
      sub2 = sub1[name1];
      if (!sub2) sub2 = sub1[name1] = {} ;
    } 
    
    ret = sub2[name2];
    if (!ret) ret = sub2[name2] = promise.create(promiseType);
    return ret ;
  },

  _discoveredStylesheets: false,
  
  // discovers any stylesheets in the document body
  discoverStylesheets: function() {
    this._discoveredStylesheets = true;
    if ('undefined' === typeof document) return this; //nothing to do

    var links = document.getElementsByTagName('link'),
        loc = links ? links.length : 0,
        link;
    while(--loc>=0) {
      link = links[loc];
      if (!link || (link.rel !== 'stylesheet')) continue;
      link = link.getAttribute("loadid") || link.getAttribute('LOADID') ;
      if (link) this.stylesheet(link.toString());
      
      link = link.href ;
      if (link) this.stylesheet(link.toString());
    }
    
    link = link = loc = null;
    
    return this ;
  },
  
  // returns true if a promise already exists for the type/name.  
  _resolved: function(promiseType, name1, name2) {
    if ((promiseType === STYLESHEETS) && !this._discoveredStylesheets) {
      this.discoverStylesheets();
    }
    
    var ret = this._promises;
    if (ret) ret = ret[promiseType];
    if (ret) ret = ret[name1];
    if (ret && name2) ret = ret[name2];
    return ret ? (ret.status===promise.RESOLVED) : false ;
  },
  
  /** @private */
  _inspectLoader: function() {
    
    // assemble list of known modules
    var lines = [], 
        modules = this.modules,
        key, names, len, idx, emitted = false;
        
    lines.push("Loader<id=" + this.id + ">:");
    
    if (this.packages.length>0) {
      lines.push("  packages: " + this.packages.join(','));
      lines.push('');
    }

    if (this.scripts.length>0) {
      lines.push("  scripts:");
      len = this.scripts.length;
      for(idx=0;idx<len;idx++) lines.push("    " + this.scripts[idx]);
      lines.push('');
    }


    if (this.stylesheets.length>0) {
      lines.push("  stylesheets:");
      len = this.scripts.length;
      for(idx=0;idx<len;idx++) lines.push("    " + this.scripts[idx]);
      lines.push('');
    }
            
    if (this.modules.length>0) {
      lines.push("  modules: ");
      len = this.modules.length;
      for(idx=0;idx<len;idx++) lines.push("    " + this.modules[idx]);
      lines.push('');
    } 
    
    return lines.join("\n");
  },
  
  _inspectModule: function(moduleId) {
    var lines = [],
        packageId = moduleId.slice(0, moduleId.indexOf(':')),
        tmp;
        
    // if the named package does not exist, see if it is in tiki
    if (this._catalog && !this._catalog[packageId]) {
      tmp = 'tiki/' + packageId;
      if (this._catalog[tmp]) {
        packageId = tmp;
        moduleId  = 'tiki/' + moduleId;
      }     
    }
    
    lines.push(moduleId + " (" + (this.ready(moduleId) ? 'READY' : 'NOT READY') + "):");
    
    lines.push(this._inspectPackage(packageId));
    return lines.join("\n");
  },
  
  _inspectPackage: function(packageId) {


    // if the named package does not exist, see if it is in tiki
    if (this._catalog && !this._catalog[packageId]) {
      var tmp = 'tiki/' + packageId;
      if (this._catalog[tmp]) packageId = tmp;
    }

    // emit header...
    var lines = [],
        info  = this._catalog ? this._catalog[packageId] : null,
        idx, len, item, parts;
        
    lines.push(packageId + " (" + (this.ready(packageId) ? 'READY' : 'NOT READY') + "): " + (info ? '' : 'Not in Catalog!') );
    
    if (!info) return lines.join("\n");
    
    len = info.depends ? info.depends.length : 0;
    if (len > 0) {
      parts = [];
      for(idx=0;idx<len;idx++) {
        item = info.depends[idx];
        parts.push(item + ' (' + (this.ready(item) ? 'READY' : 'NOT READY') + ')');            
      }
      lines.push('  depends: ' + parts.join(', '));
    }
    
    len = info.scripts ? info.scripts.length : 0;
    if (len > 0) {
      lines.push("\n  scripts:");
      for(idx=0;idx<len;idx++) {
        item = info.scripts[idx];
        if (STRING !== typeof item) item = item.id
        lines.push('    ' + item + ' (' + (this._resolved(SCRIPTS, item) ? 'READY' : 'NOT READY') + ')');
      }
    }

    len = info.stylesheets ? info.stylesheets.length : 0;
    if (len > 0) {
      lines.push("\n  stylesheets:");
      for(idx=0;idx<len;idx++) {
        item = info.stylesheets[idx];
        if (STRING !== typeof item) item = item.id
        lines.push('    ' + item + '(' + (this._resolved(STYLESHEETS, item) ? 'READY' : 'NOT READY') + ')');
      }
    }
    
    return lines.join("\n");
  },

  /** @private */
  inspect: function(id) {
    if (arguments.length === 0) return this._inspectLoader();
    else if (id.indexOf(':')<0) return this._inspectPackage(id);
    else return this._inspectModule(id);
  },
  
  /** @private - toString for loader */
  toString: function() {
    return "Loader<id=" + this.id + ">";
  }
  
};

// make methods display useful names
core.setupDisplayNames(Loader.prototype, 'Loader');

// setup the default loader if needed.  pass in the current loader
setup = function setup(curLoader, env) {
  if (curLoader && !curLoader.isBootstrap) return curLoader;
  
  // bootstrap env
  if (!env) env = {};
  if ('undefined' !== typeof window) env.window = window;
  if ('undefined' !== typeof document) env.document = document;
  
  var queue = curLoader ? curLoader.queue : null,
      id    = curLoader ? curLoader.id : 'default',
      ret   = new Loader(id, queue, env);
      
  // once we are done with the old loader; tear it down to release memory
  if (curLoader && curLoader.destroy) curLoader.destroy();
  return ret ;
};

create = function create(id) {
  return new Loader(id);
};
