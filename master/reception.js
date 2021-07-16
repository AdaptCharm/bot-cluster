//Reception part in Master
var config = require('./config.js');
var crypto = require('crypto');
var Logger = require('./logger.js');
var Dapi = require('./dapi.js');
var Customer = require('./customer.js');
var net = require('net');

Reception.active = null;
Reception.cb = null;

function Reception(socket) {
    this.id             = 'RECEPTION/' + crypto.randomBytes(15).toString('base64');
    this.debug          = config.master.debug;
    this.socket         = socket;
    this.authorized     = false;
    this.connected_time = (+new Date);
    this.ping_history   = [];
    this.buff           = '';
    this.log            = new Logger(this.id);
    this.killed         = false;
    this.ping_interval  = null;

    this.attachEvents();
    this.socket.setEncoding('utf8');
    this.socket.setTimeout(config.master.socket.timeout);

    if(this.debug >= 1)
        this.log.info('Connected');

    if(this.debug >= 1 && Reception.active)
        this.log.warn('We received new connection, but there is already active reception');

    this.send('hello', this.id);
}

Reception.prototype.initialize = function() {
    var rec = this;

    if(Reception.active) {
        if(this.debug >= 1 && Reception.active)
            this.log.warn('We received new connection, but there is already active reception');
        this.log.error('New reception authorized when old was active! Something very wrong!');

        return this.kill('New reception authorized when old was active');
    }

    Reception.active = this;

    this.ping_interval = setInterval(function() {
        var time = (+new Date);
        if(rec.debug >= 5)
            rec.log.info('Sending ping request ' + rec.log.colorize(39, false, true, time));
        rec.send('ping', (+new Date));
    }, config.master.socket.ping_interval);

    this.send('config', config.reception);

    Reception.cb();
};

Reception.prototype.cleanUp = function() {
    if(this.ping_interval) clearTimeout(this.ping_interval);
    if(Reception.active == this) {
        this.log.error('Reception server disconnected');
        process.exit(0);
    }
};

Reception.prototype.send = function() {
    var arr = [];
    for(var i=0;i<arguments.length;i++) arr.push(arguments[i]);
    var json = JSON.stringify(arr);

    if(this.debug >= 4)
        this.log.info('SEND: ' + json);

    if(this.killed) {
        if(this.debug >= 2)
            this.log.warn('Socket is killed, SEND aborted');
        return;
    }

    this.socket.write(json + '\n');
};

Reception.prototype.kill = function(reason) {
    if(this.debug >= 1)
        this.log.warn('Killing connection: ' + reason);

    this.send('kill', reason);
    this.killed = true;

    // Ensures that no more I/O activity happens on this socket. Only necessary in case of errors (parse error or so).
    this.socket.destroy();
};

Reception.prototype.checkBuffer = function() {
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

Reception.prototype.processJSON = function(json) {
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
            this.log.error('Processor "' + obj[0] + '" crashed while processing. \njson="' + json + '"\ne=' + e + '\nstack=' + e.stack);
        this.kill('Processor crash: ' + e + '\n' + e.stack);
    }
};

Reception.prototype.attachEvents = function() {
    this.socket.on('close',   this.onClose.bind(this));
    this.socket.on('data',    this.onData.bind(this));
    this.socket.on('drain',   this.onDrain.bind(this));
    this.socket.on('end',     this.onEnd.bind(this));
    this.socket.on('error',   this.onError.bind(this));
    this.socket.on('timeout', this.onTimeout.bind(this));
};

Reception.prototype.onClose = function() {
    if(this.debug >= 1 && !this.killed && !this.authorized)
        this.log.warn('Socket closed before authorization');

    if(this.debug >= 1)
        this.log.info('Disconnected');

    this.cleanUp();
};

Reception.prototype.onData = function(s) {
    if(this.debug >= 5)
        this.log.info('RECV: "' + s + '"');
    this.buff += s;
    this.checkBuffer();
};

Reception.prototype.onDrain = function() {
    if(this.debug >= 5)
        this.log.info('Socket drain');
};

Reception.prototype.onEnd = function() {
    if(this.debug >= 1)
        this.log.info('FIN packet received');
};

Reception.prototype.onError = function(e) {
    if(this.debug >= 1)
        this.log.error('Socket error: ' + e);
};

Reception.prototype.onTimeout = function() {
    if(this.debug >= 3)
        this.log.error('Socket timeout!');
    this.kill('Socket timeout');
};

