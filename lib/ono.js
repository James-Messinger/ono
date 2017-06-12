'use strict';

var format = require('format-util');
var slice = Array.prototype.slice;
var vendorSpecificErrorProperties = [
  'name', 'message', 'description', 'number', 'fileName', 'lineNumber', 'columnNumber',
  'sourceURL', 'line', 'column', 'stack'
];

module.exports = create(Error);
module.exports.error = create(Error);
module.exports.eval = create(EvalError);
module.exports.range = create(RangeError);
module.exports.reference = create(ReferenceError);
module.exports.syntax = create(SyntaxError);
module.exports.type = create(TypeError);
module.exports.uri = create(URIError);
module.exports.formatter = format;

/**
 * Creates a new {@link ono} function that creates the given Error class.
 *
 * @param {Class} Klass - The Error subclass to create
 * @returns {ono}
 */
function create (Klass) {
  /**
   * @param {Error}   [err]     - The original error, if any
   * @param {object}  [props]   - An object whose properties will be added to the error object
   * @param {string}  [message] - The error message. May contain {@link util#format} placeholders
   * @param {...*}    [params]  - Parameters that map to the `message` placeholders
   * @returns {Error}
   */
  return function onoFactory (err, props, message, params) {   // eslint-disable-line no-unused-vars
    var formattedMessage;

    if (typeof (err) === 'string') {
      formattedMessage = callFormatter(arguments);
      err = props = undefined;
    }
    else if (typeof (props) === 'string') {
      formattedMessage = callFormatter(slice.call(arguments, 1));
    }
    else {
      formattedMessage = callFormatter(slice.call(arguments, 2));
    }

    if (!(err instanceof Error)) {
      props = err;
      err = undefined;
    }

    if (err) {
      // The inner-error's message will be added to the new message
      formattedMessage += (formattedMessage ? ' \n' : '') + err.message;
    }

    // Create the new error
    // NOTE: DON'T move this to a separate function! We don't want to pollute the stack trace
    var newError = new Klass(formattedMessage);

    // Extend the new error with the additional properties
    extendError(newError, err);   // Copy properties of the original error
    extendToJSON(newError);       // Replace the original toJSON method
    extend(newError, props);      // Copy custom properties, possibly including a custom toJSON method

    return newError;
  };
}

/**
 * Calls the formatter function with the given arguments
 *
 * @param {string[]} [args]
 * @returns {string}
 */
function callFormatter (args) {
  var message;
  if (args.length) {
    message = module.exports.formatter.apply(null, args);
  }

  return message || '';
}

/**
 * Extends the targetError with the properties of the source error.
 *
 * @param {Error}   targetError - The error object to extend
 * @param {?Error}  sourceError - The source error object, if any
 */
function extendError (targetError, sourceError) {
  extendStack(targetError, sourceError);
  extend(targetError, sourceError, true);
}

/**
 * JavaScript engines differ in how errors are serialized to JSON - especially when it comes
 * to custom error properties and stack traces.  So we add our own toJSON method that ALWAYS
 * outputs every property of the error.
 */
function extendToJSON (error) {
  error.toJSON = errorToJSON;

  // Also add an inspect() method, for compatibility with Node.js' `util.inspect()` method
  error.inspect = errorToString;
}

/**
 * Extends the target object with the properties of the source object.
 *
 * @param {object}  target - The object to extend
 * @param {?source} source - The object whose properties are copied
 * @param {boolean} omitVendorSpecificProperties - Skip vendor-specific Error properties
 */
function extend (target, source, omitVendorSpecificProperties) {
  if (source && typeof (source) === 'object') {
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];

      // Don't bother trying to copy read-only vendor-specific Error properties
      if (omitVendorSpecificProperties && vendorSpecificErrorProperties.indexOf(key) >= 0) {
        continue;
      }

      try {
        target[key] = source[key];
      }
      catch (e) {
        // This property is read-only, so it can't be copied
      }
    }
  }
}

/**
 * Custom JSON serializer for Error objects.
 * Returns all built-in error properties, as well as extended properties.
 *
 * @returns {object}
 */
