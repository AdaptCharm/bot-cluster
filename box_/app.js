var crypto = require('crypto');
var config = require('./config.js');
var Logger  = require('./logger.js');
var Task  = require('./task.js');
var net = require('net');
var log = new Logger('box');
var os = require('os');

function Box(socket) {
    this.socket = socket;
    this.log = log;
    this.id = '';
    this.buff = '';
    this.agony = false;

    this.attachEvents();
}

Box.prototype.send = function() {
    var arr = [];
    for(var i=0;i<arguments.length;i++) arr.push(arguments[i]);
    var json = JSON.stringify(arr);

    if(this.agony)
        return this.log.warn('Send drop, Box in agony, data: ' + json);

    if(config.debug >= 4)
        this.log.info('SEND: ' + json);

    this.socket.write(json + '\n');
};

Box.prototype.report = function(data) {
    var json = JSON.stringify(['report', data]);

    if(config.debug >= 1)
        this.log.error('Error detected, reporting to master: ' + this.log.colorize(31, true, false, data));

    if(config.debug >= 4)
        this.log.info('END: ' + json);

    if(this.agony)
        return this.log.warn('End drop, Box in agony, data: ' + json);

    this.agony = true;
    this.socket.end(json + '\n');
};

Box.prototype.checkBuffer = function() {
    var pos = this.buff.indexOf('\n');
    if(pos < 0) return;
    var json = this.buff.substr(0, pos);
    this.buff = this.buff.substr(pos+1);

    this.processJSON(json);
    this.checkBuffer();
};

Box.prototype.processJSON = function(json) {
    var obj;

    if(config.debug >= 4)
        this.log.info('Processing JSON: ' + json);

    try {
        obj = JSON.parse(json);
    }catch(e){
        return this.report('Unable to parse json="' + json + '", e=' + e);
    }

    var params = obj.slice(1);
    var processor = this.processors[obj[0]];

    if(!processor) {
        return this.report('Unknown processor "' + obj[0] + '" json="' + json);
    }

    try {
        processor.apply(this, params);
    }catch(e){
        this.report('Processor "' + obj[0] + '" crashed while processing. json="' + json + '", e=' + e + ', s=' + e.stack);
    }
};

Box.prototype.attachEvents = function() {
    this.socket.on('connect', this.onConnect.bind(this));
    this.socket.on('close',   this.onClose.bind(this));
    this.socket.on('data',    this.onData.bind(this));
    this.socket.on('drain',   this.onDrain.bind(this));
    this.socket.on('end',     this.onEnd.bind(this));
    this.socket.on('error',   this.onError.bind(this));
};

Box.prototype.onConnect = function() {
    if(config.debug >= 1)
        this.log.info('Box connected to master server');
};

Box.prototype.onClose = function() {
    if(config.debug >= 1)
        this.log.info('Disconnected from master server');

    process.exit(0);
};

Box.prototype.onData = function(s) {
    if(config.debug >= 4)
        this.log.info('RECV: "' + s + '"');
    this.buff += s;
    this.checkBuffer();
};

Box.prototype.onDrain = function() {
    if(config.debug >= 5)
        this.log.info('Socket drain');
};

Box.prototype.onEnd = function() {
    if(config.debug >= 1)
        this.log.info('FIN packet received');
};

Box.prototype.onError = function(e) {
    if(config.debug >= 1)
        this.log.error('Socket error: ' + e);
};

Box.prototype.processors = {
    'hello': function(id) {
        this.id = id;

        if(config.debug >= 1)
            this.log.info('Got my id from master: ' + this.log.colorize(null, true, true, id));

        var fingerprint = crypto.createHmac('md5', this.id + config.client.password).digest('hex');
        var report = {
            config: config.box,
            report: {
                os: {
                    arch: os.arch(),
                    platform: os.platform(),
                    release: os.release(),
                    ram: os.totalmem(),
                    type: os.type(),
                    network_interfaces: os.networkInterfaces(),
                    cpus: os.cpus()
                }
            }
         };
        for(var i=0;i<report.report.os.cpus.length;i++) {
            delete report.report.os.cpus[i].times;
        }

        this.send('auth', fingerprint, report);

        if(config.debug >= 1)
            this.log.info('Auth request sent with fingerprint ' + this.log.colorize(39, false, true, fingerprint));
    },

    'kill': function(reason) {
        if(config.debug >= 1)
            this.log.error('Master killed me! Committing suicide! Reason: ' + this.log.colorize(31, true, false, reason));

        this.agony = true;
        this.socket.destroy();
    },

    'ping': function(time) {
        if(config.debug >= 3)
            this.log.info('Received ping, sending pong ' + this.log.colorize(39, false, true, time));
        this.send('pong', time);
    },

    'config': function(conf) {
        if(config.debug >= 1)
            this.log.info('Received settings');
        config.debug = conf.debug;
        config.remote = conf;
        config.logic = conf.logic;

        var box = this;
        var last = (+new Date);
        setInterval(function() {
            var now = (+new Date);
            var delta = now-last;
            last = now;
            delta -= config.remote.delay_probe_interval;

            box.send('delay', delta);
        }, config.remote.delay_probe_interval);
    },

    'engage': function(task_opt) {
        new Task(task_opt);
    },

    'disengage': function(task_id) {
        var task = Task.tasks[task_id];
        //if(!task) throw new Error('Master sent `disengage`, but we fail to find task ID: ' + task_id); //if double click on disengage, this will crash
        if(!task) return this.log.warn('Master sent `disengage`, but we fail to find task ID: ' + task_id);
        if(task.destroyed) {
            if(config.debug >= 1)
                this.log.warn('Received destroy, but task already destroyed');
            return;
        }
        task.destroy();
    },

    'new_target': function(tasks, target, a, b, ball_name, ball_x, ball_y) {
        for(var i=0;i<tasks.length;i++) {
            var task = Task.tasks[tasks[i]];
            if(!task) continue;
            if(target == 'split') {
                task.split();
            }else if(target == 'eject') {
                task.eject();
            }else if(target == 'memory_reset') {
                task.memoryReset();
            }else{
                task.setTarget(target, a, b, ball_name, ball_x, ball_y);
            }
        }
    }
};

log.info('Connecting to master server');
var box = new Box( net.connect(config.client.port, config.client.host) );
Task.box = box;

