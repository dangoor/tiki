// ==========================================================================
// Project:   Tiki
// Copyright: ©2009 Apple Inc.
// ==========================================================================
/*globals Sandbox create */

"export package Sandbox";
"export create";

/**
  @file
  
  A Sandbox provides a common space to activate secure modules.  You will 
  often have only one sandbox within an application, though you could create
  as many as you like.  This might be useful, for example, to control access
  for plugins.

  To create a new Sandbox, you must pass in a Loader instance as well.  Most 
  of the time you can obtain a loader from the require.loader property.
  
  A new sandbox will inherit whatever modules are registered on the loader.
  Modules will actually be reinstantiated however, when you require each of 
  them.

  @since Tiki 1.0
*/


/**
  @class 

  A sandbox defines a common space where modules can be instantiated and 
  imported.  Each loader comes with a default sandbox where modules are 
  run though you can create additional sandboxes also if you wish.  

  Eventually this will form the basis of a secure system for giving 
  plugins limited access to your application code.

  To create a new sandbox just call the sandbox() method on a loader.  
  This will create a sandbox attached to the named loader.  Once you have 
  created a sandbox, you start running code by calling require().

*/
Sandbox = function(id, loader, mainModuleId) {

  var modules  = {}, // instantiated modules
      packages = {}, // names of packages & modules instantiated so far
      HASH     = {},
      sandbox  = this;

  this.id = id ;
  this.packages = packages;

  function _clear() {
    modules = {} ;
    packages = {} ;
  }
  
  // this is the core require method.  requires that you pass either a 
  // bundleId
  function _require(packageId, moduleId, curPackageId, curModuleId) {
    var require, info, pkg, exports, moduleInfo, factory;

    // normalize - if no packageId was passed, use curPackageId
    if (moduleId === undefined) {
      moduleId = packageId;
      packageId = curPackageId;
    }
    
    // convert require to canonical reference to a packageId/moduleId
    moduleId = loader.resolve(moduleId, curModuleId); // make absolute...
    info = loader.canonical(packageId, moduleId, HASH);
    packageId = info.packageId; moduleId = info.moduleId;

    // see if its already initialized
    pkg = modules[packageId];
    if (!pkg) pkg = modules[packageId] = {};
    exports = pkg[moduleId];
    if (exports) return exports ;

    // add package/module name to list so others can iterate it
    info = packages[packageId];
    if (!info) info = packages[packageId] = [];
    info.push(moduleId);
    
    // not initialized, init module 
    pkg[moduleId] = exports = {};
    
    // generate custom require with safe info exposed
    require = function(b, m) {
      return _require(b, m, packageId, moduleId);
    };
    require.loader  = loader ;
    require.main    = mainModuleId;
    require.clear   = _clear;
    
    // setup module info describing module state
    moduleInfo = { sandbox: sandbox, id: moduleId, packageId: packageId };

    // run module factory in loader
    loader.factory(packageId, moduleId, require, exports, moduleInfo);
    return exports;
  }

  // require a module...
  this.require = function(packageId, moduleId) {
    return _require(packageId, moduleId);
  };

};

// safe methods
Sandbox.prototype = {};

create = function create(id, loader, main) {
  return new Sandbox(id, loader, main);
};
