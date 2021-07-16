var crypto = require('crypto');
var config = require('./config.js');
var Logger  = require('./logger.js');
var net = require('net');
var log = new Logger('reception');


function Reception() {
    this.log = log;
    this.id = '';
    this.debug = config.debug;
    this.buff = '';
    this.agony = false;
}

Reception.prototype.send = function() {
    var arr = [];
    for(var i=0;i<arguments.length;i++) arr.push(arguments[i]);
    var json = JSON.stringify(arr);

    if(this.agony)
        return this.log.warn('Send drop, Reception in agony, data: ' + json);

    if(this.debug >= 4)
        this.log.info('SEND: ' + json);

    this.socket.write(json + '\n');
};

Reception.prototype.report = function(data) {
    var json = JSON.stringify(['report', data]);

    if(this.debug >= 1)
        this.log.error('Error detected, reporting to master: ' + this.log.colorize(31, true, false, data));

    if(this.debug >= 4)
        this.log.info('END: ' + json);

    if(this.agony)
        return this.log.warn('End drop, Reception in agony, data: ' + json);

    this.agony = true;
    this.socket.end(json + '\n');
};

Reception.prototype.warn = function(data) {
    if(this.debug >= 1)
        this.log.error('Warning detected, reporting to master: ' + this.log.colorize(31, true, false, data));

    this.send('warn', data);
};

Reception.prototype.checkBuffer = function() {
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

Reception.prototype.attachEvents = function() {
    this.socket.on('connect', this.onConnect.bind(this));
    this.socket.on('close',   this.onClose.bind(this));
    this.socket.on('data',    this.onData.bind(this));
    this.socket.on('drain',   this.onDrain.bind(this));
    this.socket.on('end',     this.onEnd.bind(this));
    this.socket.on('error',   this.onError.bind(this));
};

Reception.prototype.onConnect = function() {
    if(this.debug >= 1)
        this.log.info('Reception connected to master server');
};

Reception.prototype.onClose = function() {
    if(this.debug >= 1)
        this.log.info('Disconnected from master server');

    process.exit(0);
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

Reception.prototype.processors = {
    'hello': function(id) {
        this.id = id;

        if(this.debug >= 1)
            this.log.info('Got my id from master: ' + this.log.colorize(null, true, true, id));

        var fingerprint = crypto.createHmac('md5', this.id + config.client.password).digest('hex');
        this.send('auth', fingerprint);

        if(this.debug >= 1)
            this.log.info('Auth request sent with fingerprint ' + this.log.colorize(39, false, true, fingerprint));

        onReady();
    },

    'kill': function(reason) {
        if(this.debug >= 1)
            this.log.error('Master killed me! Committing suicide! Reason: ' + this.log.colorize(31, true, false, reason));

        this.agony = true;
        this.socket.destroy();
    },

    'ping': function(time) {
        if(this.debug >= 3)
            this.log.info('Received ping, sending pong ' + this.log.colorize(39, false, true, time));
        this.send('pong', time);
    },

    'config': function(conf) {
        if(this.debug >= 1)
            this.log.info('Received settings, debug=' + conf.debug);
        this.debug = conf.debug;
    },

    'dapi_answer': function(seq, data, err) {
        require('./dapi.js').answer_received(seq, data, err);
    },

    'customer_answer': function(seq, data, err) {
        require('./customer.js').master_answer_received(seq, data, err);
    },

    'customer_send': function(customer_uid, customer_id) {
        var customers = require('./customer.js').customers[customer_uid];
        if(!customers) return;

        var args = [];
        for(var i=2;i<arguments.length;i++) {
            args.push(arguments[i]);
        }

        for(var j=0;j<customers.length;j++) {
            var customer = customers[j];
            if(customer.id == customer_id) {
                customer.send.apply(customer, args);
            }
        }

    }
};

log.info('Connecting to master server');
var onReady = null;
Reception.prototype.init = function(cb) {
    onReady = cb;

    this.socket = net.connect(config.client.port, config.client.host);
    this.attachEvents();
};

module.exports = new Reception();