// ==========================================================================
// Project:   Tiki
// Copyright: ©2009 Apple Inc.
// ==========================================================================
/*globals exports Promise Loader Sandbox Object browser userAgent platformPackages platform */

"export Promise Loader Sandbox Object browser userAgent platformPackages platform";

// This file overrides the default package_exports generated by the build 
// tools.  We have to generate the index this way for tiki because it is 
// included automatically by other modules which are themselves required for
// this module to function.

// The tiki index module is imported automatically by all modules as the 
// "tiki" free-variable.  You can access this free variable to access platform
// specific APIs.

// note: must specify tiki explicitly b/c this will be loaded by boostrap
// require.
Promise = require('tiki:promise').Promise;
Loader  = require('tiki:loader').Loader;
Sandbox = require('tiki:sandbox').Sandbox;

// ..........................................................
// BROWSER DETECTION
// 

userAgent = navigator.userAgent.toLowerCase();

var version = (userAgent.match( /.+(?:rv|it|ra|ie)[\/: ]([\d.]+)/ ) || [])[1];

browser = {
  
  /** The current browser version */
  version: version,
  
  /** non-zero if webkit-based browser */
  safari: (/webkit/).test( userAgent ) ? version : 0,
  
  /** non-zero if this is an opera-based browser */
  opera: (/opera/).test( userAgent ) ? version : 0,
  
  /** non-zero if this is IE */
  msie: (/msie/).test( userAgent ) && !(/opera/).test( userAgent ) ? version : 0,
  
  /** non-zero if this is a miozilla based browser */
  mozilla: (/mozilla/).test( userAgent ) && !(/(compatible|webkit)/).test( userAgent ) ? version : 0,
  
  /** non-zero if this is mobile safari */
  mobileSafari: (/apple.*mobile.*safari/).test(userAgent) ? version : 0,
  
  /** non-zero if we are on windows */
  windows: !!(/(windows)/).test(userAgent),
  
  /** non-zero if we are on a mac */
  mac: !!((/(macintosh)/).test(userAgent) || (/(mac os x)/).test(userAgent)),
  
  language: (navigator.language || navigator.browserLanguage).split('-', 1)[0]
};

browser.isOpera = !!browser.opera;
browser.isIe = browser.msie;
browser.isIE = browser.msie;
browser.isSafari = browser.safari;
browser.isMobileSafari = browser.mobileSafari;
browser.isMozilla = browser.mozilla;
browser.isWindows = browser.windows;
browser.isMac = browser.mac;

/**
  The current browser name.  This is useful for switch statements. 
*/
browser.current = 
  browser.msie ? 'msie' : 
  browser.mozilla ? 'mozilla' : 
  browser.safari ? 'safari' : 
  browser.opera ? 'opera' : 'unknown' ;

// ..........................................................
// PLATFORM SPECIFIC INCLUDES
// 

// current platform packages in order.  usually the curent browser + 'browser'
platformPackages = ['tiki/'+browser.current, 'tiki/browser'];

// cache turns [packageId, moduleId] into joined
var platformIdCache={};
function _platformId(moduleId, packageId) {
  var cache = platformIdCache[packageId], ret;
  if (!cache) cache = platformIdCache[packageId];  
  ret = cache[moduleId];
  if (!ret) ret = cache[moduleId] = (packageId + ':' + moduleId);
  return ret ;
}

// substitute for "require".  This will return the named module from withing
// the current platform.  This will check each platform independently.
platform = function(moduleId) {
  var packageIds = exports.platformPackages, 
      len = packageIds ? packageIds.length : 0,
      idx, id;
  for(idx=0;idx<len;idx++) {
    id = _platformId(packageIds[idx], moduleId);
    if (require.loader.ready(id)) return require(id);
  }
  return require(moduleId); // just try a normal require.
};


