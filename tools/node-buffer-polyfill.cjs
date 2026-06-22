'use strict';

/**
 * Node 22+ removed SlowBuffer; legacy jwt deps (buffer-equal-constant-time via
 * firebase-admin) read SlowBuffer.prototype at load time and crash without this.
 */
const buffer = require('buffer');

if (!buffer.SlowBuffer) {
  buffer.SlowBuffer = buffer.Buffer;
}

module.exports = {};
