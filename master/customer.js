var config = require('./config.js');
var Logger = require('./logger.js');
var Box = require('./box.js');
var Dapi = require('./dapi.js');
var Task = require('./task.js');
var Subscription = require('./subscription.js');

Customer.customers = {};
Customer.engage_antiflood = {};

function Customer(id, opt) {
    this.log = new Logger(id);
    this.id = id;
    this.uid = opt.uid;
    this.debug = config.master.debug;
    this.subscriptions = [];

    if(!Customer.customers[this.uid]) Customer.customers[this.uid] = [];
    Customer.customers[this.uid].push(this);

    for(var i=0;i<opt.subscriptions.length;i++) {
        var sub = opt.subscriptions[i];
        if(!Subscription.subscriptions[sub.id]) {
            Subscription.subscriptions[sub.id] = new Subscription(this.uid, sub);
        }
        this.subscriptions.push(Subscription.subscriptions[sub.id]);
        if(this.debug >= 3)
            this.log.info('Subscription added: ' + sub.id);

        if(Subscription.subscriptions[sub.id].engaged_by) {
            this.send('engaged', sub.id, false);
            this.send('connected', sub.id, Subscription.subscriptions[sub.id].task.connected);
        }
    }

    if(this.debug >= 3)
        this.log.info('Customer added: ' + this.uid);
}

Customer.prototype.destroy = function() {
    for(var i=0;i<Customer.customers[this.uid].length;i++) {
        var customer = Customer.customers[this.uid][i];
        if(customer.id == this.id) {
            if(config.debug >= 5)
                this.log.info('Customer removed from array');
            Customer.customers[this.uid].splice(i, 1);
        }
    }

    for(i=0;i<this.subscriptions.length;i++) {
        if(this.subscriptions[i].engaged_by && this.subscriptions[i].engaged_by.id == this.id) {
            this.subscriptions[i].task.disengage();
        }
    }

    if(!Customer.customers[this.uid].length) {
        delete Customer.customers[this.uid];
        for(var sub_id in Subscription.subscriptions) {
            if(!Subscription.subscriptions.hasOwnProperty(sub_id)) continue;
            if(Subscription.subscriptions[sub_id].owner_uid == this.uid) {
                delete Subscription.subscriptions[sub_id];
            }
        }
    }
};

Customer.prototype.send = function() {
    if(!Customer.customers[this.uid]) return; //disconnected

    var args = ['customer_send', this.uid, this.id];
    var reception = require('./reception.js').active;
    for(var i=0;i<arguments.length;i++) {
        args.push(arguments[i]);
    }
    reception.send.apply(reception, args);
};

Customer.prototype.broadcast = function() {
    if(!Customer.customers[this.uid]) return; //disconnected

    var args = [];
    for(var j=0;j<arguments.length;j++) {
        args.push(arguments[j]);
    }
    for(var i=0;i<Customer.customers[this.uid].length;i++) {
        var customer = Customer.customers[this.uid][i];
        if(customer.id == this.id) continue;
        customer.send.apply(customer, args);
    }
};

Customer.prototype.reception_processors = {
    engage_subscription: function(opt, cb) {
        var id = opt.id;
        var region = opt.region;
        var gamemode = opt.gamemode;
        var server = opt.server;
        var key = opt.key;
        var leaders = opt.leaders;
        var customer = this;
        var dapi;
        var dataproxy_port = config.box.customer_dataproxy_port_min + Math.round((Math.random() * (config.box.customer_dataproxy_port_max - config.box.customer_dataproxy_port_min)));

        if(this.debug >= 3)
            this.log.info('engage_subscription request uid=' + this.uid + ', id=' + id);

        var sub = Subscription.subscriptions[id];
        if(!sub) return cb(null, 3);
        if(sub.owner_uid != this.uid) return cb(null, 3);
        if(sub.activated && (+new Date) > sub.expire) return cb(null, 4);
        if(sub.engaged_by) return cb(null, 8);
        if(sub.type != gamemode) return cb(null, 5);
        if(gamemode == 'ffa' && !region) return cb(null, 6);
        if(gamemode == 'party' && !key) return cb(null, 7);
        if(gamemode == 'ffa' && !server) return cb(null, 10);
        if(gamemode == 'ffa' && key.length < 10) return cb(null, 11);
        if(gamemode == 'party' && key.length > 10) return cb(null, 12);
        if(Customer.engage_antiflood[id]) return cb(null, 18);

        Customer.engage_antiflood[id] = 1;
        setTimeout(function() {
            delete Customer.engage_antiflood[id];
        }, 5000);

        var available_box = Box.findFreeBox(sub);
        if(!available_box) {
            if(this.debug >= 3)
                this.log.info('engage_subscription uid=' + this.uid + ', id=' + id + ': No free boxes available, requesting more');

            cb(null, 9);
            dapi = new Dapi('SUBSCRIPTION/' + id);
            dapi.process('cluster_overloaded', {subscription_id: sub.id, customer_id:this.uid}, function(data, err) {
                if(err) customer.log.error('Error while reporting overloaded cluster: ' + err);
            });
            return;
        }

        var task = new Task(sub, available_box, customer);
        var socks_count = Math.ceil(config.box.socks_per_bot * sub.count);

        dapi = new Dapi('SUBSCRIPTION/' + id);
        dapi.process('request_proxies', {subscription_id: id, region: region,  count: socks_count}, function(data, err) {
            if(err || !data || !data.status || data.status == 'error' || data.status != 'success' || !data.list || !data.list.length) {
                customer.log.error('Failed to request_proxies subscription_id=' + id + ', count=' + socks_count + ', got data=' + JSON.stringify(data) + ', err=' + err);
                task.disengaged();
                return cb(null, 1);
            }
            cb({dataproxy_ip: available_box.socket.remoteAddress, dataproxy_port: dataproxy_port}, null);

            task.engage({
                proxy: data.list,
                leaders:leaders,
                region:region,
                key:key,
                server: server,
                nickname: sub.nickname,
                dataproxy_port: dataproxy_port,
                dataproxy_ip: available_box.socket.remoteAddress});
        });


    },

    disengage_subscription: function(id, cb) {
        cb();
        var sub = Subscription.subscriptions[id];
        if(!sub) return;
        if(!sub.task) return;
        sub.task.disengage();
    }
};


module.exports = Customer;