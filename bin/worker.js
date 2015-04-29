#!/usr/bin/env node

'use strict';

var os = require('os');
var cluster = require('cluster');

var UgridClient = require('../lib/ugrid-client.js');
var UgridJob = require('../lib/ugrid-processing.js').UgridJob;

var opt = require('node-getopt').create([
	['h', 'help', 'print this help text'],
	['d', 'debug', 'print debug traces'],
	['n', 'num=ARG', 'number of instances (default 1)'],
	['H', 'Host=ARG', 'server hostname (default localhost)'],
	['P', 'Port=ARG', 'server port (default 12346)']
]).bindHelp().parseSystem();

var num = opt.options.num || 1;
var debug = opt.options.debug || false;

if (cluster.isMaster) {
	cluster.on('exit', handleExit);
	for (var i = 0; i < num; i++)
		cluster.fork();
} else {
	runWorker(opt.options.Host, opt.options.Port);
}

function handleExit(worker, code, signal) {
	console.log("worker %d died (%s). Restart.", worker.process.pid, signal || code);
	if (code != 2)
		cluster.fork();
}

function runWorker(host, port) {
	var RAM = {}, jobs = {}, jobId;

	var grid = new UgridClient({
		debug: debug,
		host: host,
		port: port,
		data: {
			ncpu: os.cpus().length,
			os: os.type(),
			arch: os.arch(),
			usedmem: process.memoryUsage().rss,
			totalmem: os.totalmem(),
			hostname: os.hostname(),
			type: 'worker',
			jobId: ''
		}
	}, function (err, res) {
		console.log('id: ' + res.id + ', uuid: ' + res.uuid);
		grid.host = {uuid: res.uuid, id: res.id};
	});

	grid.on('error', function (err) {
		console.log("grid error %j", err);
		process.exit(2);
	});

	var request = {
		setJob: function (msg) {
			// TODO: app object must be created once per application, and reset on worker release
			var worker = msg.data.args.worker;
			for (var wid = 0; wid < worker.length; wid++)
				if (worker[wid].uuid == grid.host.uuid) break;
			var app = {
				worker: worker,
				wid: wid,
				master_uuid: msg.data.master_uuid,
				RAM: RAM,
				dones: {},
				completedStreams: {}
			}
			jobs[msg.data.jobId] = new UgridJob(grid, app, {
				node: msg.data.args.node,
				stageData: msg.data.args.stageData,
				actionData: msg.data.args.actionData,
				jobId: msg.data.jobId
			});
			grid.reply(msg, null, 'worker ready to process job');
		},
		shuffle: function (msg) {
			jobs[msg.data.jobId].processShuffle(msg);
		},
		reset: function () {
			if (!process.env.UGRID_TEST) process.exit(0);
			RAM = {};
			job = undefined;
			jobId = undefined;
		},
		stream: function (msg) {
			console.log('in worker %d, data: %j', grid.host.id, msg.data.data);
			if (msg.data.data === null) {
				grid.emit(msg.data.stream + ".end", msg.data.ignore, function () {
					grid.reply(msg);
				});
			} else {
				grid.emit(msg.data.stream, msg.data.data, function () {
					grid.reply(msg);
				});
			}
		}
	};

	grid.on('runJob', function (msg) {
		jobs[msg.data.jobId].run();
	});

	grid.on('lastLine', function (msg) {
		jobs[msg.jobId].processLastLine(msg);
	});

	grid.on('action', function (msg) {
		jobs[msg.jobId].processAction(msg);
	});

	grid.on('request', function (msg) {
		try {
			request[msg.data.cmd](msg);
		} catch (error) {
			console.error(error.stack);
			grid.reply(msg, error, null);
		}
	});
}