function errorToJSON () {
  var json = {};

  // Get all the properties of this error
  var keys = Object.keys(this);

  // Also include vendor-specific properties from the prototype
  keys = keys.concat(vendorSpecificErrorProperties);

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = this[key];
    var type = typeof value;
    if (type !== 'undefined' && type !== 'function') {
      json[key] = value;
    }
  }

  return json;
}

/**
 * Serializes Error objects as human-readable JSON strings for debugging/logging purposes.
 *
 * @returns {string}
 */
function errorToString () {
  return JSON.stringify(this, null, 2).replace(/\\n/g, '\n');
}

/**
 * Extend the error stack to include its cause
 *
 * @param {Error} targetError
 * @param {Error} sourceError
 */
function extendStack (targetError, sourceError) {
  if (hasLazyStack(targetError)) {
    if (sourceError) {
      lazyJoinStacks(targetError, sourceError);
    }
    else {
      lazyPopStack(targetError);
    }
  }
  else {
    if (sourceError) {
      targetError.stack = joinStacks(targetError.stack, sourceError.stack);
    }
    else {
      targetError.stack = popStack(targetError.stack);
    }
  }
}

/**
 * Appends the original {@link Error#stack} property to the new Error's stack.
 *
 * @param {string} newStack
 * @param {string} originalStack
 * @returns {string}
 */
function joinStacks (newStack, originalStack) {
  newStack = popStack(newStack);

  if (newStack && originalStack) {
    return newStack + '\n\n' + originalStack;
  }
  else {
    return newStack || originalStack;
  }
}

/**
 * Removes Ono from the stack, so that the stack starts at the original error location
 *
 * @param {string} stack
 * @returns {string}
 */
function popStack (stack) {
  if (stack) {
    var lines = stack.split('\n');

    if (lines.length < 2) {
      // The stack only has one line, so there's nothing we can remove
      return stack;
    }

    // Find the `onoFactory` call in the stack, and remove it
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('onoFactory') >= 0) {
        lines.splice(i, 1);
        return lines.join('\n');
      }
    }

    // If we get here, then the stack doesn't contain a call to `onoFactory`.
    // This may be due to minification or some optimization of the JS engine.
    // So just return the stack as-is.
    return stack;
  }
}

/**
 * Does a one-time determination of whether this JavaScript engine
 * supports lazy `Error.stack` properties.
 */
var supportsLazyStack = (function () {
  return !!(
    // ES5 property descriptors must be supported
    Object.getOwnPropertyDescriptor && Object.defineProperty &&

    // Chrome on Android doesn't support lazy stacks :(
    (typeof navigator === 'undefined' || !/Android/.test(navigator.userAgent))
  );
}());

/**
 * Does this error have a lazy stack property?
 *
 * @param {Error} err
 * @returns {boolean}
 */
function hasLazyStack (err) {
  if (!supportsLazyStack) {
    return false;
  }

  var descriptor = Object.getOwnPropertyDescriptor(err, 'stack');
  if (!descriptor) {
    return false;
  }
  return typeof descriptor.get === 'function';
}

/**
 * Calls {@link joinStacks} lazily, when the {@link Error#stack} property is accessed.
 *
 * @param {Error} targetError
 * @param {Error} sourceError
 */
function lazyJoinStacks (targetError, sourceError) {
  var targetStack = Object.getOwnPropertyDescriptor(targetError, 'stack');

  Object.defineProperty(targetError, 'stack', {
    get: function () {
      return joinStacks(targetStack.get.apply(targetError), sourceError.stack);
    },
    enumerable: false,
    configurable: true
  });
}

/**
 * Calls {@link popStack} lazily, when the {@link Error#stack} property is accessed.
 *
 * @param {Error} error
 */
function lazyPopStack (error) {
  var targetStack = Object.getOwnPropertyDescriptor(error, 'stack');

  Object.defineProperty(error, 'stack', {
    get: function () {
      return popStack(targetStack.get.apply(error));
    },
    enumerable: false,
    configurable: true
  });
}