Reception.prototype.processors = {
    auth: function(fingerprint) {
        if(this.debug >= 1)
            this.log.info('Received auth fingerprint ' + this.log.colorize(39, false, true, fingerprint));

        var calc_fingerprint = crypto.createHmac('md5', this.id + config.master.reception.password).digest('hex');

        if(fingerprint != calc_fingerprint) {
            if(this.debug >= 1)
                this.log.error('Auth: calculated ' + this.log.colorize(39, false, true, calc_fingerprint) + ' received ' + this.log.colorize(39, false, true, fingerprint));
            return this.kill('Auth failed with invalid fingerprint!');
        }

        if(this.debug >= 1)
            this.log.info('Success auth!');

        this.authorized = true;
        this.initialize();
    },

    report: function(reason) {
        if(this.debug >= 1)
            this.log.error('Reception reporting ' + this.log.colorize(31, true, true, 'fatal error') + ': ' + this.log.colorize(31, true, false, reason));
    },

    warn: function(reason) {
        if(this.debug >= 1)
            this.log.warn('Reception reporting: ' + this.log.colorize(31, true, false, reason));
    },

    'pong': function(time) {
        var delta = (+new Date)-time;
        if(this.debug >= 5)
            this.log.info('Got pong answer ' + this.log.colorize(39, false, true, time) + ' with delta ' + this.log.colorize(39, false, true, delta + 'ms'));
        this.ping_history.push(delta);
        if(this.ping_history.length > config.master.ping_history_size) {
            this.ping_history.shift();
        }
    },

    'dapi_request': function(seq, cmd, opt) {
        var reception = this;
        if(this.debug >= 3)
            this.log.info('Got Dapi request SEQ ' + seq + ' cmd ' + cmd);

        var dapi = new Dapi(seq);
        dapi.process(cmd, opt, function(data, err) {
            if(err) {
                dapi.log.error('Process "' + cmd + '(' + JSON.stringify(opt) + ')" returned error: ' + err);
            }
            reception.send('dapi_answer', seq, data, err);
        });

    },

    'customer_request': function(seq,customer_id, customer_uid, cmd, opt) {
        var customers = Customer.customers[customer_uid];
        var reception = this;
        if(!customers) throw new Error('Got `customer_request` but customer `uid` not found! id=' + customer_id + ', uid=' + customer_uid + ', opt=' + JSON.stringify(opt));
        for(var i=0;i<customers.length;i++) {
            var customer = customers[i];
            if(customer.id == customer_id) {
                customer.reception_processors[cmd].call(customer, opt, function(data, err){
                    reception.send('customer_answer', seq, data, err);
                });
            }
        }
    },

    'customer_join': function(customer_id, obj) {
        if(this.debug >= 2)
            this.log.info('Customer ' + customer_id + ' joined master');

        new Customer(customer_id, obj);
    },

    'customer_leave': function(customer_id, customer_uid) {
        if(this.debug >= 2)
            this.log.info('Customer ' +customer_uid + '(' + customer_id + ') disconnected master');

        if(!Customer.customers[customer_uid]) {
            throw new Error('Customer uid ' + customer_uid + ' not found');
        }
        var removed = false;
        var customer_objects = Customer.customers[customer_uid];
        for(var i=0;i<customer_objects.length;i++) {
            if(customer_objects[i].id == customer_id) {
                customer_objects[i].destroy();
                removed = true;
            }
        }
        if(!removed) {
            throw new Error('Customer uid ' + customer_uid + ' not removed');
        }
    },

    'new_target': function(customer_uid, customer_id, target, a, b, ball_name, ball_x, ball_y) {
        var customers = Customer.customers[customer_uid];
        if(!customers) return;

        //searching customer
        var customer;
        for(var i=0;i<customers.length;i++) {
            if(customers[i].id == customer_id) {
                customer = customers[i];
                break;
            }
        }
        if(!customer) return;

        //searching boxes and tasks
        var boxes = [];
        var tasks = [];
        for(var j=0;j<customer.subscriptions.length;j++) {
            var sub = customer.subscriptions[j];
            if(!sub.engaged_by || sub.engaged_by.id != customer_id) continue;
            tasks.push(sub.task.id);
            var box = sub.task.box;
            if(boxes.indexOf(box) >= 0) continue;
            boxes.push(box);
        }

        //sending target to boxes specifying tasks
        var box_send_args = ['new_target', tasks, target];
        if(typeof a != 'undefined') {
            box_send_args.push(a);
            if(typeof b != 'undefined') box_send_args.push(b);
        }
        if(typeof ball_name != 'undefined') {
            box_send_args.push(ball_name);
            box_send_args.push(ball_x);
            box_send_args.push(ball_y);
        }

        for(var z=0;z<boxes.length;z++) {
            boxes[z].send.apply(boxes[z], box_send_args);
        }
    }
};

Reception.init = function(log, cb) {
    var server = net.createServer(function(socket) {
        new Reception(socket);
    });

    server.on('listening', function() {
        log.info('Reception socket is waiting for connection...');
        Reception.cb = cb;
    });

    server.listen(config.master.reception.listen_port, config.master.reception.listen_ip);
};

module.exports = Reception;
