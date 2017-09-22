// Copyright 2016 Luca-SAS, licensed under the Apache License 2.0

'use strict';

var ContextRemote = require('./lib/context.js');
var ContextLocal = require('./lib/context-local.js');
var Dataset = require('./lib/dataset.js');

function Context(args) {
  args = args || {};
  if (args.host || process.env.SKALE_HOST) return ContextRemote(args);
  return ContextLocal(args);
}

module.exports = {
  Context: Context,
  context: Context,
  HashPartitioner: Dataset.HashPartitioner,
  RangePartitioner: Dataset.RangePartitioner,
  Source: Dataset.Source
};
