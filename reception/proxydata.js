var config = require('./config.js');
var Logger = require('./logger.js');
var net = require('net');

function ProxyData(opt) {
    this.id = opt.subscription.id;
    this.log = new Logger('PROXYDATA/' + opt.dataproxy_ip + ':' + opt.dataproxy_port + '/SUB_' + opt.subscription.id + '/UID_' + opt.customer.uid);
    this.customer = opt.customer;
    this.subscription = opt.subscription;
    this.dataproxy_ip = opt.dataproxy_ip;
    this.dataproxy_port = opt.dataproxy_port;
    this.socket = null;
    this.connected = false;
    this.destroyed = false;
    this.debug = config.debug;

    if(this.debug >= 3)
        this.log.info('Created');

    this.connect();
}

ProxyData.prototype.connect = function() {
    var dataproxy = this;

    if(this.debug >= 3)
        this.log.info('Connecting to box');

    this.socket = net.connect(this.dataproxy_port, this.dataproxy_ip, function() {
        dataproxy.connected = true;
    });

    this.socket.on('close', this.on_close.bind(this));
    this.socket.on('error', this.on_error.bind(this));
    this.socket.on('data', this.on_data.bind(this));
};

ProxyData.prototype.on_close = function() {
    if(this.debug >= 3)
        this.log.info('Disconnected');

    var proxydata = this;
    this.connected = false;
    if(!this.destroyed) {
        setTimeout(function() {
            if(proxydata.destroyed) return;
            proxydata.connect();
        }, 1000);
    }
};

ProxyData.prototype.on_error = function(e) {
    if(this.debug >= 1)
        this.log.warn('Socket error:\r\n' + e + '\r\n' + e.stack);
};

ProxyData.prototype.on_data = function(data) {
    if(this.debug >= 5)
        this.log.warn('RECV: ' + data.toString('hex'));
};

ProxyData.prototype.proxyData = function(data) {
    if(this.debug >= 5)
        this.log.info('ProxyData(): ' + data.toString('hex'));

    if(!this.connected) return;
    this.socket.write(data);
};

ProxyData.prototype.destroy = function() {
    if(this.debug >= 3)
        this.log.warn('Destroying');

    if(this.destroyed) return;
    this.destroyed = true;
    if(this.customer.proxydatas[this.id]) delete this.customer.proxydatas[this.id];

    this.socket.end();
};

module.exports = ProxyData;

