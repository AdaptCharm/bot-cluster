//Box with Bots
var config = require('./config.js');
var crypto = require('crypto');
var Logger = require('./logger.js');
var net = require('net');
//var db     = require('./db.js');


Box.stock = {}; //object with all active Boxes in it

function Box(socket) {
    this.id             = 'BOX/' + crypto.randomBytes(15).toString('base64');
    this.debug          = config.master.debug;
    this.socket         = socket;
    this.authorized     = false;
    this.connected_time = (+new Date);
    this.ping_history   = [];
    this.delay_history  = [];
    this.buff           = '';
    this.log            = new Logger(this.id);
    this.killed         = false;
    this.ping_interval  = null;
    this.tasks          = {};

    this.report = null;
    this.capacity = 0;

    this.attachEvents();
    this.socket.setEncoding('utf8');
    this.socket.setTimeout(config.master.socket.timeout);

    if(this.debug >= 1)
        this.log.info('Connected from ' + socket.remoteAddress + ':' + socket.remotePort);

    this.send('hello', this.id);
}

Box.prototype.initialize = function() {
    var box = this;
    Box.stock[this.id] = this;

    this.ping_interval = setInterval(function() {
        var time = (+new Date);
        if(box.debug >= 3)
            box.log.info('Sending ping request ' + box.log.colorize(39, false, true, time));
        box.send('ping', (+new Date));
    }, config.master.socket.ping_interval);

    this.send('config', config.box);
};

Box.prototype.cleanUp = function() {
    if(this.authorized) delete Box.stock[this.id];
    if(this.ping_interval) clearTimeout(this.ping_interval);

    var noticed = [];
    for(var id in this.tasks) {
        if(!this.tasks.hasOwnProperty(id)) continue;
        if(noticed.indexOf(this.tasks[id].customer.uid) < 0) {
            noticed.push(this.tasks[id].customer.uid);
            this.tasks[id].customer.send('notice', 17);
            this.tasks[id].customer.broadcast('notice', 17);
        }

        this.tasks[id].disengaged();
    }
};

Box.prototype.send = function() {
    var arr = [];
    for(var i=0;i<arguments.length;i++) arr.push(arguments[i]);
    var json = JSON.stringify(arr);

    if(this.killed) {
        if(this.debug >= 2)
            this.log.warn('Socket is killed, SEND aborted');
        return;
    }

    if(this.debug >= 4)
        this.log.info('SEND: ' + json);

    this.socket.write(json + '\n');
};

Box.prototype.kill = function(reason) {
    if(this.debug >= 1)
        this.log.warn('Killing connection: ' + reason);

    this.send('kill', reason);
    this.killed = true;
    // Ensures that no more I/O activity happens on this socket. Only necessary in case of errors (parse error or so).
    this.socket.destroy();
};

Box.prototype.checkBuffer = function() {
    if(this.buff.length > config.master.socket.max_buff_size) {
        return this.kill('Buffer overflow (' + this.buff.length + 'b)');
    }
    var pos = this.buff.indexOf('\n');
    if(pos < 0) return;
    var json = this.buff.substr(0, pos);
    this.buff = this.buff.substr(pos+1);
    this.processJSON(json);
    this.checkBuffer();
};

Box.prototype.processJSON = function(json) {
    var obj;
    if(this.debug >= 4)
        this.log.info('Processing JSON: ' + json);

    try {
        obj = JSON.parse(json);
    }catch(e){
        if(this.debug >= 1)
            this.log.error('Error parsing JSON: ' + e + ', json=' + json);
        this.kill('Packet parse error');
        return;
    }

    if((typeof obj) != 'object' || !Array.isArray(obj)) {
        if(this.debug >= 1)
            this.log.error('Bad packet type: ' + (typeof obj) + ', json=' + json);
        this.kill('Packet type error');
        return false;
    }

    if(!obj[0]) {
        if(this.debug >= 1)
            this.log.error('Empty packet command: ' + (typeof obj) + ', json=' + json);
        this.kill('Empty command');
        return false;
    }

    if(!this.processors[obj[0]]) {
        if(this.debug >= 1)
            this.log.error( this.log.colorize(31, true, false, 'Unknown packet command: ') + this.log.colorize(31, true, true, obj[0]));
        this.kill('Unknown packet command: ' + obj[0]);
        return false;
    }

    if(!this.authorized && obj[0] != 'auth') {
        if(this.debug >= 1)
            this.log.error('Unauthorized access! json=' + json);
        this.kill('Unauthorized access');
        return false;
    }

    var params = obj.slice(1);
    var processor = this.processors[obj[0]];
    try {
        processor.apply(this, params);
    }catch(e){
        if(this.debug >= 1)
            this.log.error('Processor "' + obj[0] + '" crashed while processing. \njson="' + json + '"\ne=' + e + '"\nstack=' + e.stack);
        this.kill('Processor crash');
    }
};

Box.prototype.attachEvents = function() {
    this.socket.on('close',   this.onClose.bind(this));
    this.socket.on('data',    this.onData.bind(this));
    this.socket.on('drain',   this.onDrain.bind(this));
    this.socket.on('end',     this.onEnd.bind(this));
    this.socket.on('error',   this.onError.bind(this));
    this.socket.on('timeout', this.onTimeout.bind(this));
};

Box.prototype.onClose = function() {
    if(this.debug >= 1 && !this.killed && !this.authorized)
        this.log.warn('Socket closed before authorization');

    if(this.debug >= 1)
        this.log.info('Disconnected');

    this.cleanUp();
};

Box.prototype.onData = function(s) {
    if(this.debug >= 5)
        this.log.info('RECV: "' + s + '"');
    this.buff += s;
    this.checkBuffer();
};

Box.prototype.onDrain = function() {
    if(this.debug >= 5)
        this.log.info('Socket drain');
};

Box.prototype.onEnd = function() {
    if(this.debug >= 1)
        this.log.info('FIN packet received');
};

Box.prototype.onError = function(e) {
    if(this.debug >= 1)
        this.log.error('Socket error: ' + e);
};

Box.prototype.onTimeout = function() {
    if(this.debug >= 3)
        this.log.error('Socket timeout!');
    this.kill('Socket timeout');
};


Box.prototype.processors = {
    auth: function(fingerprint, report, version) {
        if(this.debug >= 1)
            this.log.info('Received auth fingerprint ' + this.log.colorize(39, false, true, fingerprint) + ' with version ' + version);
        if(config.box.version != version) {
            return this.kill('Wrong version "' + config.box.version + '"!');
        }

        var calc_fingerprint = crypto.createHmac('md5', this.id + config.master.box.password).digest('hex');

        if(fingerprint != calc_fingerprint) {
            if(this.debug >= 1)
                this.log.error('Auth: calculated ' + this.log.colorize(39, false, true, calc_fingerprint) + ' received ' + this.log.colorize(39, false, true, fingerprint));
            return this.kill('Auth failed with invalid fingerprint!');
        }

        if(!report || !report.config || !report.config.capacity) return this.kill('Auth failed with invalid report: ' + JSON.stringify(report));

        if(this.debug >= 1)
            this.log.info('Success auth!');

        this.authorized = true;
        this.capacity = report.config.capacity;
        this.report = report.report;
        this.initialize();
    },

    report: function(reason) {
        if(this.debug >= 1)
            this.log.error('Box reporting ' + this.log.colorize(31, true, true, 'fatal error') + ': ' + this.log.colorize(31, true, false, reason));
    },

    'pong': function(time) {
        var delta = (+new Date)-time;
        if(this.debug >= 3)
            this.log.info('Got pong answer ' + this.log.colorize(39, false, true, time) + ' with delta ' + this.log.colorize(39, false, true, delta + 'ms'));
        this.ping_history.push(delta);
        if(this.ping_history.length > config.master.socket.ping_history_size) {
            this.ping_history.shift();
        }
    },

    'delay': function(delta) {
        if(this.debug >= 3)
            this.log.info('Got delay ' + this.log.colorize(39, false, true, delta) + 'ms');
        this.delay_history.push(delta);
        if(this.delay_history.length > config.master.socket.ping_history_size) {
            this.delay_history.shift();
        }
    },

    'task': function(task_id, cmd) {
        var task = this.tasks[task_id];
        var args = [];

        for(var i=2;i<arguments.length;i++) args.push(arguments[i]);

        if(!task) {
            this.log.warn('task ' + task_id + ' reported cmd=' + cmd + ', args=' + JSON.stringify(args) + ' but was not found in box ' + this.id);
            return;
        }
        if(this.debug >= 3)
            this.log.info('Task ' + task + ' reporting cmd=' + cmd+ ', args=' + JSON.stringify(args));

        if(!task.box_processors[cmd]) return this.kill('Unknown task box_processor: ' + cmd);
        task.box_processors[cmd].apply(task, args);
    }
};

Box.init = function(cb) {
    var server = net.createServer(function(socket) {
        new Box(socket);
    });

    server.on('listening', function() {
        cb();
    });

    server.listen(config.master.box.listen_port, config.master.box.listen_ip);
};

Box.prototype.countSubscriptionsBots = function() {
    var count = 0;
    for(var task_id in this.tasks) {
        if(!this.tasks.hasOwnProperty(task_id)) continue;
        var sub = this.tasks[task_id].subscription;
        count += sub.count;
    }

    return count;
};

/*Box.findFreeBox = function(sub) {
    var candidate = null;
    var candidate_free_bots = 0;
    for(var box_id in Box.stock) {
        if(!Box.stock.hasOwnProperty(box_id)) continue;
        var box = Box.stock[box_id];
        var bots_reserved = box.countSubscriptionsBots();
        var free_bots = (config.box.bots_per_box-bots_reserved);
        if(free_bots >= sub.count && (!candidate || free_bots > candidate_free_bots)) {
            candidate = box;
            candidate_free_bots = free_bots;
        }
    }
    return candidate;
};*/

Box.findFreeBox = function(sub) {
    var candidate = null;
    var candidate_load = 1;
    for(var box_id in Box.stock) {
        if(!Box.stock.hasOwnProperty(box_id)) continue;
        var box = Box.stock[box_id];
        var bots_running = box.countSubscriptionsBots();
        var free_bots = (box.capacity-bots_running);
        var load = bots_running/free_bots;

        if(free_bots >= sub.count && (!candidate || load < candidate_load)) {
            candidate = box;
            candidate_load = load;
        }
    }
    return candidate;
};

module.exports = Box;
